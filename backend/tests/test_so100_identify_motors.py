from __future__ import annotations

from tools.scripts.so100_identify_motors import (
    ChangedMotorAmbiguous,
    ChangedMotorMatch,
    SO100_JOINT_ORDER,
    build_lerobot_id_map_calibration_payload,
    build_raw_motor_map_payload,
    infer_changed_motor,
)


def test_infer_changed_motor_selects_largest_unassigned_delta() -> None:
    result = infer_changed_motor(
        {1: 1000, 2: 1000, 3: 1000},
        {1: 1010, 2: 1210, 3: 1001},
        assigned_motor_ids={1},
    )

    assert isinstance(result, ChangedMotorMatch)
    assert result.motor_id == 2
    assert result.deltas_by_id == {1: 10, 2: 210, 3: 1}


def test_infer_changed_motor_rejects_ambiguous_movement() -> None:
    result = infer_changed_motor(
        {1: 1000, 2: 1000, 3: 1000},
        {1: 1130, 2: 1120, 3: 1000},
    )

    assert isinstance(result, ChangedMotorAmbiguous)
    assert "ambiguous" in result.reason


def test_infer_changed_motor_rejects_small_movement() -> None:
    result = infer_changed_motor(
        {1: 1000, 2: 1000},
        {1: 1005, 2: 1000},
    )

    assert isinstance(result, ChangedMotorAmbiguous)
    assert "threshold" in result.reason


def test_build_raw_motor_map_payload_keeps_so100_joint_order() -> None:
    joint_to_motor_id = {
        joint_name: index
        for index, joint_name in enumerate(SO100_JOINT_ORDER, start=1)
    }

    payload = build_raw_motor_map_payload(
        joint_to_motor_id,
        port="/dev/ttyUSB0",
        baudrate=1_000_000,
        motor_model="sts3215",
    )

    assert payload["format"] == "urdf-studio.so100.raw-motor-map.v1"
    assert list(payload["joint_to_motor_id"]) == list(SO100_JOINT_ORDER)
    assert payload["joint_to_motor_id"]["gripper"] == 6


def test_build_lerobot_id_map_calibration_payload_uses_raw_full_range() -> None:
    joint_to_motor_id = {
        joint_name: index
        for index, joint_name in enumerate(reversed(SO100_JOINT_ORDER), start=1)
    }

    payload = build_lerobot_id_map_calibration_payload(
        joint_to_motor_id,
        raw_range_max=4095,
    )

    assert payload["shoulder_pan"] == {
        "id": 6,
        "drive_mode": 0,
        "homing_offset": 0,
        "range_min": 0,
        "range_max": 4095,
    }
    assert payload["gripper"]["id"] == 1
