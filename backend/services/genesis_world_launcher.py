from __future__ import annotations

import time
import subprocess
import sys
from pathlib import Path
from typing import Final

from backend.core.paths import BASE_DIR
from backend.core.settings import settings
from backend.models.genesis_world import (
    GenesisDynamicContainerMode,
    GenesisWorldRobotMode,
    GenesisWorldOpenResponse,
)

GENESIS_LIVE_SYNC_HZ = 60.0
GENESIS_LIVE_HTTP_TIMEOUT_SEC = 0.02
GENESIS_LAUNCH_LOG_DIR: Final = BASE_DIR / ".cache" / "genesis-launch"
GENESIS_LAUNCH_STARTUP_GRACE_SEC: Final = 1.0
GENESIS_LAUNCH_READY_TIMEOUT_SEC: Final = 120.0
GENESIS_LAUNCH_POST_READY_GRACE_SEC: Final = 2.0
GENESIS_LAUNCH_LOG_TAIL_CHARS: Final = 4000
GENESIS_READY_LOG_MARKER: Final = "[genesis-world-open] scene built; stepping Genesis runtime."


class GenesisWorldLaunchError(RuntimeError):
    pass


def _next_launch_log_path() -> Path:
    GENESIS_LAUNCH_LOG_DIR.mkdir(parents=True, exist_ok=True)
    return GENESIS_LAUNCH_LOG_DIR / f"genesis-world-{time.time_ns()}.log"


def _read_log_tail(log_path: Path) -> str:
    try:
        with log_path.open("rb") as handle:
            handle.seek(0, 2)
            size = handle.tell()
            handle.seek(max(0, size - GENESIS_LAUNCH_LOG_TAIL_CHARS))
            return handle.read().decode("utf-8", errors="replace").strip()
    except OSError:
        return ""


def _format_startup_failure(*, returncode: int, log_path: Path) -> str:
    detail = (
        f"Genesis launch exited immediately with code {returncode}. "
        f"Launch log: {log_path}"
    )
    log_tail = _read_log_tail(log_path)
    if log_tail:
        detail = f"{detail}\n\n{log_tail}"
    return detail


def _format_readiness_timeout(*, log_path: Path) -> str:
    detail = (
        f"Genesis launch did not become ready within {GENESIS_LAUNCH_READY_TIMEOUT_SEC:.0f}s. "
        f"Launch log: {log_path}"
    )
    log_tail = _read_log_tail(log_path)
    if log_tail:
        detail = f"{detail}\n\n{log_tail}"
    return detail


def _log_contains_ready_marker(log_path: Path) -> bool:
    return GENESIS_READY_LOG_MARKER in _read_log_tail(log_path)


def _wait_for_launch_readiness(process: subprocess.Popen, log_path: Path) -> None:
    deadline = time.monotonic() + GENESIS_LAUNCH_READY_TIMEOUT_SEC
    while time.monotonic() < deadline:
        returncode = process.poll()
        if returncode is not None:
            raise GenesisWorldLaunchError(
                _format_startup_failure(returncode=returncode, log_path=log_path)
            )
        if _log_contains_ready_marker(log_path):
            time.sleep(GENESIS_LAUNCH_POST_READY_GRACE_SEC)
            returncode = process.poll()
            if returncode is not None:
                raise GenesisWorldLaunchError(
                    _format_startup_failure(returncode=returncode, log_path=log_path)
                )
            return
        time.sleep(GENESIS_LAUNCH_STARTUP_GRACE_SEC)
    raise GenesisWorldLaunchError(_format_readiness_timeout(log_path=log_path))


def launch_default_genesis_world(
    *,
    dynamic_container_mode: GenesisDynamicContainerMode = "box",
    robot_mode: GenesisWorldRobotMode = "so101",
) -> GenesisWorldOpenResponse:
    command = [
        sys.executable,
        "-u",
        "-m",
        "backend.scripts.genesis_world_open",
        "--dynamic-container-mode",
        dynamic_container_mode,
        "--robot-mode",
        robot_mode,
        "--live-state-base-url",
        f"http://127.0.0.1:{settings.api_port}/worlds/genesis",
        "--live-joint-poll-hz",
        str(GENESIS_LIVE_SYNC_HZ),
        "--live-world-publish-hz",
        str(GENESIS_LIVE_SYNC_HZ),
        "--live-http-timeout-sec",
        str(GENESIS_LIVE_HTTP_TIMEOUT_SEC),
    ]
    log_path = _next_launch_log_path()
    with log_path.open("ab", buffering=0) as log_file:
        process = subprocess.Popen(
            command,
            cwd=BASE_DIR,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    _wait_for_launch_readiness(process, log_path)
    return GenesisWorldOpenResponse(
        started=True,
        pid=process.pid,
        command=command,
        dynamic_container_mode=dynamic_container_mode,
        robot_mode=robot_mode,
        log_path=str(log_path),
    )
