from __future__ import annotations

import json

from backend.models.simulator_runtime import SIMULATOR_GENESIS_ID, SIMULATOR_PYBULLET_ID
from backend.services.simulator_adapters.workspace_report_validation import (
    SimulatorWorkspaceReportExpectations,
    validate_simulator_workspace_report,
)


def _report_object(source_id: str = "crate") -> dict:
    return {
        "source_id": source_id,
        "sim_name": f"wl_{source_id}",
        "sim_type": "box",
        "position_xyz": [0.0, 0.0, 0.0],
        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
        "size_xyz": [0.1, 0.2, 0.3],
        "rgba": [1.0, 0.0, 0.0, 1.0],
    }


def _report_camera(camera_id: str = "cam") -> dict:
    return {
        "camera_id": camera_id,
        "sim_name": f"{camera_id}_camera",
        "parent_link": "base_link",
        "position_xyz": [0.0, 0.0, 1.0],
        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
        "width": 64,
        "height": 48,
        "fov_deg": 60.0,
        "intrinsics": {
            "matrix": [
                [41.569219381653056, 0.0, 32.0],
                [0.0, 41.569219381653056, 24.0],
                [0.0, 0.0, 1.0],
            ]
        },
    }


def _expectations(
    *,
    object_count: int = 1,
    camera_count: int = 1,
    simulator_id: str = SIMULATOR_GENESIS_ID,
) -> SimulatorWorkspaceReportExpectations:
    return SimulatorWorkspaceReportExpectations(
        simulator_id=simulator_id,
        object_count=object_count,
        camera_count=camera_count,
    )


def _write_report(tmp_path, payload: dict):
    report_path = tmp_path / "report.json"
    report_path.write_text(json.dumps(payload), encoding="utf-8")
    return report_path


def test_workspace_report_validation_accepts_matching_report(tmp_path) -> None:
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "identity",
            "primitive_count": 2,
            "camera_count": 1,
            "objects": [_report_object("crate-a"), _report_object("crate-b")],
            "cameras": [_report_camera()],
            "artifacts": {},
        },
    )

    assert (
        validate_simulator_workspace_report(
            report_path,
            _expectations(object_count=2, camera_count=1),
        )
        is None
    )


def test_workspace_report_validation_rejects_wrong_counts(tmp_path) -> None:
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "identity",
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [_report_object()],
            "cameras": [_report_camera()],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(
        report_path,
        _expectations(object_count=2, camera_count=1),
    ) == "simulator validation report has primitive_count=1, expected 2"


def test_workspace_report_validation_rejects_wrong_simulator_id(tmp_path) -> None:
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_PYBULLET_ID, "label": "PyBullet", "runtime": {}},
            "package_id": "demo",
            "frame_map": "identity",
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [_report_object()],
            "cameras": [_report_camera()],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(report_path, _expectations()) == (
        "simulator validation report has wrong simulator id: "
        f"{SIMULATOR_PYBULLET_ID!r}, expected {SIMULATOR_GENESIS_ID!r}"
    )


def test_workspace_report_validation_rejects_missing_object_fields(tmp_path) -> None:
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "identity",
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [{"source_id": "crate"}],
            "cameras": [_report_camera()],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(report_path, _expectations()) == (
        "simulator validation report field 'objects[0]' missing field(s): "
        "sim_name, sim_type, position_xyz, quat_wxyz, size_xyz, rgba"
    )


def test_workspace_report_validation_rejects_missing_camera_fields(tmp_path) -> None:
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "identity",
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [_report_object()],
            "cameras": [{"camera_id": "cam"}],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(report_path, _expectations()) == (
        "simulator validation report field 'cameras[0]' missing field(s): "
        "sim_name, parent_link, position_xyz, quat_wxyz, width, height, fov_deg, intrinsics"
    )


def test_workspace_report_validation_rejects_invalid_object_values(tmp_path) -> None:
    invalid_object = _report_object()
    invalid_object["size_xyz"] = [0.1, -0.2, 0.3]
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "identity",
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [invalid_object],
            "cameras": [_report_camera()],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(report_path, _expectations()) == (
        "simulator validation report field 'objects[0].size_xyz' must contain positive numbers"
    )


def test_workspace_report_validation_rejects_invalid_object_color(tmp_path) -> None:
    invalid_object = _report_object()
    invalid_object["rgba"] = [1.0, 0.0, 1.5, 1.0]
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "identity",
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [invalid_object],
            "cameras": [_report_camera()],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(report_path, _expectations()) == (
        "simulator validation report field 'objects[0].rgba' "
        "must contain numbers between 0 and 1"
    )


def test_workspace_report_validation_rejects_invalid_camera_values(tmp_path) -> None:
    invalid_camera = _report_camera()
    invalid_camera["width"] = 0
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "identity",
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [_report_object()],
            "cameras": [invalid_camera],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(report_path, _expectations()) == (
        "simulator validation report field 'cameras[0].width' must be a positive integer"
    )


def test_workspace_report_validation_rejects_invalid_camera_intrinsics(tmp_path) -> None:
    invalid_camera = _report_camera()
    invalid_camera["intrinsics"] = {
        "matrix": [
            [0.0, 0.0, 32.0],
            [0.0, 41.569219381653056, 24.0],
            [0.0, 0.0, 1.0],
        ]
    }
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "identity",
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [_report_object()],
            "cameras": [invalid_camera],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(report_path, _expectations()) == (
        "simulator validation report field 'cameras[0].intrinsics.matrix' "
        "must have positive focal lengths"
    )
