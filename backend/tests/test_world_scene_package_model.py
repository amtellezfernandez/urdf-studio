from __future__ import annotations

import math

import pytest
from pydantic import ValidationError

from backend.models.world_scene_package import WorldScenePackageManifest


def _manifest_payload() -> dict:
    return {
        "schema_version": "1.0.0",
        "package_id": "model-demo",
        "version": "0.1.0",
        "title": "Model Demo",
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


def _camera_payload() -> dict:
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


def _world_object_payload() -> dict:
    return {
        "id": "crate",
        "name": "Crate",
        "type": "cube",
        "position_xyz": [0.0, 0.0, 0.1],
        "rotation_rpy_rad": [0.0, 0.0, 0.0],
        "size_xyz": [0.2, 0.3, 0.4],
        "color": "#22c55e",
    }


def test_world_snapshot_accepts_valid_world_camera_contract() -> None:
    payload = _manifest_payload()
    payload["world_snapshot"]["cameras"] = [_camera_payload()]

    manifest = WorldScenePackageManifest.model_validate(payload)

    assert manifest.world_snapshot.cameras[0]["id"] == "cam"


def test_world_snapshot_accepts_valid_world_object_contract() -> None:
    payload = _manifest_payload()
    payload["world_snapshot"]["objects"] = [
        {
            **_world_object_payload(),
            "type": "mesh",
            "asset_ref": "assets/crate.obj",
            "asset_scale_xyz": [1.0, 1.0, 1.0],
            "mesh": {
                "path": "assets/crate.obj",
                "scale": 1.2,
            },
            "simulation": {
                "fixed": True,
                "collision": True,
                "mass_kg": 1.5,
                "friction": 0.8,
                "restitution": 0.1,
                "semantic_role": "fixture",
            },
        }
    ]

    manifest = WorldScenePackageManifest.model_validate(payload)

    assert manifest.world_snapshot.objects[0]["id"] == "crate"


@pytest.mark.parametrize(
    ("mutator", "expected_message"),
    [
        (lambda world_object: world_object.update({"id": ""}), "objects\\[0\\].id"),
        (lambda world_object: world_object.update({"type": "box"}), "objects\\[0\\].type"),
        (lambda world_object: world_object.update({"size_xyz": [0.2, 0.0, 0.4]}), "size_xyz\\[1\\]"),
        (lambda world_object: world_object.update({"is_hidden": "yes"}), "is_hidden must be a boolean"),
        (
            lambda world_object: world_object.update({"ik_target_type": "orbit"}),
            "orbit_radius must be a finite number > 0",
        ),
        (
            lambda world_object: world_object.update({"simulation": {"friction": 0.0}}),
            "simulation.friction must be >= 0.01",
        ),
        (
            lambda world_object: world_object.update({"mesh": []}),
            "objects\\[0\\].mesh must be an object",
        ),
        (
            lambda world_object: world_object.update({"type": "mesh"}),
            "mesh asset reference is required for mesh objects",
        ),
        (
            lambda world_object: world_object.update(
                {"type": "mesh", "asset_ref": "/tmp/crate.obj"}
            ),
            "asset_ref must be a portable relative asset reference",
        ),
    ],
)
def test_world_snapshot_rejects_invalid_world_object_contract(
    mutator,
    expected_message: str,
) -> None:
    payload = _manifest_payload()
    world_object = _world_object_payload()
    mutator(world_object)
    payload["world_snapshot"]["objects"] = [world_object]

    with pytest.raises(ValidationError, match=expected_message):
        WorldScenePackageManifest.model_validate(payload)


@pytest.mark.parametrize(
    ("mutator", "expected_message"),
    [
        (lambda camera: camera.update({"name": ""}), "name must be a non-empty string"),
        (lambda camera: camera["pose"].pop("rpy"), "pose.rpy must be an array"),
        (lambda camera: camera["intrinsics"].update({"fx": -1.0}), "intrinsics.fx"),
        (lambda camera: camera["intrinsics"].update({"cx": None}), "intrinsics.cx"),
        (
            lambda camera: (
                camera["intrinsics"].pop("fov_deg"),
                camera["intrinsics"].pop("fx"),
                camera["intrinsics"].pop("fy"),
            ),
            "must include fov_deg, fx, or fy",
        ),
        (lambda camera: camera.update({"debug": True}), "unsupported field"),
    ],
)
def test_world_snapshot_rejects_invalid_world_camera_contract(
    mutator,
    expected_message: str,
) -> None:
    payload = _manifest_payload()
    camera = _camera_payload()
    mutator(camera)
    payload["world_snapshot"]["cameras"] = [camera]

    with pytest.raises(ValidationError, match=expected_message):
        WorldScenePackageManifest.model_validate(payload)


@pytest.mark.parametrize(
    ("snapshot_field", "entry"),
    [
        (
            "cameras",
            {
                "id": "cam",
                "name": "cam",
                "parent_joint": "base_joint",
                "pose": {"xyz": [0.0, math.nan, 0.0], "rpy": [0.0, 0.0, 0.0]},
                "intrinsics": {"width": 640, "height": 480, "fov_deg": 60.0},
            },
        ),
        (
            "objects",
            {
                "id": "crate",
                "name": "Crate",
                "type": "cube",
                "position_xyz": [0.0, math.inf, 0.0],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz": [0.2, 0.2, 0.2],
                "color": "#22c55e",
            },
        ),
    ],
)
def test_world_snapshot_rejects_non_finite_camera_and_object_numbers(
    snapshot_field: str,
    entry: dict,
) -> None:
    payload = _manifest_payload()
    payload["world_snapshot"][snapshot_field] = [entry]

    with pytest.raises(ValidationError, match="must not contain non-finite numbers"):
        WorldScenePackageManifest.model_validate(payload)
