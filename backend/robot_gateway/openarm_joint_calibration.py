from __future__ import annotations

from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
from typing import Mapping
import xml.etree.ElementTree as ET

from backend.robot_gateway.params import (
    ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_FILE_ENV,
    ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_IDENTITY_ID,
    ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_MISSING_JOINT_REASON_PREFIX,
    ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_NONFINITE_REASON_PREFIX,
    ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_REQUIRED_REASON,
    ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_SCHEMA_VERSION,
    ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_SOFT_LIMIT_REASON,
    ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_UNAVAILABLE_REASON_PREFIX,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_FINGER_NAME_TOKEN,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_URDF_REPO_RELATIVE_PATH,
)


@dataclass(frozen=True)
class OpenArmJointRotationCalibrationEntry:
    direction: int
    zero_offset_rad: float
    soft_min_rad: float | None = None
    soft_max_rad: float | None = None

    def model_from_hardware(self, hardware_position_rad: float) -> float:
        return self.direction * hardware_position_rad + self.zero_offset_rad

    def model_delta_from_hardware(self, hardware_delta_rad: float) -> float:
        return self.direction * hardware_delta_rad

    def hardware_from_model(self, model_position_rad: float) -> float:
        return self.direction * (model_position_rad - self.zero_offset_rad)


class RejectingOpenArmJointRotationCalibration:
    ready = False
    calibration_id: str | None = None

    def __init__(
        self,
        reason: str = ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_REQUIRED_REASON,
    ) -> None:
        self.reason = reason

    def model_from_hardware_positions(
        self,
        _hardware_positions_rad: Mapping[str, float],
    ) -> dict[str, float]:
        raise ValueError(self.reason)

    def hardware_from_model(self, _joint_name: str, _model_position_rad: float) -> float:
        raise ValueError(self.reason)

    def model_delta_from_hardware(self, _joint_name: str, _hardware_delta_rad: float) -> float:
        raise ValueError(self.reason)

    def validate_model_target(self, _joint_name: str, _model_position_rad: float) -> str:
        return self.reason


class OpenArmJointRotationCalibration:
    ready = True

    def __init__(
        self,
        *,
        calibration_id: str,
        joint_entries: Mapping[str, OpenArmJointRotationCalibrationEntry],
        required_joint_names: tuple[str, ...],
    ) -> None:
        self.calibration_id = calibration_id
        self._joint_entries = dict(joint_entries)
        self._required_joint_names = _filter_openarm_rotation_calibration_joint_names(
            required_joint_names
        )
        missing_joint_names = [
            joint_name
            for joint_name in self._required_joint_names
            if joint_name not in self._joint_entries
        ]
        if missing_joint_names:
            raise ValueError(
                f"{ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_MISSING_JOINT_REASON_PREFIX} "
                + ", ".join(missing_joint_names)
            )

    def model_from_hardware_positions(
        self,
        hardware_positions_rad: Mapping[str, float],
    ) -> dict[str, float]:
        positions: dict[str, float] = {}
        for joint_name, hardware_position_rad in hardware_positions_rad.items():
            if _is_openarm_finger_joint(joint_name):
                positions[joint_name] = hardware_position_rad
                continue
            entry = self._entry_for_joint(joint_name)
            if entry is None:
                raise ValueError(
                    f"{ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_MISSING_JOINT_REASON_PREFIX} "
                    f"{joint_name}"
                )
            hardware_position = float(hardware_position_rad)
            if not math.isfinite(hardware_position):
                raise ValueError(
                    f"{ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_NONFINITE_REASON_PREFIX} "
                    f"{joint_name}"
                )
            positions[joint_name] = entry.model_from_hardware(hardware_position)
        return positions

    def hardware_from_model(self, joint_name: str, model_position_rad: float) -> float:
        entry = self._entry_for_joint(joint_name)
        if entry is None:
            raise ValueError(
                f"{ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_MISSING_JOINT_REASON_PREFIX} "
                f"{joint_name}"
            )
        model_position = float(model_position_rad)
        if not math.isfinite(model_position):
            raise ValueError(
                f"{ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_NONFINITE_REASON_PREFIX} "
                f"{joint_name}"
            )
        return entry.hardware_from_model(model_position)

    def model_delta_from_hardware(
        self,
        joint_name: str,
        hardware_delta_rad: float,
    ) -> float:
        if _is_openarm_finger_joint(joint_name):
            return hardware_delta_rad
        entry = self._entry_for_joint(joint_name)
        if entry is None:
            raise ValueError(
                f"{ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_MISSING_JOINT_REASON_PREFIX} "
                f"{joint_name}"
            )
        hardware_delta = float(hardware_delta_rad)
        if not math.isfinite(hardware_delta):
            raise ValueError(
                f"{ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_NONFINITE_REASON_PREFIX} "
                f"{joint_name}"
            )
        return entry.model_delta_from_hardware(hardware_delta)

    def validate_model_target(
        self,
        joint_name: str,
        model_position_rad: float,
    ) -> str | None:
        entry = self._entry_for_joint(joint_name)
        if entry is None:
            return (
                f"{ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_MISSING_JOINT_REASON_PREFIX} "
                f"{joint_name}"
            )
        if not math.isfinite(model_position_rad):
            return (
                f"{ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_NONFINITE_REASON_PREFIX} "
                f"{joint_name}"
            )
        if entry.soft_min_rad is not None and model_position_rad < entry.soft_min_rad:
            return ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_SOFT_LIMIT_REASON
        if entry.soft_max_rad is not None and model_position_rad > entry.soft_max_rad:
            return ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_SOFT_LIMIT_REASON
        return None

    def _entry_for_joint(
        self,
        joint_name: str,
    ) -> OpenArmJointRotationCalibrationEntry | None:
        if _is_openarm_finger_joint(joint_name):
            return None
        return self._joint_entries.get(joint_name)


def build_identity_openarm_joint_rotation_calibration(
    joint_names: tuple[str, ...],
) -> OpenArmJointRotationCalibration:
    return OpenArmJointRotationCalibration(
        calibration_id=ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_IDENTITY_ID,
        required_joint_names=joint_names,
        joint_entries={
            joint_name: OpenArmJointRotationCalibrationEntry(
                direction=1,
                zero_offset_rad=0.0,
            )
            for joint_name in _filter_openarm_rotation_calibration_joint_names(
                joint_names
            )
        },
    )


def build_openarm_joint_rotation_calibration_from_env(
    joint_names: tuple[str, ...],
) -> OpenArmJointRotationCalibration | RejectingOpenArmJointRotationCalibration:
    raw_path = os.getenv(ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_FILE_ENV, "").strip()
    if not raw_path:
        return RejectingOpenArmJointRotationCalibration()
    try:
        return load_openarm_joint_rotation_calibration(
            Path(raw_path),
            required_joint_names=joint_names,
        )
    except Exception as exc:
        return RejectingOpenArmJointRotationCalibration(
            f"{ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_UNAVAILABLE_REASON_PREFIX} {exc}"
        )


def load_default_openarm_urdf_joint_limits(
    *,
    joint_names: tuple[str, ...],
) -> dict[str, tuple[float, float]]:
    return load_openarm_urdf_joint_limits(
        _default_repo_root().joinpath(
            *ROBOT_GATEWAY_OPENARM_SELF_COLLISION_URDF_REPO_RELATIVE_PATH
        ),
        joint_names=joint_names,
    )


def load_openarm_urdf_joint_limits(
    path: Path,
    *,
    joint_names: tuple[str, ...],
) -> dict[str, tuple[float, float]]:
    requested_joint_names = set(joint_names)
    limits_by_joint_name: dict[str, tuple[float, float]] = {}
    root = ET.parse(path).getroot()
    for joint_element in root.findall("joint"):
        joint_name = str(joint_element.get("name") or "").strip()
        if not joint_name or joint_name not in requested_joint_names:
            continue
        limit_element = joint_element.find("limit")
        if limit_element is None:
            continue
        raw_lower = limit_element.get("lower")
        raw_upper = limit_element.get("upper")
        if raw_lower is None or raw_upper is None:
            continue
        lower_rad = float(raw_lower)
        upper_rad = float(raw_upper)
        if (
            not math.isfinite(lower_rad)
            or not math.isfinite(upper_rad)
            or lower_rad >= upper_rad
        ):
            raise ValueError(f"invalid URDF joint limit for {joint_name}")
        limits_by_joint_name[joint_name] = (lower_rad, upper_rad)
    return limits_by_joint_name


def load_openarm_joint_rotation_calibration(
    path: Path,
    *,
    required_joint_names: tuple[str, ...],
) -> OpenArmJointRotationCalibration:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("calibration file must contain a JSON object")
    schema_version = str(payload.get("schema_version", "")).strip()
    if schema_version != ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_SCHEMA_VERSION:
        raise ValueError(
            "unsupported calibration schema_version "
            f"{schema_version!r}; expected "
            f"{ROBOT_GATEWAY_OPENARM_ROTATION_CALIBRATION_SCHEMA_VERSION!r}"
        )
    calibration_id = str(payload.get("calibration_id", "")).strip() or path.stem
    raw_joints = payload.get("joints")
    if not isinstance(raw_joints, dict):
        raise ValueError("calibration file must contain a joints object")
    joint_entries = {
        str(joint_name): _parse_openarm_joint_rotation_calibration_entry(
            str(joint_name),
            raw_entry,
        )
        for joint_name, raw_entry in raw_joints.items()
    }
    return OpenArmJointRotationCalibration(
        calibration_id=calibration_id,
        joint_entries=joint_entries,
        required_joint_names=required_joint_names,
    )


def _parse_openarm_joint_rotation_calibration_entry(
    joint_name: str,
    raw_entry: object,
) -> OpenArmJointRotationCalibrationEntry:
    if not isinstance(raw_entry, dict):
        raise ValueError(f"joint calibration for {joint_name} must be an object")
    direction = int(raw_entry.get("direction", 1))
    if direction not in {-1, 1}:
        raise ValueError(f"joint calibration direction for {joint_name} must be -1 or 1")
    zero_offset_rad = _read_optional_finite_float(
        raw_entry,
        "zero_offset_rad",
        default=0.0,
        joint_name=joint_name,
    )
    soft_min_rad = _read_optional_finite_float(
        raw_entry,
        "soft_min_rad",
        default=None,
        joint_name=joint_name,
    )
    soft_max_rad = _read_optional_finite_float(
        raw_entry,
        "soft_max_rad",
        default=None,
        joint_name=joint_name,
    )
    if (
        soft_min_rad is not None
        and soft_max_rad is not None
        and soft_min_rad >= soft_max_rad
    ):
        raise ValueError(f"joint calibration soft limits for {joint_name} are inverted")
    return OpenArmJointRotationCalibrationEntry(
        direction=direction,
        zero_offset_rad=zero_offset_rad,
        soft_min_rad=soft_min_rad,
        soft_max_rad=soft_max_rad,
    )


def _read_optional_finite_float(
    raw_entry: Mapping[str, object],
    key: str,
    *,
    default: float | None,
    joint_name: str,
) -> float | None:
    raw_value = raw_entry.get(key, default)
    if raw_value is None:
        return None
    value = float(raw_value)
    if not math.isfinite(value):
        raise ValueError(f"joint calibration {key} for {joint_name} must be finite")
    return value


def _filter_openarm_rotation_calibration_joint_names(
    joint_names: tuple[str, ...],
) -> tuple[str, ...]:
    return tuple(
        joint_name
        for joint_name in joint_names
        if not _is_openarm_finger_joint(joint_name)
    )


def _is_openarm_finger_joint(joint_name: str) -> bool:
    return ROBOT_GATEWAY_OPENARM_SELF_COLLISION_FINGER_NAME_TOKEN in joint_name


def _default_repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent
