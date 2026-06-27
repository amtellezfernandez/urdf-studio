from __future__ import annotations

import json
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
from typing import Any

from backend.core.paths import BASE_DIR
from backend.models.robot_gateway import RobotGatewayLeRobotCalibrationStartResult
from backend.robot_gateway.adapters import RobotGatewayAdapterConfig
from backend.robot_gateway.lerobot_calibration_catalog import (
    RobotGatewayLeRobotCalibrationSource,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
    ROBOT_GATEWAY_LEROBOT_CALIBRATE_BIN,
    ROBOT_GATEWAY_LEROBOT_CALIBRATION_DONE_MESSAGE,
    ROBOT_GATEWAY_LEROBOT_CALIBRATION_FAILED_MESSAGE,
    ROBOT_GATEWAY_LEROBOT_FIND_PORT_BIN,
    ROBOT_GATEWAY_LEROBOT_LEADER_CALIBRATION_DEFAULTS,
    ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE,
    ROBOT_GATEWAY_LEROBOT_VENV_DIR,
    ROBOT_GATEWAY_LEROBOT_VENV_ACTIVATE_RELATIVE_PATH,
    ROBOT_GATEWAY_LEROBOT_VENV_BIN_RELATIVE_DIR,
    ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_LEFT,
    ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT,
    ROBOT_GATEWAY_OPENARM_MINI_MOTOR_IDS,
    ROBOT_GATEWAY_OPENARM_MINI_MOTOR_MODEL,
)


def start_lerobot_calibration(
    config: RobotGatewayAdapterConfig,
    calibration_source: RobotGatewayLeRobotCalibrationSource | None = None,
) -> RobotGatewayLeRobotCalibrationStartResult:
    command = build_lerobot_calibration_command(
        config,
        calibration_source=calibration_source,
    )
    display_command = shlex.join(command)
    if config.adapter_kind != ROBOT_GATEWAY_LEROBOT_ADAPTER_ID:
        return RobotGatewayLeRobotCalibrationStartResult(
            started=False,
            command=command,
            display_command=display_command,
            message="LeRobot calibration is only available for LeRobot gateways.",
        )
    missing_port_message = _build_missing_lerobot_port_message(config.lerobot_port)
    if missing_port_message:
        return RobotGatewayLeRobotCalibrationStartResult(
            started=False,
            command=command,
            display_command=display_command,
            message=missing_port_message,
        )

    return _start_lerobot_calibration_command(command)


def start_lerobot_leader_calibration(
    *,
    port: str | None,
    port_left: str | None = None,
    port_right: str | None = None,
    motor_ids: list[int] | None = None,
    motor_model: str | None = None,
    calibration_profile: str | None = None,
    calibration_id: str | None = None,
    calibration_group: str | None = None,
) -> RobotGatewayLeRobotCalibrationStartResult:
    normalized_port = port.strip() if port else ""
    if not normalized_port:
        return RobotGatewayLeRobotCalibrationStartResult(
            started=False,
            command=[],
            display_command="",
            message="Select a detected leader target before calibration.",
        )
    command = build_lerobot_leader_calibration_command(
        port=normalized_port,
        port_left=port_left,
        port_right=port_right,
        motor_ids=motor_ids,
        motor_model=motor_model,
        calibration_profile=calibration_profile,
        calibration_id=calibration_id,
        calibration_group=calibration_group,
    )
    return _start_lerobot_calibration_command(command)


def build_lerobot_calibration_command(
    config: RobotGatewayAdapterConfig,
    calibration_source: RobotGatewayLeRobotCalibrationSource | None = None,
) -> list[str]:
    command = [_resolve_lerobot_calibrate_bin()]
    if config.lerobot_robot_type:
        command.append(f"--robot.type={config.lerobot_robot_type}")
    if config.lerobot_port:
        command.append(f"--robot.port={config.lerobot_port}")
    calibration_id = (
        calibration_source.calibration_id
        if calibration_source is not None
        else config.lerobot_id or config.robot_id
    )
    calibration_dir = (
        calibration_source.calibration_dir
        if calibration_source is not None
        else config.lerobot_calibration_dir
    )
    if calibration_id:
        command.append(f"--robot.id={calibration_id}")
    if calibration_dir is not None:
        command.append(f"--robot.calibration_dir={calibration_dir}")
    command.extend(_build_config_json_args(config.lerobot_config_json))
    return command


def build_lerobot_leader_calibration_command(
    *,
    port: str,
    port_left: str | None = None,
    port_right: str | None = None,
    motor_ids: list[int] | None = None,
    motor_model: str | None = None,
    calibration_profile: str | None = None,
    calibration_id: str | None = None,
    calibration_group: str | None = None,
) -> list[str]:
    teleop_type = _resolve_lerobot_leader_teleop_type(
        calibration_profile=calibration_profile,
        motor_ids=motor_ids,
        motor_model=motor_model,
    )
    command = [
        _resolve_lerobot_calibrate_bin(),
        f"--teleop.type={teleop_type}",
    ]
    if teleop_type == ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE:
        left_port, right_port = _resolve_openarm_mini_leader_calibration_ports(
            selected_port=port,
            selected_group=calibration_group,
            port_left=port_left,
            port_right=port_right,
        )
        command.extend(
            (
                f"--teleop.port_right={right_port}",
                f"--teleop.port_left={left_port}",
            )
        )
    else:
        command.append(f"--teleop.port={port}")
    command.append(
        f"--teleop.id={_resolve_lerobot_leader_calibration_id(port, calibration_id)}"
    )
    return command


def _start_lerobot_calibration_command(
    command: list[str],
) -> RobotGatewayLeRobotCalibrationStartResult:
    display_command = shlex.join(command)
    terminal_command = _build_terminal_command(display_command)
    if terminal_command is None:
        return RobotGatewayLeRobotCalibrationStartResult(
            started=False,
            command=command,
            display_command=display_command,
            message="Open a terminal on the robot gateway machine and run this command.",
        )

    try:
        subprocess.Popen(
            terminal_command,
            cwd=BASE_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        return RobotGatewayLeRobotCalibrationStartResult(
            started=False,
            command=command,
            display_command=display_command,
            message="Open a terminal on the robot gateway machine and run this command.",
        )
    return RobotGatewayLeRobotCalibrationStartResult(
        started=True,
        command=command,
        display_command=display_command,
        message="Opened LeRobot calibration in a terminal.",
    )


def _resolve_lerobot_leader_teleop_type(
    *,
    calibration_profile: str | None,
    motor_ids: list[int] | None,
    motor_model: str | None,
) -> str:
    profile = calibration_profile.strip() if calibration_profile else ""
    defaults = ROBOT_GATEWAY_LEROBOT_LEADER_CALIBRATION_DEFAULTS
    if profile == ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE:
        return profile
    if profile.endswith(defaults.leader_type_suffix):
        return profile
    if profile.endswith(defaults.follower_type_suffix):
        return (
            profile[: -len(defaults.follower_type_suffix)]
            + defaults.leader_type_suffix
        )
    if _is_openarm_mini_leader_candidate(motor_ids, motor_model):
        return ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE
    if motor_model or motor_ids:
        return defaults.fallback_teleop_type
    return defaults.fallback_teleop_type


def _is_openarm_mini_leader_candidate(
    motor_ids: list[int] | None,
    motor_model: str | None,
) -> bool:
    normalized_motor_ids = tuple(sorted(set(motor_ids or [])))
    normalized_motor_model = motor_model.strip().lower() if motor_model else ""
    return (
        normalized_motor_ids == ROBOT_GATEWAY_OPENARM_MINI_MOTOR_IDS
        and (
            not normalized_motor_model
            or normalized_motor_model == ROBOT_GATEWAY_OPENARM_MINI_MOTOR_MODEL
        )
    )


def _resolve_openarm_mini_leader_calibration_ports(
    *,
    selected_port: str,
    selected_group: str | None,
    port_left: str | None,
    port_right: str | None,
) -> tuple[str, str]:
    normalized_left_port = port_left.strip() if port_left else ""
    normalized_right_port = port_right.strip() if port_right else ""
    normalized_group = selected_group.strip().lower() if selected_group else ""
    if normalized_group == ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_LEFT:
        normalized_left_port = normalized_left_port or selected_port
    elif normalized_group == ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT:
        normalized_right_port = normalized_right_port or selected_port
    elif not normalized_left_port and not normalized_right_port:
        normalized_right_port = selected_port
    return (
        normalized_left_port or selected_port,
        normalized_right_port or selected_port,
    )


def _resolve_lerobot_leader_calibration_id(
    port: str,
    calibration_id: str | None,
) -> str:
    normalized_calibration_id = calibration_id.strip() if calibration_id else ""
    if normalized_calibration_id:
        return normalized_calibration_id
    port_name = Path(port).name
    normalized_port_name = "".join(
        char if char.isalnum() or char in ("_", "-", ".") else "_"
        for char in port_name
    ).strip("_.-")
    defaults = ROBOT_GATEWAY_LEROBOT_LEADER_CALIBRATION_DEFAULTS
    if not normalized_port_name:
        return defaults.fallback_id_prefix
    return f"{defaults.fallback_id_prefix}_{normalized_port_name}"


def _resolve_lerobot_calibrate_bin() -> str:
    script_path = (
        BASE_DIR
        / ROBOT_GATEWAY_LEROBOT_VENV_BIN_RELATIVE_DIR
        / ROBOT_GATEWAY_LEROBOT_CALIBRATE_BIN
    )
    if script_path.is_file():
        return str(script_path)
    return (
        shutil.which(ROBOT_GATEWAY_LEROBOT_CALIBRATE_BIN)
        or ROBOT_GATEWAY_LEROBOT_CALIBRATE_BIN
    )


def _build_missing_lerobot_port_message(port: str | None) -> str:
    normalized_port = port.strip() if port else ""
    if not normalized_port:
        return ""
    port_path = Path(normalized_port)
    if not port_path.is_absolute() or port_path.exists():
        return ""
    return (
        f"Configured LeRobot port was not found: {normalized_port}. "
        "Reconnect the arm, then run "
        f"`{ROBOT_GATEWAY_LEROBOT_FIND_PORT_BIN}` and update "
        "URDF_ROBOT_GATEWAY_LEROBOT_PORT if the serial path changed."
    )


def _build_config_json_args(config_json: str | None) -> list[str]:
    if not config_json:
        return []
    try:
        payload = json.loads(config_json)
    except json.JSONDecodeError:
        return []
    if not isinstance(payload, dict):
        return []
    args: list[str] = []
    for key, value in sorted(payload.items()):
        if key in {"type", "id", "port", "calibration_dir"}:
            continue
        if isinstance(value, str | int | float | bool) or value is None:
            args.append(f"--robot.{key}={_format_draccus_cli_value(value)}")
        elif isinstance(value, list | dict):
            args.append(f"--robot.{key}={json.dumps(value, separators=(',', ':'))}")
    return args


def _format_draccus_cli_value(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def build_lerobot_calibration_terminal_script(display_command: str) -> str:
    commands = [f"cd {shlex.quote(str(BASE_DIR))}"]
    venv_activate = BASE_DIR / ROBOT_GATEWAY_LEROBOT_VENV_ACTIVATE_RELATIVE_PATH
    if venv_activate.is_file():
        commands.append(f". {shlex.quote(str(venv_activate))}")
    cmeel_lib_path = _resolve_lerobot_cmeel_lib_path()
    if cmeel_lib_path is not None:
        commands.append(
            "export "
            f"LD_LIBRARY_PATH={shlex.quote(str(cmeel_lib_path))}"
            "${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
        )
    commands.extend(
        [
            display_command,
            "status=$?",
            (
                "if [ \"$status\" -eq 0 ]; then "
                "printf '\\n%s\\n' "
                f"{shlex.quote(ROBOT_GATEWAY_LEROBOT_CALIBRATION_DONE_MESSAGE)}; "
                "else printf '\\nLeRobot calibration failed (exit %s). %s\\n' "
                f"\"$status\" {shlex.quote(ROBOT_GATEWAY_LEROBOT_CALIBRATION_FAILED_MESSAGE)}; "
                "fi"
            ),
            "read _",
            'exit "$status"',
        ]
    )
    return "; ".join(commands)


def _resolve_lerobot_cmeel_lib_path() -> Path | None:
    venv_lib_root = BASE_DIR / ROBOT_GATEWAY_LEROBOT_VENV_DIR / "lib"
    for cmeel_lib_path in sorted(
        venv_lib_root.glob("python*/site-packages/cmeel.prefix/lib")
    ):
        if cmeel_lib_path.is_dir():
            return cmeel_lib_path
    return None


def _build_terminal_command(display_command: str) -> list[str] | None:
    script = build_lerobot_calibration_terminal_script(display_command)
    if sys.platform == "darwin":
        open_bin = shutil.which("open")
        if open_bin is None:
            return None
        return [
            open_bin,
            "-a",
            "Terminal",
            "bash",
            "-lc",
            script,
        ]
    for terminal in (
        "x-terminal-emulator",
        "gnome-terminal",
        "konsole",
        "xfce4-terminal",
        "xterm",
    ):
        terminal_path = shutil.which(terminal)
        if terminal_path is None:
            continue
        if terminal == "gnome-terminal":
            return [terminal_path, "--", "bash", "-lc", script]
        if terminal == "konsole":
            return [terminal_path, "-e", "bash", "-lc", script]
        return [terminal_path, "-e", "bash", "-lc", script]
    return None
