from __future__ import annotations

import os
from pathlib import Path
import shlex
import shutil
import subprocess
from dataclasses import dataclass
from threading import RLock
from time import time
from typing import Callable, Protocol

from backend.core.paths import BASE_DIR
from backend.models.robot_gateway import (
    RobotGatewayLeRobotDirectTeleopLeaderRequest,
    RobotGatewayLeRobotDirectTeleopStartRequest,
    RobotGatewayLeRobotDirectTeleopState,
    RobotGatewayLeRobotDirectTeleopStatus,
)
from backend.robot_gateway.adapters import RobotGatewayAdapterConfig
from backend.robot_gateway.lerobot_calibration import (
    _resolve_lerobot_cmeel_lib_path,
    build_lerobot_leader_teleop_cli_args,
    build_lerobot_robot_cli_args,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
    ROBOT_GATEWAY_LEROBOT_BI_OPENARM_MINI_TELEOPERATOR_TYPE,
    ROBOT_GATEWAY_LEROBOT_CALIBRATION_ROOT_DEFAULT,
    ROBOT_GATEWAY_LEROBOT_DIRECT_TELEOP_DEFAULT_FPS,
    ROBOT_GATEWAY_LEROBOT_DIRECT_TELEOP_STOP_TIMEOUT_SEC,
    ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE,
    ROBOT_GATEWAY_LEROBOT_PAIRED_PORT_TELEOPERATOR_TYPES,
    ROBOT_GATEWAY_LEROBOT_ROBOT_CALIBRATION_RELATIVE_DIR,
    ROBOT_GATEWAY_LEROBOT_TELEOPERATE_BIN,
    ROBOT_GATEWAY_LEROBOT_TELEOPERATOR_CALIBRATION_RELATIVE_DIR,
    ROBOT_GATEWAY_LEROBOT_VENV_BIN_RELATIVE_DIR,
    ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_LEFT,
    ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT,
    ROBOT_GATEWAY_SECONDS_TO_MS,
)


class LeRobotDirectTeleopProcess(Protocol):
    pid: int
    returncode: int | None

    def poll(self) -> int | None:
        raise NotImplementedError

    def terminate(self) -> None:
        raise NotImplementedError

    def kill(self) -> None:
        raise NotImplementedError

    def wait(self, timeout: float | None = None) -> int:
        raise NotImplementedError


@dataclass(frozen=True)
class _LeRobotDirectTeleopSession:
    session_id: str
    request: RobotGatewayLeRobotDirectTeleopStartRequest
    adapter_config: RobotGatewayAdapterConfig
    command: list[str]
    log_path: Path
    started_at_ms: int


class LeRobotDirectTeleopService:
    def __init__(
        self,
        *,
        process_factory: Callable[..., LeRobotDirectTeleopProcess] | None = None,
    ) -> None:
        self._process_factory = process_factory or subprocess.Popen
        self._lock = RLock()
        self._process: LeRobotDirectTeleopProcess | None = None
        self._session: _LeRobotDirectTeleopSession | None = None
        self._state: RobotGatewayLeRobotDirectTeleopState = "idle"
        self._session_id = 0
        self._last_error: str | None = None
        self._stopped_at_ms: int | None = None
        self._return_code: int | None = None

    def start(
        self,
        request: RobotGatewayLeRobotDirectTeleopStartRequest,
        *,
        adapter_config: RobotGatewayAdapterConfig,
    ) -> RobotGatewayLeRobotDirectTeleopStatus:
        command = build_lerobot_direct_teleop_command(adapter_config, request)
        stdin_text = build_lerobot_direct_teleop_stdin_text(
            adapter_config,
            command,
        )
        with self._lock:
            self._refresh_process_state_locked()
            if self._process is not None and self._process.poll() is None:
                raise RuntimeError("LeRobot direct teleop is already running.")
            self._session_id += 1
            log_path = _build_lerobot_direct_teleop_log_path(self._session_id)
            session = _LeRobotDirectTeleopSession(
                session_id=f"lerobot-direct-{self._session_id}",
                request=request,
                adapter_config=adapter_config,
                command=command,
                log_path=log_path,
                started_at_ms=_now_ms(),
            )
            log_handle = log_path.open("ab", buffering=0)
            try:
                self._process = self._process_factory(
                    command,
                    cwd=BASE_DIR,
                    env=_build_lerobot_process_env(),
                    stdin=subprocess.PIPE if stdin_text else subprocess.DEVNULL,
                    stdout=log_handle,
                    stderr=subprocess.STDOUT,
                )
            except OSError as exc:
                self._process = None
                self._session = session
                self._state = "error"
                self._last_error = f"Failed to start LeRobot teleop: {exc}"
                self._stopped_at_ms = _now_ms()
                self._return_code = None
                return self._snapshot_locked()
            finally:
                log_handle.close()
            _write_lerobot_process_stdin(self._process, stdin_text)
            self._session = session
            self._state = "running"
            self._last_error = None
            self._stopped_at_ms = None
            self._return_code = None
            return self._snapshot_locked()

    def stop(self) -> RobotGatewayLeRobotDirectTeleopStatus:
        with self._lock:
            self._refresh_process_state_locked()
            process = self._process
            if process is None or process.poll() is not None:
                if self._state != "error":
                    self._state = "stopped"
                self._stopped_at_ms = self._stopped_at_ms or _now_ms()
                return self._snapshot_locked()
            self._state = "stopping"
        try:
            process.terminate()
            returncode = process.wait(
                timeout=ROBOT_GATEWAY_LEROBOT_DIRECT_TELEOP_STOP_TIMEOUT_SEC
            )
        except subprocess.TimeoutExpired:
            process.kill()
            returncode = process.wait(
                timeout=ROBOT_GATEWAY_LEROBOT_DIRECT_TELEOP_STOP_TIMEOUT_SEC
            )
        with self._lock:
            self._process = None
            self._return_code = returncode
            self._state = "stopped"
            self._last_error = None
            self._stopped_at_ms = self._stopped_at_ms or _now_ms()
            return self._snapshot_locked()

    def status(self) -> RobotGatewayLeRobotDirectTeleopStatus:
        with self._lock:
            self._refresh_process_state_locked()
            return self._snapshot_locked()

    def _refresh_process_state_locked(self) -> None:
        process = self._process
        if process is None:
            return
        returncode = process.poll()
        if returncode is None:
            return
        self._process = None
        self._return_code = returncode
        self._stopped_at_ms = self._stopped_at_ms or _now_ms()
        if returncode == 0:
            if self._state != "error":
                self._state = "stopped"
            return
        self._state = "error"
        log_tail = (
            _read_lerobot_direct_teleop_log_tail(self._session.log_path)
            if self._session is not None
            else ""
        )
        self._last_error = f"LeRobot teleop exited with code {returncode}."
        if log_tail:
            self._last_error = f"{self._last_error} Last output: {log_tail}"

    def _snapshot_locked(self) -> RobotGatewayLeRobotDirectTeleopStatus:
        session = self._session
        leader = session.request.leader if session is not None else None
        adapter_config = session.adapter_config if session is not None else None
        process = self._process
        state = self._state
        command = session.command if session is not None else []
        return RobotGatewayLeRobotDirectTeleopStatus(
            state=state,
            running=state in {"running", "stopping"},
            session_id=session.session_id if session is not None else None,
            fps=(
                session.request.fps
                if session is not None
                else ROBOT_GATEWAY_LEROBOT_DIRECT_TELEOP_DEFAULT_FPS
            ),
            pid=process.pid if process is not None else None,
            command=command,
            display_command=shlex.join(command) if command else "",
            leader_profile=(
                _normalize_non_empty_string(leader.calibration_profile)
                if leader is not None
                else None
            ),
            leader_id=(
                _normalize_non_empty_string(leader.calibration_id)
                if leader is not None
                else None
            ),
            follower_robot_type=(
                adapter_config.lerobot_robot_type if adapter_config is not None else None
            ),
            started_at_ms=session.started_at_ms if session is not None else None,
            stopped_at_ms=self._stopped_at_ms,
            return_code=process.returncode if process is not None else self._return_code,
            last_error=self._last_error,
        )


def build_lerobot_direct_teleop_command(
    config: RobotGatewayAdapterConfig,
    request: RobotGatewayLeRobotDirectTeleopStartRequest,
) -> list[str]:
    if config.adapter_kind != ROBOT_GATEWAY_LEROBOT_ADAPTER_ID:
        raise ValueError(
            "LeRobot direct teleop requires the active follower adapter to be lerobot."
        )
    if not config.lerobot_robot_type.strip():
        raise ValueError(
            "LeRobot direct teleop requires a configured follower robot type."
        )
    leader = request.leader
    normalized_port = _require_non_empty_string(
        leader.port or leader.port_left or leader.port_right,
        "LeRobot direct teleop requires a leader port.",
    )
    normalized_leader = _normalize_paired_teleoperator_ports(leader)
    leader_args = build_lerobot_leader_teleop_cli_args(
        port=normalized_port,
        port_left=normalized_leader.port_left,
        port_right=normalized_leader.port_right,
        calibration_profile=normalized_leader.calibration_profile,
        calibration_id=normalized_leader.calibration_id,
        calibration_group=normalized_leader.calibration_group,
    )
    return [
        _resolve_lerobot_teleoperate_bin(),
        *build_lerobot_robot_cli_args(config),
        *leader_args,
        f"--fps={request.fps}",
    ]


def build_lerobot_direct_teleop_stdin_text(
    config: RobotGatewayAdapterConfig,
    command: list[str],
) -> str:
    calibration_paths = _resolve_required_existing_calibration_paths(
        config,
        command,
    )
    missing_paths = [
        str(calibration_path)
        for calibration_path in calibration_paths
        if not calibration_path.is_file()
    ]
    if missing_paths:
        raise ValueError(
            "LeRobot direct teleop requires existing calibration files. "
            f"Run Calibrate first: {', '.join(missing_paths)}"
        )
    return "\n" * len(calibration_paths)


def _resolve_required_existing_calibration_paths(
    config: RobotGatewayAdapterConfig,
    command: list[str],
) -> list[Path]:
    paths: list[Path] = []
    teleop_type = _extract_cli_arg_value(command, "--teleop.type")
    teleop_id = _extract_cli_arg_value(command, "--teleop.id")
    calibration_root = Path(
        ROBOT_GATEWAY_LEROBOT_CALIBRATION_ROOT_DEFAULT
    ).expanduser()
    if teleop_id and teleop_type == ROBOT_GATEWAY_LEROBOT_BI_OPENARM_MINI_TELEOPERATOR_TYPE:
        teleop_dir = (
            calibration_root
            / ROBOT_GATEWAY_LEROBOT_TELEOPERATOR_CALIBRATION_RELATIVE_DIR
            / ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE
        )
        paths.extend(
            (
                teleop_dir / f"{teleop_id}_left.json",
                teleop_dir / f"{teleop_id}_right.json",
            )
        )
    elif teleop_id and teleop_type == ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE:
        paths.append(
            calibration_root
            / ROBOT_GATEWAY_LEROBOT_TELEOPERATOR_CALIBRATION_RELATIVE_DIR
            / teleop_type
            / f"{teleop_id}.json"
        )

    robot_type = config.lerobot_robot_type.strip()
    robot_id = (config.lerobot_id or config.robot_id).strip()
    if robot_id and robot_type == "bi_openarm_follower":
        robot_dir = (
            config.lerobot_calibration_dir.expanduser()
            if config.lerobot_calibration_dir is not None
            else calibration_root
            / ROBOT_GATEWAY_LEROBOT_ROBOT_CALIBRATION_RELATIVE_DIR
            / "openarm_follower"
        )
        paths.extend(
            (
                robot_dir / f"{robot_id}_left.json",
                robot_dir / f"{robot_id}_right.json",
            )
        )
    elif robot_id and robot_type == "openarm_follower":
        robot_dir = (
            config.lerobot_calibration_dir.expanduser()
            if config.lerobot_calibration_dir is not None
            else calibration_root
            / ROBOT_GATEWAY_LEROBOT_ROBOT_CALIBRATION_RELATIVE_DIR
            / robot_type
        )
        paths.append(robot_dir / f"{robot_id}.json")
    return paths


def _extract_cli_arg_value(command: list[str], key: str) -> str | None:
    prefix = f"{key}="
    for arg in command:
        if arg.startswith(prefix):
            return arg[len(prefix) :].strip() or None
    return None


def _normalize_paired_teleoperator_ports(
    leader: RobotGatewayLeRobotDirectTeleopLeaderRequest,
) -> RobotGatewayLeRobotDirectTeleopLeaderRequest:
    profile = _normalize_non_empty_string(leader.calibration_profile)
    if profile not in ROBOT_GATEWAY_LEROBOT_PAIRED_PORT_TELEOPERATOR_TYPES:
        return leader
    selected_port = _normalize_non_empty_string(leader.port)
    group = _normalize_non_empty_string(leader.calibration_group)
    port_left = _normalize_non_empty_string(leader.port_left)
    port_right = _normalize_non_empty_string(leader.port_right)
    if group == ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_LEFT:
        port_left = port_left or selected_port
    if group == ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT:
        port_right = port_right or selected_port
    if port_left is None or port_right is None:
        raise ValueError(
            "LeRobot paired direct teleop requires both left and right leader ports."
        )
    return leader.model_copy(
        update={
            "port_left": port_left,
            "port_right": port_right,
        }
    )


def _resolve_lerobot_teleoperate_bin() -> str:
    script_path = (
        BASE_DIR
        / ROBOT_GATEWAY_LEROBOT_VENV_BIN_RELATIVE_DIR
        / ROBOT_GATEWAY_LEROBOT_TELEOPERATE_BIN
    )
    if script_path.is_file():
        return str(script_path)
    return (
        shutil.which(ROBOT_GATEWAY_LEROBOT_TELEOPERATE_BIN)
        or ROBOT_GATEWAY_LEROBOT_TELEOPERATE_BIN
    )


def _build_lerobot_process_env() -> dict[str, str]:
    env = os.environ.copy()
    cmeel_lib_path = _resolve_lerobot_cmeel_lib_path()
    if cmeel_lib_path is None:
        return env
    current = env.get("LD_LIBRARY_PATH", "")
    env["LD_LIBRARY_PATH"] = (
        f"{cmeel_lib_path}:{current}" if current else str(cmeel_lib_path)
    )
    return env


def _build_lerobot_direct_teleop_log_path(session_index: int) -> Path:
    return Path("/tmp") / f"urdf-studio-lerobot-direct-teleop-{session_index}.log"


def _read_lerobot_direct_teleop_log_tail(
    log_path: Path,
    *,
    max_chars: int = 1200,
) -> str:
    try:
        text = log_path.read_text(errors="replace")
    except OSError:
        return ""
    return " ".join(text[-max_chars:].split())


def _write_lerobot_process_stdin(
    process: LeRobotDirectTeleopProcess,
    text: str,
) -> None:
    if not text:
        return
    stdin = getattr(process, "stdin", None)
    if stdin is None:
        return
    try:
        stdin.write(text.encode())
        stdin.flush()
        stdin.close()
    except OSError:
        return


def _require_non_empty_string(value: str | None, message: str) -> str:
    normalized = _normalize_non_empty_string(value)
    if normalized is None:
        raise ValueError(message)
    return normalized


def _normalize_non_empty_string(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _now_ms() -> int:
    return int(time() * ROBOT_GATEWAY_SECONDS_TO_MS)


lerobot_direct_teleop_service = LeRobotDirectTeleopService()
