from __future__ import annotations

import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

from backend.core.paths import BASE_DIR
from backend.models.robot_gateway import (
    RobotGatewayConnectionMode,
    RobotGatewayEnvConfigFile,
    RobotGatewayEnvConfigOpenResult,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_DIRECT_LOCAL_CONNECTION_ID,
    ROBOT_GATEWAY_DIRECT_LOCAL_CONNECTION_LABEL,
    ROBOT_GATEWAY_DIRECT_LOCAL_CONNECTION_SUMMARY,
    ROBOT_GATEWAY_ENV_CONFIG_ROBOT_DIRNAME,
    ROBOT_GATEWAY_ENV_CONFIG_ROBOT_FILE_SUFFIX,
    ROBOT_GATEWAY_ENV_CONFIG_FILENAME,
    ROBOT_GATEWAY_ENV_FILE_ENV,
    ROBOT_GATEWAY_ENV_SELECTOR_ENV,
)

ROBOT_GATEWAY_ENV_CONFIG_TEMPLATE = f"""# URDF Studio robot gateway private config.
# This file stays on the robot host and is ignored by git.
#
# Keep only shared local workstation defaults here. Put physical robot ports,
# HIDs, CAN channels, calibration files, and per-unit ids in one file per robot:
#
#   {ROBOT_GATEWAY_ENV_CONFIG_ROBOT_DIRNAME}/openarm-a.env
#   {ROBOT_GATEWAY_ENV_CONFIG_ROBOT_DIRNAME}/so100-left-1.env
#   {ROBOT_GATEWAY_ENV_CONFIG_ROBOT_DIRNAME}/so100-left-2.env
#
# For one default gateway process, select a robot overlay here:
#
#   {ROBOT_GATEWAY_ENV_SELECTOR_ENV}=openarm-a
#
# For concurrent gateways, do not edit/comment this file. Start one process per
# robot; the launcher selects the robot overlay and auto-picks free ports:
#
#   npm run start -- --robot openarm-a
#   npm run start -- --robot so100-left-1
#   npm run start -- --robot so100-left-2
#
# Or point a process at an explicit relative robot file:
#
#   npm run start -- --robot-env-file {ROBOT_GATEWAY_ENV_CONFIG_ROBOT_DIRNAME}/openarm-a.env
#
# Shared defaults:
URDF_ROBOT_GATEWAY_RUNTIME_MODE=observe

# OpenArm follower example ({ROBOT_GATEWAY_ENV_CONFIG_ROBOT_DIRNAME}/openarm-a.env):
# URDF_ROBOT_GATEWAY_ADAPTER=openarm_native
# URDF_ROBOT_GATEWAY_ROBOT_ID=openarm-a
# URDF_ROBOT_GATEWAY_OPENARM_CAN_INTERFACE=xoq
# URDF_ROBOT_GATEWAY_OPENARM_LEFT_PORT=<left-xoq-or-can-channel>
# URDF_ROBOT_GATEWAY_OPENARM_RIGHT_PORT=<right-xoq-or-can-channel>
# URDF_ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_FILE=<openarm-a-rotation-calibration.json>

# SO100 / LeRobot follower example ({ROBOT_GATEWAY_ENV_CONFIG_ROBOT_DIRNAME}/so100-left-1.env):
# URDF_ROBOT_GATEWAY_ADAPTER=lerobot
# URDF_ROBOT_GATEWAY_ROBOT_ID=so100-left-1
# URDF_ROBOT_GATEWAY_LEROBOT_ROBOT_TYPE=so100_follower
# URDF_ROBOT_GATEWAY_LEROBOT_PORT=<serial-port-or-hid>
# URDF_ROBOT_GATEWAY_LEROBOT_ID=so100-left-1
# URDF_ROBOT_GATEWAY_LEROBOT_CALIBRATION_DIR=<lerobot-calibration-dir>

# SO-101 native Feetech leader mirror example ({ROBOT_GATEWAY_ENV_CONFIG_ROBOT_DIRNAME}/so101-leader.env):
# URDF_ROBOT_GATEWAY_ADAPTER=feetech_so101
# URDF_ROBOT_GATEWAY_ROBOT_ID=so101-leader
# URDF_ROBOT_GATEWAY_MODEL_ID=so101
# URDF_ROBOT_GATEWAY_FEETECH_PORT=<serial-port>
# URDF_ROBOT_GATEWAY_FEETECH_CALIBRATION=<urdf-studio-teleop-calibration.json>

# Keep shared operator tokens and relay credentials private to this machine:
# URDF_SIMULATOR_API_TOKEN=<private-operator-api-token>
"""

ROBOT_GATEWAY_ROBOT_ENV_CONFIG_TEMPLATE = """# URDF Studio robot gateway per-robot private config.
# This file is selected by URDF_ROBOT_GATEWAY_ENV or URDF_ROBOT_GATEWAY_ENV_FILE.
# Put only the physical unit values here: ports, HIDs, CAN channels,
# calibration files, and per-robot ids.
#
# Example SO100 follower:
# URDF_ROBOT_GATEWAY_ADAPTER=lerobot
# URDF_ROBOT_GATEWAY_ROBOT_ID=so100-left-1
# URDF_ROBOT_GATEWAY_MODEL_ID=so100
# URDF_ROBOT_GATEWAY_MODEL_ALIASES=LeKiwi,so101
# URDF_ROBOT_GATEWAY_LEROBOT_ROBOT_TYPE=so100_follower
# URDF_ROBOT_GATEWAY_LEROBOT_PORT=<serial-port-or-hid>
# URDF_ROBOT_GATEWAY_LEROBOT_ID=so100-left-1
# URDF_ROBOT_GATEWAY_LEROBOT_CALIBRATION_DIR=<lerobot-calibration-dir>
#
# Example SO-101 native Feetech leader mirror:
# URDF_ROBOT_GATEWAY_ADAPTER=feetech_so101
# URDF_ROBOT_GATEWAY_ROBOT_ID=so101-leader
# URDF_ROBOT_GATEWAY_MODEL_ID=so101
# URDF_ROBOT_GATEWAY_FEETECH_PORT=<serial-port>
# URDF_ROBOT_GATEWAY_FEETECH_CALIBRATION=<urdf-studio-teleop-calibration.json>
"""

ROBOT_GATEWAY_LOCAL_FILE_EDITOR_COMMAND_PREFIXES = (
    ("cursor", "--reuse-window"),
    ("code", "--reuse-window"),
    ("codium", "--reuse-window"),
)


def resolve_robot_gateway_env_config_path() -> Path:
    return BASE_DIR / ROBOT_GATEWAY_ENV_CONFIG_FILENAME


def resolve_robot_gateway_robot_env_dir_path() -> Path:
    return BASE_DIR / ROBOT_GATEWAY_ENV_CONFIG_ROBOT_DIRNAME


def _normalize_robot_env_relative_path(value: str | None) -> Path | None:
    trimmed = (value or "").strip()
    if not trimmed:
        return None
    if "\\" in trimmed:
        return None
    path = Path(trimmed)
    if path.is_absolute() or any(part == ".." for part in path.parts):
        return None
    if not path.parts or path == Path("."):
        return None
    return path


def _normalize_robot_env_name(value: str | None) -> str | None:
    trimmed = (value or "").strip()
    if not trimmed or trimmed in {".", ".."}:
        return None
    if "/" in trimmed or "\\" in trimmed:
        return None
    return trimmed


def resolve_robot_gateway_selected_env_config_path() -> Path | None:
    explicit_file = _normalize_robot_env_relative_path(
        os.getenv(ROBOT_GATEWAY_ENV_FILE_ENV)
    )
    if explicit_file is not None:
        return BASE_DIR / explicit_file

    selected_robot = _normalize_robot_env_name(os.getenv(ROBOT_GATEWAY_ENV_SELECTOR_ENV))
    if selected_robot is None:
        return None
    filename = (
        selected_robot
        if selected_robot.endswith(ROBOT_GATEWAY_ENV_CONFIG_ROBOT_FILE_SUFFIX)
        else f"{selected_robot}{ROBOT_GATEWAY_ENV_CONFIG_ROBOT_FILE_SUFFIX}"
    )
    return resolve_robot_gateway_robot_env_dir_path() / filename


def resolve_robot_gateway_active_env_config_path() -> Path:
    return (
        resolve_robot_gateway_selected_env_config_path()
        or resolve_robot_gateway_env_config_path()
    )


def ensure_robot_gateway_base_env_config_file() -> Path:
    path = resolve_robot_gateway_env_config_path()
    resolve_robot_gateway_robot_env_dir_path().mkdir(exist_ok=True)
    if not path.exists():
        path.write_text(ROBOT_GATEWAY_ENV_CONFIG_TEMPLATE, encoding="utf-8")
    return path


def ensure_robot_gateway_env_config_file() -> Path:
    ensure_robot_gateway_base_env_config_file()
    path = resolve_robot_gateway_active_env_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        template = (
            ROBOT_GATEWAY_ENV_CONFIG_TEMPLATE
            if path == resolve_robot_gateway_env_config_path()
            else ROBOT_GATEWAY_ROBOT_ENV_CONFIG_TEMPLATE
        )
        path.write_text(template, encoding="utf-8")
    return path


def read_robot_gateway_env_config_file() -> RobotGatewayEnvConfigFile:
    path = ensure_robot_gateway_env_config_file()
    return RobotGatewayEnvConfigFile(
        path=str(path),
        content=path.read_text(encoding="utf-8"),
        exists=True,
    )


def write_robot_gateway_env_config_file(content: str) -> RobotGatewayEnvConfigFile:
    ensure_robot_gateway_base_env_config_file()
    path = resolve_robot_gateway_active_env_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return RobotGatewayEnvConfigFile(path=str(path), content=content, exists=True)


def open_robot_gateway_env_config_file() -> RobotGatewayEnvConfigOpenResult:
    path = ensure_robot_gateway_env_config_file()
    return open_robot_gateway_local_file(
        path,
        success_message="Opened robot gateway env file.",
        fallback_message=f"Open {path} on the robot gateway machine.",
    )


def open_robot_gateway_local_file(
    path: Path,
    *,
    success_message: str,
    fallback_message: str,
) -> RobotGatewayEnvConfigOpenResult:
    try:
        if os.name == "nt":
            os.startfile(str(path))  # type: ignore[attr-defined]
        else:
            command = _build_robot_gateway_local_file_open_command(path)
            subprocess.Popen(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
    except OSError:
        return RobotGatewayEnvConfigOpenResult(
            path=str(path),
            exists=path.exists(),
            opened=False,
            message=fallback_message,
        )
    return RobotGatewayEnvConfigOpenResult(
        path=str(path),
        exists=path.exists(),
        opened=True,
        message=success_message,
    )


def _build_robot_gateway_local_file_open_command(path: Path) -> list[str]:
    for command_prefix in _iter_robot_gateway_editor_command_prefixes():
        executable = command_prefix[0]
        if shutil.which(executable):
            return [*command_prefix, str(path)]
    return (
        ["open", str(path)]
        if sys.platform == "darwin"
        else ["xdg-open", str(path)]
    )


def _iter_robot_gateway_editor_command_prefixes() -> tuple[tuple[str, ...], ...]:
    env_commands = tuple(
        command
        for command in (
            _parse_robot_gateway_editor_env(os.getenv("VISUAL")),
            _parse_robot_gateway_editor_env(os.getenv("EDITOR")),
        )
        if command is not None
    )
    return (*ROBOT_GATEWAY_LOCAL_FILE_EDITOR_COMMAND_PREFIXES, *env_commands)


def _parse_robot_gateway_editor_env(value: str | None) -> tuple[str, ...] | None:
    if not value:
        return None
    try:
        parts = tuple(shlex.split(value))
    except ValueError:
        return None
    if not parts:
        return None
    executable = Path(parts[0]).name
    if executable not in {"cursor", "code", "codium"}:
        return None
    return parts


def build_robot_gateway_connection_modes() -> list[RobotGatewayConnectionMode]:
    config_ref = str(resolve_robot_gateway_active_env_config_path())
    return [
        RobotGatewayConnectionMode(
            id=ROBOT_GATEWAY_DIRECT_LOCAL_CONNECTION_ID,
            label=ROBOT_GATEWAY_DIRECT_LOCAL_CONNECTION_LABEL,
            summary=ROBOT_GATEWAY_DIRECT_LOCAL_CONNECTION_SUMMARY,
            config_ref=config_ref,
        ),
    ]
