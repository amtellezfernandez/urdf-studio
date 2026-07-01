from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.robot_gateway.params import (
    ROBOT_GATEWAY_FEETECH_TICKS_PER_REVOLUTION,
    ROBOT_GATEWAY_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
    ROBOT_GATEWAY_OPENARM_MINI_FEETECH_POSITION_MAX,
    ROBOT_GATEWAY_OPENARM_MINI_FEETECH_POSITION_MIN,
    ROBOT_GATEWAY_TELEOP_CALIBRATION_SCHEMA_VERSION,
)

TeleopCalibrationSourceUnit = Literal["rad", "deg", "ticks", "percent"]


class TeleopCalibrationLimit(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    lower_rad: float = Field(..., alias="lowerRad")
    upper_rad: float = Field(..., alias="upperRad")

    @field_validator("lower_rad", "upper_rad")
    @classmethod
    def _validate_finite_limit(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Calibration limits must be finite.")
        return value

    @model_validator(mode="after")
    def _validate_ordered_limits(self) -> "TeleopCalibrationLimit":
        if self.lower_rad >= self.upper_rad:
            raise ValueError("Calibration lower limit must be below upper limit.")
        return self


class TeleopCalibrationEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    motor_id: int = Field(..., gt=0, alias="motorId")
    joint_name: str = Field(..., min_length=1, alias="jointName")
    source_unit: TeleopCalibrationSourceUnit = Field(default="rad", alias="sourceUnit")
    zero_offset: float = Field(default=0.0, alias="zeroOffset")
    direction: Literal[-1, 1] = 1
    scale_to_rad: float = Field(default=1.0, alias="scaleToRad")
    model_zero_rad: float = Field(default=0.0, alias="modelZeroRad")
    limit: TeleopCalibrationLimit | None = None
    source: dict[str, object] = Field(default_factory=dict)

    @field_validator("joint_name")
    @classmethod
    def _validate_joint_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Calibration joint name must be non-empty.")
        return normalized

    @field_validator("zero_offset", "scale_to_rad", "model_zero_rad")
    @classmethod
    def _validate_finite_number(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Calibration numeric values must be finite.")
        return value

    @field_validator("scale_to_rad")
    @classmethod
    def _validate_nonzero_scale(cls, value: float) -> float:
        if value == 0.0:
            raise ValueError("Calibration scale_to_rad must be non-zero.")
        return value

    def model_position_from_source(self, source_position: float) -> float:
        if not math.isfinite(source_position):
            raise ValueError(
                f"Motor {self.motor_id} source position must be finite."
            )
        position_rad = self.model_zero_rad + (
            self.direction * (source_position - self.zero_offset) * self.scale_to_rad
        )
        self.validate_model_position(position_rad)
        return position_rad

    def source_position_from_model(self, model_position_rad: float) -> float:
        self.validate_model_position(model_position_rad)
        return self.zero_offset + (
            (model_position_rad - self.model_zero_rad)
            / (self.direction * self.scale_to_rad)
        )

    def validate_model_position(self, model_position_rad: float) -> None:
        if not math.isfinite(model_position_rad):
            raise ValueError(
                f"Model joint {self.joint_name!r} position must be finite."
            )
        if self.limit is None:
            return
        if (
            model_position_rad < self.limit.lower_rad
            or model_position_rad > self.limit.upper_rad
        ):
            raise ValueError(
                f"Model joint {self.joint_name!r} is outside calibration limits."
            )


class TeleopCalibration(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    schema_version: Literal["urdf-studio.teleop-calibration.v1"] = Field(
        default=ROBOT_GATEWAY_TELEOP_CALIBRATION_SCHEMA_VERSION,
        alias="schemaVersion",
    )
    robot_model_id: str = Field(..., min_length=1, alias="robotModelId")
    provider_family: str = Field(default="", alias="providerFamily")
    entries: list[TeleopCalibrationEntry] = Field(default_factory=list)
    source: dict[str, object] = Field(default_factory=dict)

    @field_validator("robot_model_id", mode="before")
    @classmethod
    def _strip_required_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("provider_family", mode="before")
    @classmethod
    def _strip_optional_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def _validate_unique_entries(self) -> "TeleopCalibration":
        motor_ids: set[int] = set()
        joint_names: set[str] = set()
        for entry in self.entries:
            if entry.motor_id in motor_ids:
                raise ValueError(f"Duplicate calibration motor id: {entry.motor_id}")
            if entry.joint_name in joint_names:
                raise ValueError(
                    f"Duplicate calibration joint name: {entry.joint_name}"
                )
            motor_ids.add(entry.motor_id)
            joint_names.add(entry.joint_name)
        return self

    @property
    def joint_names(self) -> tuple[str, ...]:
        return tuple(entry.joint_name for entry in self.entries)

    @property
    def motor_ids(self) -> tuple[int, ...]:
        return tuple(entry.motor_id for entry in self.entries)

    def model_positions_from_motor_positions(
        self,
        source_positions_by_motor_id: Mapping[int, float],
    ) -> dict[str, float]:
        positions: dict[str, float] = {}
        missing_motor_ids: list[int] = []
        for entry in self.entries:
            raw_position = source_positions_by_motor_id.get(entry.motor_id)
            if raw_position is None:
                missing_motor_ids.append(entry.motor_id)
                continue
            positions[entry.joint_name] = entry.model_position_from_source(
                float(raw_position)
            )
        if missing_motor_ids:
            raise ValueError(
                "Calibration motor ids missing from provider state: "
                + ", ".join(str(motor_id) for motor_id in missing_motor_ids)
            )
        return positions

    def source_positions_from_model_positions(
        self,
        model_positions_rad: Mapping[str, float],
    ) -> dict[int, float]:
        positions: dict[int, float] = {}
        missing_joint_names: list[str] = []
        for entry in self.entries:
            model_position_rad = model_positions_rad.get(entry.joint_name)
            if model_position_rad is None:
                missing_joint_names.append(entry.joint_name)
                continue
            positions[entry.motor_id] = entry.source_position_from_model(
                float(model_position_rad)
            )
        if missing_joint_names:
            raise ValueError(
                "Calibration joints missing from model state: "
                + ", ".join(missing_joint_names)
            )
        return positions


def load_teleop_calibration(path: Path) -> TeleopCalibration:
    payload = json.loads(path.expanduser().read_text(encoding="utf-8"))
    return parse_teleop_calibration(payload)


def parse_teleop_calibration(payload: object) -> TeleopCalibration:
    if not isinstance(payload, dict):
        raise ValueError("URDF Studio calibration payload must be an object.")
    return TeleopCalibration.model_validate(payload)


def teleop_calibration_to_json(calibration: TeleopCalibration) -> str:
    return json.dumps(
        calibration.model_dump(by_alias=True, mode="json"),
        indent=2,
        sort_keys=True,
    )


def import_lerobot_calibration_payload(
    payload: object,
    *,
    robot_model_id: str,
    provider_family: str = "feetech",
    source_label: str = "lerobot",
) -> TeleopCalibration:
    if not isinstance(payload, dict):
        raise ValueError("LeRobot calibration payload must be an object.")
    entries: list[TeleopCalibrationEntry] = []
    for raw_joint_name, raw_entry in payload.items():
        if not isinstance(raw_joint_name, str) or not isinstance(raw_entry, dict):
            continue
        joint_name = raw_joint_name.strip()
        motor_id = _parse_positive_int(raw_entry.get("id"))
        if not joint_name or motor_id is None:
            continue
        scale_to_rad = _feetech_ticks_to_radians_scale()
        range_min = _parse_int(
            raw_entry.get("range_min"),
            ROBOT_GATEWAY_OPENARM_MINI_FEETECH_POSITION_MIN,
        )
        range_max = _parse_int(
            raw_entry.get("range_max"),
            ROBOT_GATEWAY_OPENARM_MINI_FEETECH_POSITION_MAX,
        )
        limit = _build_raw_tick_limit(
            range_min=range_min,
            range_max=range_max,
            zero_offset=_parse_float(raw_entry.get("homing_offset"), 0.0),
            direction=_direction_from_lerobot_drive_mode(
                _parse_int(raw_entry.get("drive_mode"), 0)
            ),
            scale_to_rad=scale_to_rad,
        )
        entries.append(
            TeleopCalibrationEntry(
                motorId=motor_id,
                jointName=joint_name,
                sourceUnit="ticks",
                zeroOffset=_parse_float(raw_entry.get("homing_offset"), 0.0),
                direction=_direction_from_lerobot_drive_mode(
                    _parse_int(raw_entry.get("drive_mode"), 0)
                ),
                scaleToRad=scale_to_rad,
                modelZeroRad=ROBOT_GATEWAY_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
                limit=limit,
                source={"format": "lerobot", "payload": dict(raw_entry)},
            )
        )
    if not entries:
        raise ValueError("LeRobot calibration payload did not contain motor entries.")
    return TeleopCalibration(
        schemaVersion=ROBOT_GATEWAY_TELEOP_CALIBRATION_SCHEMA_VERSION,
        robotModelId=robot_model_id,
        providerFamily=provider_family,
        entries=entries,
        source={"format": source_label},
    )


def import_lerobot_calibration_file(
    path: Path,
    *,
    robot_model_id: str,
    provider_family: str = "feetech",
) -> TeleopCalibration:
    payload = json.loads(path.expanduser().read_text(encoding="utf-8"))
    return import_lerobot_calibration_payload(
        payload,
        robot_model_id=robot_model_id,
        provider_family=provider_family,
        source_label=f"lerobot:{path.expanduser()}",
    )


def export_lerobot_calibration_payload(
    calibration: TeleopCalibration,
) -> dict[str, dict[str, int]]:
    payload: dict[str, dict[str, int]] = {}
    for entry in calibration.entries:
        source_payload = entry.source.get("payload")
        if isinstance(source_payload, dict):
            exported = {
                key: value
                for key, value in source_payload.items()
                if isinstance(key, str)
            }
        else:
            exported = {}
        exported["id"] = entry.motor_id
        exported["drive_mode"] = _drive_mode_from_direction(entry.direction)
        exported["homing_offset"] = int(round(entry.zero_offset))
        if entry.limit is not None and entry.source_unit == "ticks":
            lower_source = entry.source_position_from_model(entry.limit.lower_rad)
            upper_source = entry.source_position_from_model(entry.limit.upper_rad)
            exported["range_min"] = int(round(min(lower_source, upper_source)))
            exported["range_max"] = int(round(max(lower_source, upper_source)))
        else:
            exported.setdefault(
                "range_min",
                ROBOT_GATEWAY_OPENARM_MINI_FEETECH_POSITION_MIN,
            )
            exported.setdefault(
                "range_max",
                ROBOT_GATEWAY_OPENARM_MINI_FEETECH_POSITION_MAX,
            )
        payload[entry.joint_name] = {
            key: int(value)
            for key, value in exported.items()
            if key in {"id", "drive_mode", "homing_offset", "range_min", "range_max"}
        }
    return payload


def _feetech_ticks_to_radians_scale() -> float:
    return 2.0 * math.pi / float(ROBOT_GATEWAY_FEETECH_TICKS_PER_REVOLUTION)


def _build_raw_tick_limit(
    *,
    range_min: int,
    range_max: int,
    zero_offset: float,
    direction: int,
    scale_to_rad: float,
) -> TeleopCalibrationLimit | None:
    if range_min >= range_max:
        return None
    lower_rad = direction * (range_min - zero_offset) * scale_to_rad
    upper_rad = direction * (range_max - zero_offset) * scale_to_rad
    return TeleopCalibrationLimit(
        lowerRad=min(lower_rad, upper_rad),
        upperRad=max(lower_rad, upper_rad),
    )


def _direction_from_lerobot_drive_mode(drive_mode: int) -> Literal[-1, 1]:
    return -1 if drive_mode % 2 else 1


def _drive_mode_from_direction(direction: int) -> int:
    return 1 if direction < 0 else 0


def _parse_positive_int(value: Any) -> int | None:
    parsed = _parse_int(value, 0)
    return parsed if parsed > 0 else None


def _parse_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _parse_float(value: Any, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if math.isfinite(parsed) else default
