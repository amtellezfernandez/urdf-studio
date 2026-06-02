from __future__ import annotations

from pathlib import Path

from backend.models.robot_gateway import RobotGatewayEnvConfigOpenResult
from backend.robot_gateway.config_file import open_robot_gateway_local_file
from backend.robot_gateway.lerobot_calibration_catalog import (
    RobotGatewayLeRobotCalibrationFileSyncResult,
    RobotGatewayLeRobotCalibrationSource,
)
from backend.robot_gateway.lerobot_calibration_files import (
    read_lerobot_calibration_groups,
)


def open_lerobot_calibration_file(
    source: RobotGatewayLeRobotCalibrationSource,
) -> RobotGatewayEnvConfigOpenResult:
    calibration_path = resolve_lerobot_calibration_path(source)
    return open_robot_gateway_local_file(
        calibration_path,
        success_message="Opened LeRobot calibration file.",
        fallback_message=f"Open {calibration_path} on the robot gateway machine.",
    )


def stat_lerobot_calibration_file(
    source: RobotGatewayLeRobotCalibrationSource,
    *,
    last_mtime_ns: int | None = None,
    applied: bool = False,
    message: str = "",
) -> RobotGatewayLeRobotCalibrationFileSyncResult:
    calibration_path = resolve_lerobot_calibration_path(source)
    mtime_ns = calibration_path.stat().st_mtime_ns
    (
        joint_names,
        motor_ids,
        zero_positions_rad,
    ) = read_selected_lerobot_calibration_group(calibration_path, source.group_id)
    return RobotGatewayLeRobotCalibrationFileSyncResult(
        path=str(calibration_path),
        exists=True,
        mtimeNs=mtime_ns,
        jointNames=joint_names,
        motorIds=motor_ids,
        zeroPositionsRad=zero_positions_rad,
        changed=last_mtime_ns is not None and mtime_ns != last_mtime_ns,
        applied=applied,
        message=message,
    )


def read_selected_lerobot_calibration_group(
    calibration_path: Path,
    group_id: str,
) -> tuple[list[str], list[int], dict[str, float]]:
    for group in read_lerobot_calibration_groups(calibration_path):
        if group.group_id == group_id:
            return (
                list(group.joint_names),
                list(group.motor_ids),
                group.zero_positions_rad,
            )
    return [], [], {}


def resolve_lerobot_calibration_path(
    source: RobotGatewayLeRobotCalibrationSource,
) -> Path:
    calibration_dir = Path(source.calibration_dir).expanduser()
    calibration_id = source.calibration_id.strip()
    if not calibration_id:
        raise ValueError("Calibration id is required.")
    calibration_path = (calibration_dir / f"{calibration_id}.json").resolve()
    resolved_dir = calibration_dir.resolve()
    if calibration_path.parent != resolved_dir:
        raise ValueError("Calibration path must stay inside the calibration directory.")
    if not calibration_path.is_file():
        raise FileNotFoundError(f"Calibration file not found: {calibration_path}")
    return calibration_path
