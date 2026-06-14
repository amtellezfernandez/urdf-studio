from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator


REPO_ROOT = Path(__file__).resolve().parents[2]
WSP_SCHEMA_PATH = REPO_ROOT / "docs" / "specs" / "WSP_manifest.schema.json"


def _validator() -> Draft202012Validator:
    schema = json.loads(WSP_SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def _manifest() -> dict:
    return {
        "schema_version": "1.0.0",
        "package_id": "schema-demo",
        "version": "0.1.0",
        "title": "Schema Demo",
        "created_at": "2026-01-01T00:00:00Z",
        "runtime_targets": [],
        "interface": {
            "observation_modalities": ["proprio"],
            "action_semantics": "joint_position_rad",
            "timestep_ms": 33,
            "frame_convention": "ros-rep-103",
        },
        "artifacts": [],
        "world_snapshot": {
            "urdf_xml": "<robot name='demo'/>",
            "joint_positions": {},
            "cameras": [],
            "objects": [],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        },
        "provenance": {},
        "security": {
            "signature_ref": None,
            "attestation_refs": [],
            "sbom_ref": None,
        },
    }


def _schema_errors(payload: dict) -> list[str]:
    validator = _validator()
    return [
        error.message
        for error in sorted(validator.iter_errors(payload), key=lambda item: list(item.path))
    ]


def _manifest_with_mesh_asset_ref(asset_ref: str) -> dict:
    payload = copy.deepcopy(_manifest())
    payload["world_snapshot"]["objects"] = [
        {
            "id": "crate",
            "name": "Crate",
            "type": "mesh",
            "position_xyz": [0.0, 0.0, 0.1],
            "rotation_rpy_rad": [0.0, 0.0, 0.0],
            "size_xyz": [0.2, 0.3, 0.4],
            "color": "#22c55e",
            "asset_ref": asset_ref,
        }
    ]
    return payload


def _camera() -> dict:
    return {
        "id": "cam",
        "name": "Scene camera",
        "parent_joint": "base_link",
        "pose": {
            "xyz": [0.0, 0.0, 0.0],
            "rpy": [0.0, 0.0, 0.0],
        },
        "intrinsics": {
            "width": 640,
            "height": 480,
            "fov_deg": 60.0,
            "fx": 501.0,
            "fy": 502.0,
            "cx": 319.5,
            "cy": 241.25,
        },
    }


def test_wsp_manifest_schema_accepts_world_cameras() -> None:
    payload = _manifest()
    payload["world_snapshot"]["cameras"] = [_camera()]

    assert _schema_errors(payload) == []


@pytest.mark.parametrize(
    ("mutator", "expected_message"),
    [
        (
            lambda payload: payload.update({"description": None}),
            "None is not of type 'string'",
        ),
        (
            lambda payload: payload["runtime_targets"].append(
                {"name": "blender", "mode": "python", "min_version": None}
            ),
            "None is not of type 'string'",
        ),
    ],
)
def test_wsp_manifest_schema_rejects_null_manifest_optionals(
    mutator,
    expected_message: str,
) -> None:
    payload = _manifest()
    mutator(payload)

    assert expected_message in _schema_errors(payload)


@pytest.mark.parametrize(
    ("mutator", "expected_message"),
    [
        (lambda camera: camera.pop("parent_joint"), "'parent_joint' is a required property"),
        (lambda camera: camera["pose"].pop("rpy"), "'rpy' is a required property"),
        (lambda camera: camera["intrinsics"].update({"width": 0}), "0 is less than the minimum of 1"),
        (
            lambda camera: camera["intrinsics"].update({"fx": -1.0}),
            "-1.0 is less than or equal to the minimum of 0",
        ),
        (
            lambda camera: camera["intrinsics"].update({"cx": None}),
            "None is not of type 'number'",
        ),
        (
            lambda camera: camera.update({"debug": True}),
            "Additional properties are not allowed ('debug' was unexpected)",
        ),
    ],
)
def test_wsp_manifest_schema_rejects_invalid_world_cameras(
    mutator,
    expected_message: str,
) -> None:
    payload = _manifest()
    camera = _camera()
    mutator(camera)
    payload["world_snapshot"]["cameras"] = [camera]

    assert expected_message in _schema_errors(payload)


def test_wsp_manifest_schema_accepts_portable_mesh_asset_refs() -> None:
    payload = _manifest_with_mesh_asset_ref("assets/crate.obj")

    assert _schema_errors(payload) == []


def test_wsp_manifest_schema_accepts_local_relative_mesh_asset_refs() -> None:
    payload = _manifest_with_mesh_asset_ref("./assets/crate.obj")

    assert _schema_errors(payload) == []


@pytest.mark.parametrize(
    "asset_ref",
    [
        ".",
        "./",
        " assets/crate.obj",
        "assets/crate.obj ",
        "/tmp/crate.obj",
        "../crate.obj",
        "assets/../crate.obj",
        "assets/./crate.obj",
        "assets//crate.obj",
        "package://demo/crate.obj",
        "https://example.test/crate.obj",
        "C:\\tmp\\crate.obj",
    ],
)
def test_wsp_manifest_schema_rejects_nonportable_mesh_asset_refs(asset_ref: str) -> None:
    payload = _manifest_with_mesh_asset_ref(asset_ref)

    errors = _schema_errors(payload)

    assert errors == [
        f"{asset_ref!r} does not match "
        r"'^(?!\\s)(?!.*\\s$)(?!.*:)(?:\\./)*(?!\\.{1,2}(?:/|$))[^/]+(?:/(?!\\.{1,2}(?:/|$))[^/]+)*$'"
    ]


def test_wsp_manifest_schema_requires_mesh_asset_reference() -> None:
    payload = copy.deepcopy(_manifest())
    payload["world_snapshot"]["objects"] = [
        {
            "id": "crate",
            "name": "Crate",
            "type": "mesh",
            "position_xyz": [0.0, 0.0, 0.1],
            "rotation_rpy_rad": [0.0, 0.0, 0.0],
            "size_xyz": [0.2, 0.3, 0.4],
            "color": "#22c55e",
        }
    ]

    errors = _schema_errors(payload)

    assert errors == [
        "{'id': 'crate', 'name': 'Crate', 'type': 'mesh', 'position_xyz': [0.0, 0.0, 0.1], "
        "'rotation_rpy_rad': [0.0, 0.0, 0.0], 'size_xyz': [0.2, 0.3, 0.4], "
        "'color': '#22c55e'} is not valid under any of the given schemas"
    ]


def test_wsp_manifest_schema_rejects_unknown_simulator_metadata_fields() -> None:
    payload = _manifest_with_mesh_asset_ref("assets/crate.obj")
    world_object = payload["world_snapshot"]["objects"][0]
    world_object["simulation"] = {"fixed": True, "debug": True}
    world_object["mesh"] = {"path": "assets/crate.obj", "debug": True}

    errors = _schema_errors(payload)

    assert "Additional properties are not allowed ('debug' was unexpected)" in errors
    assert errors.count("Additional properties are not allowed ('debug' was unexpected)") == 2


def test_wsp_manifest_schema_rejects_static_snapshot_with_nonzero_time() -> None:
    payload = _manifest()
    payload["world_snapshot"]["scenario_duration_ms"] = 0
    payload["world_snapshot"]["scenario_time_ms"] = 100

    assert _schema_errors(payload) == ["0 was expected"]


def test_wsp_manifest_schema_accepts_nonstatic_snapshot_time() -> None:
    payload = _manifest()
    payload["world_snapshot"]["scenario_duration_ms"] = 1000
    payload["world_snapshot"]["scenario_time_ms"] = 100

    assert _schema_errors(payload) == []
