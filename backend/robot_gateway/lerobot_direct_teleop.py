from __future__ import annotations

import os
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
    build_lerobot_calibration_command,
    build_lerobot_leader_calibration_command,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
    ROBOT_GATEWAY_LEROBOT_DIRECT_TELEOP_DEFAULT_FPS,
    ROBOT_GATEWAY_LEROBOT_DIRECT_TELEOP_STOP_TIMEOUT_SEC,
    ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE,
    ROBOT_GATEWAY_LEROBOT_TELEOPERATE_BIN,
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
        with self._lock:
            self._refresh_process_state_locked()
            if self._process is not None and self._process.poll() is None:
                raise RuntimeError("LeRobot direct teleop is already running.")
            self._session_id += 1
            session = _LeRobotDirectTeleopSession(
                session_id=f"lerobot-direct-{self._session_id}",
                request=request,
                adapter_config=adapter_config,
                command=command,
                started_at_ms=_now_ms(),
            )
            try:
                self._process = self._process_factory(
                    command,
                    cwd=BASE_DIR,
                    env=_build_lerobot_process_env(),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            except OSError as exc:
                self._process = None
                self._session = session
                self._state = "error"
                self._last_error = f"Failed to start LeRobot teleop: {exc}"
                self._stopped_at_ms = _now_ms()
                self._return_code = None
                return self._snapshot_locked()
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
        self._last_error = f"LeRobot teleop exited with code {returncode}."

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
    normalized_leader = _normalize_openarm_mini_ports(leader)
    leader_command = build_lerobot_leader_calibration_command(
        port=normalized_port,
        port_left=normalized_leader.port_left,
        port_right=normalized_leader.port_right,
        calibration_profile=normalized_leader.calibration_profile,
        calibration_id=normalized_leader.calibration_id,
        calibration_group=normalized_leader.calibration_group,
    )
    return [
        _resolve_lerobot_teleoperate_bin(),
        *build_lerobot_calibration_command(config)[1:],
        *leader_command[1:],
        f"--fps={request.fps}",
    ]


def _normalize_openarm_mini_ports(
    leader: RobotGatewayLeRobotDirectTeleopLeaderRequest,
) -> RobotGatewayLeRobotDirectTeleopLeaderRequest:
    profile = _normalize_non_empty_string(leader.calibration_profile)
    if profile != ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE:
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
            "LeRobot OpenArm Mini direct teleop requires both left and right leader ports."
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
