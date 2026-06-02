from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.robot_gateway.params import (
    ROBOT_GATEWAY_LEROBOT_CALIBRATION_ROOT_DEFAULT,
    ROBOT_GATEWAY_LEROBOT_ROBOT_CALIBRATION_RELATIVE_DIR,
    ROBOT_GATEWAY_LEROBOT_TELEOPERATOR_CALIBRATION_RELATIVE_DIR,
)
from backend.robot_gateway.lerobot_calibration_files import (
    read_lerobot_calibration_groups,
)


class RobotGatewayLeRobotCalibrationSource(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    category: str = Field(..., min_length=1)
    profile_id: str = Field(..., min_length=1, alias="profileId")
    calibration_id: str = Field(..., min_length=1, alias="calibrationId")
    calibration_dir: str = Field(..., min_length=1, alias="calibrationDir")
    group_id: str = Field(default="all", min_length=1, alias="groupId")


class RobotGatewayLeRobotCalibrationCatalogEntry(
    RobotGatewayLeRobotCalibrationSource
):
    id: str = Field(..., min_length=1)
    path: str = Field(..., min_length=1)
    joint_names: list[str] = Field(default_factory=list, alias="jointNames")
    motor_ids: list[int] = Field(default_factory=list, alias="motorIds")
    zero_positions_rad: dict[str, float] = Field(
        default_factory=dict,
        alias="zeroPositionsRad",
    )
    actuator_count: int = Field(default=0, ge=0, alias="actuatorCount")


class RobotGatewayLeRobotCalibrationCatalog(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    entries: list[RobotGatewayLeRobotCalibrationCatalogEntry] = Field(
        default_factory=list
    )
    active_source: RobotGatewayLeRobotCalibrationSource | None = Field(
        default=None,
        alias="activeSource",
    )


class RobotGatewayLeRobotCalibrationStartRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    calibration_source: RobotGatewayLeRobotCalibrationSource | None = Field(
        default=None,
        alias="calibrationSource",
    )


class RobotGatewayLeRobotCalibrationFileSyncRequest(
    RobotGatewayLeRobotCalibrationStartRequest
):
    role: Literal["leader", "follower"]
    last_mtime_ns: int | None = Field(default=None, alias="lastMtimeNs")
    leader_port: str | None = Field(default=None, alias="leaderPort")
    leader_motor_ids: list[int] = Field(default_factory=list, alias="leaderMotorIds")
    leader_motor_model: str | None = Field(default=None, alias="leaderMotorModel")


class RobotGatewayLeRobotCalibrationFileSyncResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    path: str = Field(..., min_length=1)
    exists: bool = False
    mtime_ns: int = Field(default=0, ge=0, alias="mtimeNs")
    joint_names: list[str] = Field(default_factory=list, alias="jointNames")
    motor_ids: list[int] = Field(default_factory=list, alias="motorIds")
    zero_positions_rad: dict[str, float] = Field(
        default_factory=dict,
        alias="zeroPositionsRad",
    )
    changed: bool = False
    applied: bool = False
    message: str = ""


def list_lerobot_calibration_catalog(
    *,
    extra_calibration_dirs: list[Path] | None = None,
    active_source: RobotGatewayLeRobotCalibrationSource | None = None,
) -> RobotGatewayLeRobotCalibrationCatalog:
    calibration_root = Path(
        ROBOT_GATEWAY_LEROBOT_CALIBRATION_ROOT_DEFAULT
    ).expanduser()
    entries_by_key: dict[
        tuple[Path, str],
        RobotGatewayLeRobotCalibrationCatalogEntry,
    ] = {}

    for category, profile_dir in _iter_lerobot_profile_dirs(calibration_root):
        for calibration_path in sorted(profile_dir.glob("*.json")):
            _add_catalog_entries(
                entries_by_key,
                calibration_path,
                category=category,
                profile_id=profile_dir.name,
            )

    for calibration_dir in extra_calibration_dirs or []:
        resolved_dir = calibration_dir.expanduser()
        for calibration_path in sorted(resolved_dir.glob("*.json")):
            _add_catalog_entries(
                entries_by_key,
                calibration_path,
                category=ROBOT_GATEWAY_LEROBOT_ROBOT_CALIBRATION_RELATIVE_DIR,
                profile_id=resolved_dir.name,
            )

    return RobotGatewayLeRobotCalibrationCatalog(
        activeSource=active_source,
        entries=sorted(
            entries_by_key.values(),
            key=lambda entry: (
                entry.category != ROBOT_GATEWAY_LEROBOT_ROBOT_CALIBRATION_RELATIVE_DIR,
                entry.profile_id,
                entry.calibration_id,
                entry.group_id,
                entry.path,
            ),
        )
    )


def _iter_lerobot_profile_dirs(calibration_root: Path) -> list[tuple[str, Path]]:
    profile_dirs: list[tuple[str, Path]] = []
    for category in (
        ROBOT_GATEWAY_LEROBOT_ROBOT_CALIBRATION_RELATIVE_DIR,
        ROBOT_GATEWAY_LEROBOT_TELEOPERATOR_CALIBRATION_RELATIVE_DIR,
    ):
        category_dir = calibration_root / category
        if not category_dir.is_dir():
            continue
        profile_dirs.extend(
            (category, profile_dir)
            for profile_dir in sorted(category_dir.iterdir())
            if profile_dir.is_dir()
        )
    return profile_dirs


def _add_catalog_entries(
    entries_by_key: dict[tuple[Path, str], RobotGatewayLeRobotCalibrationCatalogEntry],
    calibration_path: Path,
    *,
    category: str,
    profile_id: str,
) -> None:
    resolved_path = calibration_path.resolve()
    for group in read_lerobot_calibration_groups(calibration_path):
        calibration_id = calibration_path.stem
        entry = RobotGatewayLeRobotCalibrationCatalogEntry(
            id=":".join((category, profile_id, calibration_id, group.group_id)),
            category=category,
            profileId=profile_id,
            calibrationId=calibration_id,
            calibrationDir=str(calibration_path.parent),
            groupId=group.group_id,
            path=str(calibration_path),
            jointNames=list(group.joint_names),
            motorIds=list(group.motor_ids),
            zeroPositionsRad=group.zero_positions_rad,
            actuatorCount=len(group.motor_ids),
        )
        entries_by_key[(resolved_path, group.group_id)] = entry
