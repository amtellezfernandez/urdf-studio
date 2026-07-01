from __future__ import annotations

import json
import math

import pytest

from backend.robot_gateway.params import (
    ROBOT_GATEWAY_TELEOP_CALIBRATION_SCHEMA_VERSION,
)
from backend.robot_gateway.teleop_calibration import (
    TeleopCalibration,
    TeleopCalibrationEntry,
    export_lerobot_calibration_payload,
    import_lerobot_calibration_payload,
    parse_teleop_calibration,
    teleop_calibration_to_json,
)


def test_urdf_studio_teleop_calibration_round_trips() -> None:
    calibration = TeleopCalibration(
        robotModelId="so101",
        providerFamily="feetech",
        entries=[
            TeleopCalibrationEntry(
                motorId=1,
                jointName="shoulder_pan",
                sourceUnit="ticks",
                zeroOffset=2048.0,
                direction=-1,
                scaleToRad=math.pi / 2048.0,
            )
        ],
        source={"format": "unit-test"},
    )

    encoded = teleop_calibration_to_json(calibration)
    decoded = parse_teleop_calibration(json.loads(encoded))

    assert decoded.schema_version == ROBOT_GATEWAY_TELEOP_CALIBRATION_SCHEMA_VERSION
    assert decoded.robot_model_id == "so101"
    assert decoded.entries[0].joint_name == "shoulder_pan"
    assert decoded.entries[0].direction == -1


def test_imports_lerobot_calibration_json_to_canonical_format() -> None:
    calibration = import_lerobot_calibration_payload(
        {
            "shoulder_pan": {
                "id": 1,
                "drive_mode": 1,
                "homing_offset": 1000,
                "range_min": 500,
                "range_max": 3500,
            },
            "shoulder_lift": {
                "id": 2,
                "drive_mode": 0,
                "homing_offset": 1500,
                "range_min": 600,
                "range_max": 3400,
            },
        },
        robot_model_id="so101",
    )

    assert calibration.provider_family == "feetech"
    assert calibration.motor_ids == (1, 2)
    assert calibration.joint_names == ("shoulder_pan", "shoulder_lift")
    assert calibration.entries[0].source_unit == "ticks"
    assert calibration.entries[0].direction == -1
    assert calibration.entries[0].zero_offset == 1000.0


def test_exports_lerobot_calibration_json_from_canonical_format() -> None:
    calibration = import_lerobot_calibration_payload(
        {
            "shoulder_pan": {
                "id": 1,
                "drive_mode": 1,
                "homing_offset": 1000,
                "range_min": 500,
                "range_max": 3500,
            }
        },
        robot_model_id="so101",
    )

    exported = export_lerobot_calibration_payload(calibration)

    assert exported == {
        "shoulder_pan": {
            "id": 1,
            "drive_mode": 1,
            "homing_offset": 1000,
            "range_min": 500,
            "range_max": 3500,
        }
    }


def test_calibration_sign_offset_and_unit_conversion() -> None:
    calibration = TeleopCalibration(
        robotModelId="fixture",
        providerFamily="fake",
        entries=[
            TeleopCalibrationEntry(
                motorId=7,
                jointName="joint_a",
                sourceUnit="ticks",
                zeroOffset=100.0,
                direction=-1,
                scaleToRad=0.01,
            )
        ],
    )

    positions = calibration.model_positions_from_motor_positions({7: 125.0})
    source = calibration.source_positions_from_model_positions({"joint_a": -0.25})

    assert positions["joint_a"] == pytest.approx(-0.25)
    assert source[7] == pytest.approx(125.0)


def test_calibration_rejects_duplicate_motor_ids() -> None:
    with pytest.raises(ValueError, match="Duplicate calibration motor id"):
        TeleopCalibration(
            robotModelId="fixture",
            entries=[
                TeleopCalibrationEntry(motorId=1, jointName="joint_a"),
                TeleopCalibrationEntry(motorId=1, jointName="joint_b"),
            ],
        )
