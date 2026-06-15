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
        "source_name": source_id.title(),
        "sim_name": f"wl_{source_id}",
        "source_type": "cube",
        "sim_type": "box",
        "position_xyz": [0.0, 0.0, 0.0],
        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
        "size_xyz": [0.1, 0.2, 0.3],
        "rgba": [1.0, 0.0, 0.0, 1.0],
        "collision": True,
        "fixed": True,
        "mass_kg": None,
        "friction": None,
        "restitution": None,
        "semantic_role": None,
        "asset_ref": None,
        "asset_scale_xyz": None,
    }


def _report_camera(camera_id: str = "cam") -> dict:
    return {
        "camera_id": camera_id,
        "name": camera_id.title(),
        "sim_name": f"{camera_id}_camera",
        "parent_joint": "base_link",
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
    requested_frame_map: str | None = None,
    frame_map: str | None = None,
    object_positions_xyz: dict[str, tuple[float, float, float]] | None = None,
    object_sizes_xyz: dict[str, tuple[float, float, float]] | None = None,
    object_asset_refs: dict[str, str | None] | None = None,
    camera_ids: tuple[str, ...] | None = None,
    required_artifact_file_keys: tuple[str, ...] = (),
    required_artifact_dir_keys: tuple[str, ...] = (),
) -> SimulatorWorkspaceReportExpectations:
    return SimulatorWorkspaceReportExpectations(
        simulator_id=simulator_id,
        object_count=object_count,
        camera_count=camera_count,
        requested_frame_map=requested_frame_map,
        frame_map=frame_map,
        object_positions_xyz=object_positions_xyz,
        object_sizes_xyz=object_sizes_xyz,
        object_asset_refs=object_asset_refs,
        camera_ids=camera_ids,
        required_artifact_file_keys=required_artifact_file_keys,
        required_artifact_dir_keys=required_artifact_dir_keys,
    )


def _write_report(tmp_path, payload: dict):
    report_path = tmp_path / "report.json"
    objects = payload.get("objects", [])
    enriched_payload = {
        "version": "1.0.0",
        "requested_frame_map": "identity",
        "frame_convention": "z-up",
        "object_count": payload.get("primitive_count", len(objects)),
        "joint_position_count": 0,
        "robot_urdf_path": str(tmp_path / "robot.urdf"),
        "asset_roots": [str(tmp_path)],
        "warnings": [],
        **payload,
    }
    report_path.write_text(json.dumps(enriched_payload), encoding="utf-8")
    return report_path


def _write_raw_report(tmp_path, payload: dict):
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


def test_workspace_report_validation_accepts_auto_requested_frame_map(tmp_path) -> None:
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "requested_frame_map": "auto",
            "frame_map": "studio-y-up-to-z-up",
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [_report_object("crate-a")],
            "cameras": [_report_camera()],
            "artifacts": {},
        },
    )

    assert (
        validate_simulator_workspace_report(
            report_path,
            _expectations(object_count=1, camera_count=1),
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


def test_workspace_report_validation_rejects_missing_canonical_header(tmp_path) -> None:
    report_path = _write_raw_report(
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

    assert validate_simulator_workspace_report(report_path, _expectations()) == (
        "simulator validation report missing field(s): "
        "version, requested_frame_map, frame_convention, object_count, "
        "joint_position_count, robot_urdf_path, asset_roots, warnings"
    )


def test_workspace_report_validation_rejects_invalid_frame_map(tmp_path) -> None:
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "requested_frame_map": "sideways",
            "frame_map": "sideways",
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [_report_object()],
            "cameras": [_report_camera()],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(report_path, _expectations()) == (
        "simulator validation report field 'frame_map' must be one of: "
        "identity, studio-y-up-to-z-up"
    )


def test_workspace_report_validation_rejects_unexpected_requested_frame_map(tmp_path) -> None:
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "requested_frame_map": "identity",
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
        _expectations(requested_frame_map="auto"),
    ) == "simulator validation report has requested_frame_map='identity', expected 'auto'"


def test_workspace_report_validation_rejects_unexpected_resolved_frame_map(tmp_path) -> None:
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "requested_frame_map": "auto",
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
        _expectations(
            requested_frame_map="auto",
            frame_map="studio-y-up-to-z-up",
        ),
    ) == (
        "simulator validation report has frame_map='identity', "
        "expected 'studio-y-up-to-z-up'"
    )


def test_workspace_report_validation_rejects_unexpected_object_position(tmp_path) -> None:
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "studio-y-up-to-z-up",
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [_report_object("axis-box")],
            "cameras": [_report_camera()],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(
        report_path,
        _expectations(
            frame_map="studio-y-up-to-z-up",
            object_positions_xyz={"axis-box": (1.0, -3.0, 2.0)},
        ),
    ) == (
        "simulator validation report field 'objects[axis-box].position_xyz[0]' "
        "is 0.0, expected 1.0"
    )


def test_workspace_report_validation_rejects_unexpected_object_size(tmp_path) -> None:
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "studio-y-up-to-z-up",
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [_report_object("axis-box")],
            "cameras": [_report_camera()],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(
        report_path,
        _expectations(
            frame_map="studio-y-up-to-z-up",
            object_sizes_xyz={"axis-box": (0.2, 0.8, 0.4)},
        ),
    ) == (
        "simulator validation report field 'objects[axis-box].size_xyz[0]' "
        "is 0.1, expected 0.2"
    )


def test_workspace_report_validation_accepts_resolved_mesh_asset_ref(tmp_path) -> None:
    asset_path = tmp_path / "assets" / "crate.obj"
    asset_path.parent.mkdir()
    asset_path.write_text("o crate\n", encoding="utf-8")
    report_object = {
        **_report_object("mesh-crate"),
        "source_type": "mesh",
        "asset_ref": "assets/crate.obj",
    }
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "identity",
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [report_object],
            "cameras": [_report_camera()],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(
        report_path,
        _expectations(object_asset_refs={"mesh-crate": "assets/crate.obj"}),
    ) is None


def test_workspace_report_validation_rejects_unexpected_mesh_asset_ref(tmp_path) -> None:
    report_object = {
        **_report_object("mesh-crate"),
        "source_type": "mesh",
        "asset_ref": None,
    }
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "identity",
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [report_object],
            "cameras": [_report_camera()],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(
        report_path,
        _expectations(object_asset_refs={"mesh-crate": "assets/crate.obj"}),
    ) == (
        "simulator validation report field 'objects[mesh-crate].asset_ref' "
        "is None, expected 'assets/crate.obj'"
    )


def test_workspace_report_validation_rejects_unresolved_mesh_asset_ref(tmp_path) -> None:
    report_object = {
        **_report_object("mesh-crate"),
        "source_type": "mesh",
        "asset_ref": "assets/missing.obj",
    }
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "identity",
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [report_object],
            "cameras": [_report_camera()],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(report_path, _expectations()) == (
        "simulator validation report field 'objects[mesh-crate].asset_ref' "
        "does not resolve under asset_roots: assets/missing.obj"
    )


def test_workspace_report_validation_rejects_invalid_header_counts(tmp_path) -> None:
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "identity",
            "object_count": 0,
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [_report_object()],
            "cameras": [_report_camera()],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(report_path, _expectations()) == (
        "simulator validation report field 'object_count' must be greater than "
        "or equal to primitive_count"
    )


def test_workspace_report_validation_accepts_required_artifact_paths(tmp_path) -> None:
    edit_session_path = tmp_path / "blender-edit-session.json"
    edit_session_path.write_text("{}", encoding="utf-8")
    camera_dir = tmp_path / "cameras"
    camera_dir.mkdir()
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
            "artifacts": {
                "edit_session_path": str(edit_session_path),
                "camera_screenshot_dir": str(camera_dir),
            },
        },
    )

    assert (
        validate_simulator_workspace_report(
            report_path,
            _expectations(
                required_artifact_file_keys=("edit_session_path",),
                required_artifact_dir_keys=("camera_screenshot_dir",),
            ),
        )
        is None
    )


def test_workspace_report_validation_rejects_missing_required_artifact_path(tmp_path) -> None:
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
        _expectations(required_artifact_file_keys=("edit_session_path",)),
    ) == (
        "simulator validation report field 'artifacts.edit_session_path' "
        "must be a non-empty string"
    )


def test_workspace_report_validation_rejects_wrong_artifact_kind(tmp_path) -> None:
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
            "artifacts": {"camera_screenshot_dir": str(tmp_path / "missing-cameras")},
        },
    )

    assert validate_simulator_workspace_report(
        report_path,
        _expectations(required_artifact_dir_keys=("camera_screenshot_dir",)),
    ) == (
        "simulator validation report artifact 'camera_screenshot_dir' "
        f"is not a directory: {tmp_path / 'missing-cameras'}"
    )


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


def test_workspace_report_validation_rejects_missing_simulator_label(tmp_path) -> None:
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "runtime": {}},
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
        "simulator validation report field 'simulator.label' must be a non-empty string"
    )


def test_workspace_report_validation_rejects_missing_simulator_runtime(tmp_path) -> None:
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis"},
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
        "simulator validation report field 'simulator.runtime' must be an object"
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
        "source_name, sim_name, source_type, sim_type, position_xyz, quat_wxyz, "
        "size_xyz, rgba, collision, fixed, mass_kg, friction, restitution, semantic_role, "
        "asset_ref, asset_scale_xyz"
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
        "name, sim_name, parent_joint, parent_link, position_xyz, quat_wxyz, "
        "width, height, fov_deg, intrinsics"
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


def test_workspace_report_validation_rejects_duplicate_object_source_id(tmp_path) -> None:
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "identity",
            "primitive_count": 2,
            "camera_count": 1,
            "objects": [_report_object("crate"), _report_object("crate")],
            "cameras": [_report_camera()],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(
        report_path,
        _expectations(object_count=2),
    ) == (
        "simulator validation report field 'objects.source_id' "
        "contains duplicate value(s): crate"
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


def test_workspace_report_validation_rejects_invalid_object_physics_metadata(tmp_path) -> None:
    invalid_object = _report_object()
    invalid_object["fixed"] = "yes"
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
        "simulator validation report field 'objects[0].fixed' must be a boolean"
    )


def test_workspace_report_validation_rejects_invalid_object_asset_scale(tmp_path) -> None:
    invalid_object = _report_object()
    invalid_object["asset_scale_xyz"] = [1.0, 0.0, 1.0]
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
        "simulator validation report field 'objects[0].asset_scale_xyz' "
        "must contain positive numbers"
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


def test_workspace_report_validation_rejects_duplicate_camera_sim_name(tmp_path) -> None:
    first_camera = _report_camera("front")
    second_camera = _report_camera("rear")
    second_camera["sim_name"] = first_camera["sim_name"]
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "identity",
            "primitive_count": 1,
            "camera_count": 2,
            "objects": [_report_object()],
            "cameras": [first_camera, second_camera],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(
        report_path,
        _expectations(camera_count=2),
    ) == (
        "simulator validation report field 'cameras.sim_name' "
        "contains duplicate value(s): front_camera"
    )


def test_workspace_report_validation_rejects_unexpected_camera_id_sequence(tmp_path) -> None:
    report_path = _write_report(
        tmp_path,
        {
            "simulator": {"id": SIMULATOR_GENESIS_ID, "label": "Genesis", "runtime": {}},
            "package_id": "demo",
            "frame_map": "identity",
            "primitive_count": 1,
            "camera_count": 1,
            "objects": [_report_object()],
            "cameras": [_report_camera("wrong-camera")],
            "artifacts": {},
        },
    )

    assert validate_simulator_workspace_report(
        report_path,
        _expectations(camera_ids=("cam",)),
    ) == (
        "simulator validation report camera_id sequence "
        "is ('wrong-camera',), expected ('cam',)"
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
