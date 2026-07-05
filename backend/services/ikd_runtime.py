from __future__ import annotations

import os
import shutil
import signal
import socket
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Literal

from backend.core.app_config import get_config_value, read_app_config
from backend.core.settings import settings

IKD_STARTUP_TIMEOUT_S = 4.0
IKD_STOP_TIMEOUT_S = 2.0
IKD_STOP_POLL_INTERVAL_S = 0.05
IkdLaunchMode = Literal["binary", "cargo", "external"]
ManagedIkdLaunchMode = Literal["binary", "cargo"]
IkdRuntimePayload = dict[str, bool | int | str | None]


def _coerce_config_bool(value: object, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", ""}
    return default


def _coerce_config_int(value: object, default: int) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return default
        try:
            return int(candidate)
        except ValueError:
            return default
    return default


@dataclass(frozen=True)
class IkdRuntimeStatus:
    configured_enabled: bool
    configured_use_for_drag: bool
    running: bool
    pid: int | None
    launch_mode: IkdLaunchMode | None
    message: str | None

    def to_dict(self) -> IkdRuntimePayload:
        return {
            "configured_enabled": self.configured_enabled,
            "configured_use_for_drag": self.configured_use_for_drag,
            "running": self.running,
            "pid": self.pid,
            "launch_mode": self.launch_mode,
            "message": self.message,
        }


class IkdRuntimeManager:
    def __init__(self) -> None:
        self._lock = Lock()
        self._process: subprocess.Popen[str] | None = None
        self._launch_mode: ManagedIkdLaunchMode | None = None
        self._project_root = Path(__file__).resolve().parents[2]
        binary_name = "worldd.exe" if os.name == "nt" else "worldd"
        self._worldd_binary = self._project_root / "ikd" / "target" / "debug" / binary_name
        self._manifest_path = self._project_root / "ikd" / "Cargo.toml"

    def _config_flags(self) -> tuple[bool, bool, int, int, int]:
        config = read_app_config()
        enabled = _coerce_config_bool(get_config_value(config, ["ikd", "enabled"], False), False)
        use_for_drag = _coerce_config_bool(
            get_config_value(config, ["ikd", "useForDrag"], False),
            False,
        )
        control_hz = _coerce_config_int(get_config_value(config, ["ikd", "controlHz"], 500), 500)
        telemetry_hz = _coerce_config_int(
            get_config_value(config, ["ikd", "telemetryHz"], 60),
            60,
        )
        stale_target_ms = _coerce_config_int(
            get_config_value(config, ["ikd", "staleTargetMs"], 250),
            250,
        )
        return enabled, use_for_drag, control_hz, telemetry_hz, stale_target_ms

    @staticmethod
    def _is_alive(process: subprocess.Popen[str] | None) -> bool:
        return process is not None and process.poll() is None

    def _check_worldd_socket(self) -> bool:
        try:
            with socket.create_connection((settings.worldd_host, settings.worldd_port), timeout=0.2):
                return True
        except OSError:
            return False

    def _collect_external_pids(self) -> list[int]:
        try:
            result = subprocess.run(
                ["ps", "-eo", "pid,args"],
                check=False,
                capture_output=True,
                text=True,
            )
        except OSError:
            return []

        binary_token = str(self._worldd_binary)
        manifest_token = str(self._manifest_path)
        pids: list[int] = []
        for row in result.stdout.splitlines()[1:]:
            line = row.strip()
            if not line:
                continue
            parts = line.split(None, 1)
            if len(parts) < 2:
                continue
            pid_raw, args = parts
            try:
                pid = int(pid_raw)
            except ValueError:
                continue
            if pid == os.getpid():
                continue
            if binary_token in args or ("cargo run" in args and manifest_token in args):
                pids.append(pid)
        return pids

    def _resolve_command(self) -> tuple[list[str], ManagedIkdLaunchMode]:
        if self._worldd_binary.exists():
            return [str(self._worldd_binary)], "binary"

        cargo = shutil.which("cargo")
        if cargo and self._manifest_path.exists():
            return [cargo, "run", "--manifest-path", str(self._manifest_path)], "cargo"
        raise RuntimeError("IKD runtime unavailable: worldd binary or cargo manifest was not found.")

    def _build_env(self, control_hz: int, telemetry_hz: int, stale_target_ms: int) -> dict[str, str]:
        env = os.environ.copy()
        env["IKD_HOST"] = settings.worldd_host
        env["IKD_PORT"] = str(settings.worldd_port)
        env["IKD_CONTROL_HZ"] = str(max(control_hz, 1))
        env["IKD_TELEMETRY_HZ"] = str(max(telemetry_hz, 1))
        env["IKD_STALE_TARGET_MS"] = str(max(stale_target_ms, 1))
        env["IKD_CORS_ORIGIN"] = f"http://{settings.web_host}:{settings.web_port}"
        return env

    def _status_locked(self) -> IkdRuntimeStatus:
        enabled, use_for_drag, _, _, _ = self._config_flags()

        if self._is_alive(self._process):
            return IkdRuntimeStatus(
                configured_enabled=enabled,
                configured_use_for_drag=use_for_drag,
                running=True,
                pid=self._process.pid,
                launch_mode=self._launch_mode,
                message=None,
            )

        # Clear stale handle.
        self._process = None
        self._launch_mode = None

        external_pids = self._collect_external_pids()
        if external_pids or self._check_worldd_socket():
            return IkdRuntimeStatus(
                configured_enabled=enabled,
                configured_use_for_drag=use_for_drag,
                running=True,
                pid=external_pids[0] if external_pids else None,
                launch_mode="external",
                message=None,
            )

        return IkdRuntimeStatus(
            configured_enabled=enabled,
            configured_use_for_drag=use_for_drag,
            running=False,
            pid=None,
            launch_mode=None,
            message=None,
        )

    def status(self) -> IkdRuntimeStatus:
        with self._lock:
            return self._status_locked()

    def start(self) -> IkdRuntimeStatus:
        with self._lock:
            status = self._status_locked()
            if status.running:
                return status

            enabled, use_for_drag, control_hz, telemetry_hz, stale_target_ms = self._config_flags()
            if not enabled:
                return IkdRuntimeStatus(
                    configured_enabled=enabled,
                    configured_use_for_drag=use_for_drag,
                    running=False,
                    pid=None,
                    launch_mode=None,
                    message="IKD is disabled in config (ikd.enabled=false).",
                )

            command, launch_mode = self._resolve_command()
            process = subprocess.Popen(
                command,
                cwd=str(self._project_root),
                env=self._build_env(control_hz, telemetry_hz, stale_target_ms),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
            )
            self._process = process
            self._launch_mode = launch_mode

        deadline = time.time() + IKD_STARTUP_TIMEOUT_S
        while time.time() < deadline:
            with self._lock:
                if not self._is_alive(self._process):
                    break
            if self._check_worldd_socket():
                break
            time.sleep(IKD_STOP_POLL_INTERVAL_S)

        with self._lock:
            status = self._status_locked()
            if status.running:
                return status
            return IkdRuntimeStatus(
                configured_enabled=status.configured_enabled,
                configured_use_for_drag=status.configured_use_for_drag,
                running=False,
                pid=None,
                launch_mode=None,
                message="IKD failed to start.",
            )

    def stop(self) -> IkdRuntimeStatus:
        with self._lock:
            process = self._process
            if self._is_alive(process):
                process.terminate()
                try:
                    process.wait(timeout=IKD_STOP_TIMEOUT_S)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=IKD_STOP_TIMEOUT_S)

            self._process = None
            self._launch_mode = None

            for pid in self._collect_external_pids():
                try:
                    os.kill(pid, signal.SIGTERM)
                except OSError:
                    continue

        # Give external process shutdown a brief grace period before final status.
        deadline = time.time() + IKD_STOP_TIMEOUT_S
        while time.time() < deadline:
            if not self._check_worldd_socket():
                break
            time.sleep(IKD_STOP_POLL_INTERVAL_S)

        with self._lock:
            status = self._status_locked()
            if status.running:
                return IkdRuntimeStatus(
                    configured_enabled=status.configured_enabled,
                    configured_use_for_drag=status.configured_use_for_drag,
                    running=True,
                    pid=status.pid,
                    launch_mode=status.launch_mode,
                    message="IKD stop requested but process is still running.",
                )
            return status


ikd_runtime_manager = IkdRuntimeManager()
