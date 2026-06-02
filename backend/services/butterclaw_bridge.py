from __future__ import annotations

import json
import subprocess
from pathlib import Path
from dataclasses import dataclass

from backend.core.settings import settings
from backend.models.butterclaw import ButterClawChatRequest, ButterClawChatResponse
from backend.services.attestation import attestation_status_store
from backend.services.butterclaw_bridge_params import (
    BUTTERCLAW_DIRECT_COMMAND_DEFAULTS,
    BUTTERCLAW_MOVE_ARGUMENT_COUNT_WITHOUT_STRAFE,
    BUTTERCLAW_MOVE_ARGUMENT_COUNT_WITH_STRAFE,
    BUTTERCLAW_ROTATE_OPTIONAL_ARGUMENT_COUNT,
    BUTTERCLAW_ROTATE_REQUIRED_ARGUMENT_COUNT,
    BUTTERCLAW_SCAN_MIN_ARGUMENT_COUNT,
    BUTTERCLAW_SLASH_PREFIX,
    BUTTERCLAW_STATUS_REQUIRED_ARGUMENT_COUNT,
    BUTTERCLAW_STOP_REQUIRED_ARGUMENT_COUNT,
    BUTTERCLAW_STRAFE_REQUIRED_ARGUMENT_COUNT,
)


class ButterClawBridgeError(RuntimeError):
    pass


def _runner_script_path() -> Path:
    return Path(__file__).resolve().parent.parent / "scripts" / "butterclaw_chat_bridge_runner.py"


def _require_trusted_robot(robot_id: str) -> None:
    summary = attestation_status_store.summary(robot_id)
    if summary is None:
        raise ButterClawBridgeError(f"No attestation status is available for robot '{robot_id}'.")
    if not summary.control_allowed:
        raise ButterClawBridgeError(summary.control_explanation)


@dataclass(frozen=True)
class ParsedButterClawSlashCommand:
    command_payload: dict[str, float | str]
    timeout_seconds: float


def _parse_float_argument(raw: str, *, field_name: str) -> float:
    try:
        return float(raw)
    except ValueError as exc:
        raise ButterClawBridgeError(f"Invalid numeric value for {field_name}: '{raw}'.") from exc


def _require_argument_count(parts: list[str], *, command_name: str, expected: tuple[int, ...]) -> None:
    actual = len(parts) - 1
    if actual in expected:
        return
    expected_text = " or ".join(str(value) for value in expected)
    raise ButterClawBridgeError(
        f"Invalid usage for /{command_name}. Expected {expected_text} argument(s), got {actual}."
    )


def _parse_slash_command(text: str) -> ParsedButterClawSlashCommand | None:
    stripped = text.strip()
    if not stripped.startswith(BUTTERCLAW_SLASH_PREFIX):
        return None

    parts = [segment for segment in stripped.split() if segment]
    if not parts:
        raise ButterClawBridgeError("Empty ButterClaw slash command.")
    command_name = parts[0][1:].strip().lower()
    if not command_name:
        raise ButterClawBridgeError("Empty ButterClaw slash command.")

    if command_name == "stop":
        _require_argument_count(parts, command_name=command_name, expected=(BUTTERCLAW_STOP_REQUIRED_ARGUMENT_COUNT,))
        return ParsedButterClawSlashCommand(
            command_payload={"type": "stop"},
            timeout_seconds=BUTTERCLAW_DIRECT_COMMAND_DEFAULTS.stop_timeout_seconds,
        )

    if command_name == "status":
        _require_argument_count(parts, command_name=command_name, expected=(BUTTERCLAW_STATUS_REQUIRED_ARGUMENT_COUNT,))
        return ParsedButterClawSlashCommand(
            command_payload={"type": "status"},
            timeout_seconds=BUTTERCLAW_DIRECT_COMMAND_DEFAULTS.status_timeout_seconds,
        )

    if command_name == "scan":
        _require_argument_count(
            parts,
            command_name=command_name,
            expected=(BUTTERCLAW_SCAN_MIN_ARGUMENT_COUNT, *tuple(range(1, 32))),
        )
        target = stripped[len(f"{BUTTERCLAW_SLASH_PREFIX}{command_name}") :].strip()
        command_payload: dict[str, float | str] = {"type": "scan"}
        if target:
            command_payload["target"] = target
        return ParsedButterClawSlashCommand(
            command_payload=command_payload,
            timeout_seconds=BUTTERCLAW_DIRECT_COMMAND_DEFAULTS.scan_timeout_seconds,
        )

    if command_name == "rotate":
        _require_argument_count(
            parts,
            command_name=command_name,
            expected=(
                BUTTERCLAW_ROTATE_REQUIRED_ARGUMENT_COUNT,
                BUTTERCLAW_ROTATE_OPTIONAL_ARGUMENT_COUNT,
            ),
        )
        degrees = _parse_float_argument(parts[1], field_name="degrees")
        theta_vel = (
            _parse_float_argument(parts[2], field_name="theta_vel")
            if len(parts) > 2
            else BUTTERCLAW_DIRECT_COMMAND_DEFAULTS.rotate_theta_velocity_degrees_per_second
        )
        return ParsedButterClawSlashCommand(
            command_payload={"type": "rotate", "degrees": degrees, "theta_vel": theta_vel},
            timeout_seconds=BUTTERCLAW_DIRECT_COMMAND_DEFAULTS.rotate_timeout_seconds,
        )

    if command_name == "move":
        _require_argument_count(
            parts,
            command_name=command_name,
            expected=(
                BUTTERCLAW_MOVE_ARGUMENT_COUNT_WITHOUT_STRAFE,
                BUTTERCLAW_MOVE_ARGUMENT_COUNT_WITH_STRAFE,
            ),
        )
        x_vel = _parse_float_argument(parts[1], field_name="x_vel")
        if len(parts) - 1 == BUTTERCLAW_MOVE_ARGUMENT_COUNT_WITHOUT_STRAFE:
            y_vel = 0.0
            duration_s = _parse_float_argument(parts[2], field_name="duration_s")
        else:
            y_vel = _parse_float_argument(parts[2], field_name="y_vel")
            duration_s = _parse_float_argument(parts[3], field_name="duration_s")
        return ParsedButterClawSlashCommand(
            command_payload={
                "type": "move",
                "x_vel": x_vel,
                "y_vel": y_vel,
                "duration_s": duration_s,
            },
            timeout_seconds=max(
                duration_s + BUTTERCLAW_DIRECT_COMMAND_DEFAULTS.motion_timeout_padding_seconds,
                BUTTERCLAW_DIRECT_COMMAND_DEFAULTS.move_timeout_seconds,
            ),
        )

    if command_name == "strafe":
        _require_argument_count(parts, command_name=command_name, expected=(BUTTERCLAW_STRAFE_REQUIRED_ARGUMENT_COUNT,))
        y_vel = _parse_float_argument(parts[1], field_name="y_vel")
        duration_s = _parse_float_argument(parts[2], field_name="duration_s")
        return ParsedButterClawSlashCommand(
            command_payload={
                "type": "move",
                "x_vel": 0.0,
                "y_vel": y_vel,
                "duration_s": duration_s,
            },
            timeout_seconds=max(
                duration_s + BUTTERCLAW_DIRECT_COMMAND_DEFAULTS.motion_timeout_padding_seconds,
                BUTTERCLAW_DIRECT_COMMAND_DEFAULTS.move_timeout_seconds,
            ),
        )

    raise ButterClawBridgeError(
        f"Unsupported ButterClaw slash command '/{command_name}'. "
        "Supported commands: /move, /strafe, /rotate, /stop, /status, /scan."
    )


class ButterClawBridgeService:
    def __init__(
        self,
        *,
        repo_path: str,
        python_path: str,
        control_dir: str,
        runtime_root: str,
        robot_remote_ip: str,
        robot_id: str,
        robot_port_zmq_cmd: int,
        robot_port_zmq_observations: int,
        robot_use_ssh_tunnel: bool,
        robot_ssh_host: str,
        robot_ssh_user: str,
        robot_ssh_port: int,
        robot_ping_first: bool,
        robot_ping_count: int,
        robot_runtime_wait_timeout_seconds: int,
        robot_urdf_os_root: str,
        robot_urdf_os_python: str,
        timeout_seconds: int,
    ) -> None:
        self._repo_path = Path(repo_path)
        self._python_path = Path(python_path)
        self._control_dir = Path(control_dir)
        self._runtime_root = Path(runtime_root)
        self._runtime_demo_enabled = bool(settings.butterclaw_runtime_demo_enabled)
        self._robot_remote_ip = robot_remote_ip
        self._robot_id = robot_id
        self._robot_port_zmq_cmd = int(robot_port_zmq_cmd)
        self._robot_port_zmq_observations = int(robot_port_zmq_observations)
        self._robot_use_ssh_tunnel = bool(robot_use_ssh_tunnel)
        self._robot_ssh_host = robot_ssh_host
        self._robot_ssh_user = robot_ssh_user
        self._robot_ssh_port = int(robot_ssh_port)
        self._robot_ping_first = bool(robot_ping_first)
        self._robot_ping_count = int(robot_ping_count)
        self._robot_runtime_wait_timeout_seconds = int(robot_runtime_wait_timeout_seconds)
        self._robot_urdf_os_root = robot_urdf_os_root
        self._robot_urdf_os_python = robot_urdf_os_python
        self._timeout_seconds = int(timeout_seconds)

    def run_chat_command(self, request: ButterClawChatRequest) -> ButterClawChatResponse:
        if not self._runtime_demo_enabled:
            _require_trusted_robot(request.robot_id)

        if not self._repo_path.exists():
            raise ButterClawBridgeError(f"ButterClaw repo not found: {self._repo_path}")
        if not self._python_path.exists():
            raise ButterClawBridgeError(f"ButterClaw Python not found: {self._python_path}")

        slash_command = _parse_slash_command(request.text)
        if slash_command is not None:
            return self._run_direct_command(request, slash_command)
        return self._run_planner_command(request)

    def _run_planner_command(self, request: ButterClawChatRequest) -> ButterClawChatResponse:
        command = [
            str(self._python_path),
            str(_runner_script_path()),
            "--mode",
            "planner",
            "--repo",
            str(self._repo_path),
            "--control-dir",
            str(self._control_dir),
            "--text",
            request.text,
        ]
        return self._run_runner_command(
            command,
            request=request,
            timeout_seconds=float(self._timeout_seconds),
        )

    def _run_direct_command(
        self,
        request: ButterClawChatRequest,
        slash_command: ParsedButterClawSlashCommand,
    ) -> ButterClawChatResponse:
        command = [
            str(self._python_path),
            str(_runner_script_path()),
            "--mode",
            "direct",
            "--repo",
            str(self._repo_path),
            "--control-dir",
            str(self._control_dir),
            "--command-json",
            json.dumps(slash_command.command_payload),
            "--timeout-s",
            str(slash_command.timeout_seconds),
            "--runtime-demo-enabled" if self._runtime_demo_enabled else "--no-runtime-demo-enabled",
            "--runtime-root",
            str(self._runtime_root),
            "--remote-ip",
            self._robot_remote_ip,
            "--robot-id",
            self._robot_id,
            "--port-zmq-cmd",
            str(self._robot_port_zmq_cmd),
            "--port-zmq-observations",
            str(self._robot_port_zmq_observations),
            "--ssh-port",
            str(self._robot_ssh_port),
            "--ping-count",
            str(self._robot_ping_count),
            "--wait-timeout-s",
            str(self._robot_runtime_wait_timeout_seconds),
        ]
        if self._robot_urdf_os_root.strip():
            command.extend(["--urdf-os-root", self._robot_urdf_os_root])
        if self._robot_urdf_os_python.strip():
            command.extend(["--urdf-os-python", self._robot_urdf_os_python])
        command.append("--use-ssh-tunnel" if self._robot_use_ssh_tunnel else "--no-use-ssh-tunnel")
        command.append("--ping-first" if self._robot_ping_first else "--no-ping-first")
        if self._robot_ssh_host.strip():
            command.extend(["--ssh-host", self._robot_ssh_host])
        if self._robot_ssh_user.strip():
            command.extend(["--ssh-user", self._robot_ssh_user])
        return self._run_runner_command(
            command,
            request=request,
            timeout_seconds=slash_command.timeout_seconds,
        )

    def _run_runner_command(
        self,
        command: list[str],
        *,
        request: ButterClawChatRequest,
        timeout_seconds: float,
    ) -> ButterClawChatResponse:
        try:
            completed = subprocess.run(
                command,
                cwd=str(self._repo_path),
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                check=True,
            )
        except subprocess.TimeoutExpired as exc:
            raise ButterClawBridgeError("ButterClaw command timed out.") from exc
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or exc.stdout or "").strip() or "ButterClaw command failed."
            raise ButterClawBridgeError(detail) from exc

        try:
            payload = json.loads(completed.stdout)
        except json.JSONDecodeError as exc:
            raise ButterClawBridgeError("ButterClaw bridge returned invalid JSON.") from exc

        return ButterClawChatResponse(
            robot_id=request.robot_id,
            accepted=bool(payload.get("accepted", True)),
            messages=[
                str(message)
                for message in payload.get("messages", [])
                if isinstance(message, str) and message.strip()
            ],
            raw_text=str(payload.get("raw_text", "")).strip(),
        )


butterclaw_bridge_service = ButterClawBridgeService(
    repo_path=settings.butterclaw_repo_path,
    python_path=settings.butterclaw_python_path,
    control_dir=settings.butterclaw_runtime_control_dir,
    runtime_root=settings.butterclaw_robot_runtime_root,
    robot_remote_ip=settings.butterclaw_robot_remote_ip,
    robot_id=settings.butterclaw_robot_id,
    robot_port_zmq_cmd=settings.butterclaw_robot_port_zmq_cmd,
    robot_port_zmq_observations=settings.butterclaw_robot_port_zmq_observations,
    robot_use_ssh_tunnel=settings.butterclaw_robot_use_ssh_tunnel,
    robot_ssh_host=settings.butterclaw_robot_ssh_host,
    robot_ssh_user=settings.butterclaw_robot_ssh_user,
    robot_ssh_port=settings.butterclaw_robot_ssh_port,
    robot_ping_first=settings.butterclaw_robot_ping_first,
    robot_ping_count=settings.butterclaw_robot_ping_count,
    robot_runtime_wait_timeout_seconds=settings.butterclaw_robot_runtime_wait_timeout_seconds,
    robot_urdf_os_root=settings.butterclaw_robot_urdf_os_root,
    robot_urdf_os_python=settings.butterclaw_robot_urdf_os_python,
    timeout_seconds=settings.butterclaw_command_timeout_seconds,
)
