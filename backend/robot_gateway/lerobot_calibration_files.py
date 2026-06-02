from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.robot_gateway.params import (
    ROBOT_GATEWAY_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
    ROBOT_GATEWAY_LEROBOT_SIDE_CALIBRATION_GROUPS,
)


@dataclass(frozen=True)
class LeRobotCalibrationEntry:
    joint_name: str
    payload: dict[str, Any]
    motor_id: int


@dataclass(frozen=True)
class LeRobotCalibrationGroup:
    group_id: str
    entries: tuple[LeRobotCalibrationEntry, ...]

    @property
    def joint_names(self) -> tuple[str, ...]:
        return tuple(entry.joint_name for entry in self.entries)

    @property
    def motor_ids(self) -> tuple[int, ...]:
        return tuple(entry.motor_id for entry in self.entries)

    @property
    def zero_positions_rad(self) -> dict[str, float]:
        return infer_lerobot_calibration_zero_positions_rad(self)


def read_lerobot_calibration_groups(
    calibration_path: Path,
) -> tuple[LeRobotCalibrationGroup, ...]:
    entries = read_lerobot_calibration_entries(calibration_path)
    if not entries:
        return ()
    return split_lerobot_calibration_entries(entries)


def infer_lerobot_calibration_zero_positions_rad(
    group: LeRobotCalibrationGroup,
) -> dict[str, float]:
    return {
        entry.joint_name: ROBOT_GATEWAY_LEROBOT_CALIBRATION_ZERO_POSITION_RAD
        for entry in group.entries
    }


def read_lerobot_calibration_entries(
    calibration_path: Path,
) -> tuple[LeRobotCalibrationEntry, ...]:
    try:
        payload = json.loads(calibration_path.read_text(encoding="utf-8"))
    except Exception:
        return ()
    if not isinstance(payload, dict):
        return ()

    entries: list[LeRobotCalibrationEntry] = []
    for raw_joint_name, raw_entry in payload.items():
        if not isinstance(raw_joint_name, str) or not isinstance(raw_entry, dict):
            continue
        motor_id = parse_positive_int(raw_entry.get("id"))
        joint_name = raw_joint_name.strip()
        if motor_id is None or not joint_name:
            continue
        entries.append(
            LeRobotCalibrationEntry(
                joint_name=joint_name,
                payload=raw_entry,
                motor_id=motor_id,
            )
        )
    return tuple(entries)


def split_lerobot_calibration_entries(
    entries: tuple[LeRobotCalibrationEntry, ...],
) -> tuple[LeRobotCalibrationGroup, ...]:
    motor_counts: dict[int, int] = {}
    for entry in entries:
        motor_counts[entry.motor_id] = motor_counts.get(entry.motor_id, 0) + 1
    if all(count == 1 for count in motor_counts.values()):
        return (
            LeRobotCalibrationGroup(
                group_id="all",
                entries=tuple(sorted(entries, key=_sort_entry_by_motor)),
            ),
        )

    grouped: dict[str, list[LeRobotCalibrationEntry]] = {}
    for entry in entries:
        prefix = entry.joint_name.split("_", 1)[0].strip().lower()
        if prefix not in ROBOT_GATEWAY_LEROBOT_SIDE_CALIBRATION_GROUPS:
            continue
        grouped.setdefault(prefix, []).append(entry)
    return tuple(
        LeRobotCalibrationGroup(
            group_id=group_id,
            entries=tuple(sorted(grouped[group_id], key=_sort_entry_by_motor)),
        )
        for group_id in sorted(grouped)
    )


def parse_positive_int(value: Any) -> int | None:
    parsed = parse_int(value, 0)
    return parsed if parsed > 0 else None


def parse_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _sort_entry_by_motor(entry: LeRobotCalibrationEntry) -> tuple[int, str]:
    return (entry.motor_id, entry.joint_name)
