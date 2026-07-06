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


def test_world_snapshot_accepts_layout_mesh_scale_aliases() -> None:
    payload = _manifest_payload()
    payload["world_snapshot"]["objects"] = [
        {
            **_world_object_payload(),
            "type": "mesh",
            "asset_ref": "assets/crate.obj",
            "mesh_scale_xyz": [1.0, 1.1, 1.2],
            "scale_xyz": [1.3, 1.4, 1.5],
        }
    ]

    manifest = WorldScenePackageManifest.model_validate(payload)

    assert manifest.world_snapshot.objects[0]["mesh_scale_xyz"] == [1.0, 1.1, 1.2]
    assert manifest.world_snapshot.objects[0]["scale_xyz"] == [1.3, 1.4, 1.5]


def test_world_snapshot_accepts_v1_1_appearance_physics_consistency_contract() -> None:
    payload = _manifest_payload()
    payload["schema_version"] = "1.1.0"
    payload["world_snapshot"]["objects"] = [
        {
            **_world_object_payload(),
            "type": "mesh",
            "appearance": {
                "representations": [
                    {
                        "id": "crate-splat",
                        "kind": "splat",
                        "asset_ref": "assets/crate.spz",
                        "scale_xyz": [1.0, 1.0, 1.0],
                    }
                ]
            },
            "physics": {
                "fixed": True,
                "collision": True,
                "mass_kg": 1.5,
                "friction": 0.8,
                "restitution": 0.1,
                "semantic_role": "fixture",
                "collision_geometry": {
                    "id": "crate-proxy",
                    "kind": "box",
                    "size_xyz": [0.2, 0.3, 0.4],
                },
                "inertia": {
                    "ixx": 0.01,
                    "iyy": 0.02,
                    "izz": 0.03,
                },
            },
            "consistency": {
                "appearance_ref": "crate-splat",
                "physics_ref": "crate-proxy",
                "method": "bbox-fit",
                "metrics": {"coverage": 0.95},
                "status": "valid",
            },
        }
    ]

    manifest = WorldScenePackageManifest.model_validate(payload)

    world_object = manifest.world_snapshot.objects[0]
    assert world_object["appearance"]["representations"][0]["kind"] == "splat"
    assert world_object["physics"]["collision_geometry"]["kind"] == "box"


def test_world_snapshot_rejects_splat_without_physics_collision_geometry() -> None:
    payload = _manifest_payload()
    payload["schema_version"] = "1.1.0"
    payload["world_snapshot"]["objects"] = [
        {
            **_world_object_payload(),
            "type": "mesh",
            "appearance": {
                "representations": [
                    {
                        "id": "crate-splat",
                        "kind": "splat",
                        "asset_ref": "assets/crate.spz",
                    }
                ]
            },
        }
    ]

    with pytest.raises(ValidationError) as exc_info:
        WorldScenePackageManifest.model_validate(payload)

    assert "splat representations require physics.collision_geometry" in str(exc_info.value)


def test_world_snapshot_rejects_mesh_with_primitive_only_appearance_ref() -> None:
    payload = _manifest_payload()
    payload["schema_version"] = "1.1.0"
    payload["world_snapshot"]["objects"] = [
        {
            **_world_object_payload(),
            "type": "mesh",
            "appearance": {
                "representations": [
                    {
                        "id": "crate-primitive",
                        "kind": "primitive",
                        "asset_ref": "assets/crate.json",
                    }
                ]
            },
        }
    ]

    with pytest.raises(ValidationError) as exc_info:
        WorldScenePackageManifest.model_validate(payload)

    assert "mesh asset reference is required for mesh objects" in str(exc_info.value)


def test_world_snapshot_rejects_nonportable_physics_collision_mesh_asset_ref() -> None:
    payload = _manifest_payload()
    payload["schema_version"] = "1.1.0"
    payload["world_snapshot"]["objects"] = [
        {
            **_world_object_payload(),
            "physics": {
                "collision_geometry": {
                    "id": "crate-proxy",
                    "kind": "mesh",
                    "asset_ref": "../crate.stl",
                }
            },
        }
    ]

    with pytest.raises(ValidationError) as exc_info:
        WorldScenePackageManifest.model_validate(payload)

    assert "physics.collision_geometry.asset_ref" in str(exc_info.value)
    assert "portable relative asset reference" in str(exc_info.value)


def test_world_interface_preserves_extension_metadata() -> None:
    payload = _manifest_payload()
    payload["interface"]["planning"] = {
        "representation_space": "latent",
        "planning_horizon_steps": 128,
    }

    manifest = WorldScenePackageManifest.model_validate(payload)

    assert manifest.model_dump(mode="json")["interface"]["planning"] == {
        "representation_space": "latent",
        "planning_horizon_steps": 128,
    }


def test_world_scene_package_model_rejects_unsupported_schema_version() -> None:
    payload = _manifest_payload()
    payload["schema_version"] = "2.0.0"

    with pytest.raises(ValidationError) as exc_info:
        WorldScenePackageManifest.model_validate(payload)

    assert exc_info.value.errors()[0]["loc"] == ("schema_version",)
    assert exc_info.value.errors()[0]["type"] == "literal_error"


@pytest.mark.parametrize(
    "field_name",
    [
        "schema_version",
        "runtime_targets",
        "artifacts",
        "provenance",
        "security",
    ],
)
def test_world_scene_package_model_requires_schema_level_fields(field_name: str) -> None:
    payload = _manifest_payload()
    payload.pop(field_name)

    with pytest.raises(ValidationError) as exc_info:
        WorldScenePackageManifest.model_validate(payload)

    assert exc_info.value.errors()[0]["loc"] == (field_name,)
    assert exc_info.value.errors()[0]["type"] == "missing"


@pytest.mark.parametrize(
    ("mutator", "expected_path"),
    [
        (
            lambda payload: payload["interface"].pop("observation_modalities"),
            ("interface", "observation_modalities"),
        ),
        (
            lambda payload: payload["security"].pop("attestation_refs"),
            ("security", "attestation_refs"),
        ),
    ],
)
def test_world_scene_package_model_requires_nested_schema_fields(
    mutator,
    expected_path: tuple[str, str],
) -> None:
    payload = _manifest_payload()
    mutator(payload)

    with pytest.raises(ValidationError) as exc_info:
        WorldScenePackageManifest.model_validate(payload)

    assert exc_info.value.errors()[0]["loc"] == expected_path
    assert exc_info.value.errors()[0]["type"] == "missing"


def test_world_scene_package_model_accepts_omitted_manifest_optionals() -> None:
    payload = _manifest_payload()
    payload["runtime_targets"] = [{"name": "blender", "mode": "python"}]

    manifest = WorldScenePackageManifest.model_validate(payload)

    assert manifest.description is None
    assert manifest.runtime_targets[0].min_version is None


@pytest.mark.parametrize(
    ("mutator", "expected_path", "expected_message"),
    [
        (
            lambda payload: payload.update({"description": None}),
            "description",
            "description must be omitted or a string",
        ),
        (
            lambda payload: payload["runtime_targets"].append(
                {"name": "blender", "mode": "python", "min_version": None}
            ),
            "runtime_targets.0.min_version",
            "min_version must be omitted or a string",
        ),
    ],
)
def test_world_scene_package_model_rejects_null_manifest_optionals(
    mutator,
    expected_path: str,
    expected_message: str,
) -> None:
    payload = _manifest_payload()
    mutator(payload)

    with pytest.raises(ValidationError) as exc_info:
        WorldScenePackageManifest.model_validate(payload)

    errors = exc_info.value.errors()
    assert any(
        ".".join(str(part) for part in error["loc"]) == expected_path
        and expected_message in error["msg"]
        for error in errors
    )


@pytest.mark.parametrize(
    ("mutator", "expected_path"),
    [
        (lambda payload: payload.update({"debug": True}), "debug"),
        (
            lambda payload: payload["runtime_targets"].append(
                {"name": "worldd", "mode": "native", "debug": True}
            ),
            "runtime_targets.0.debug",
        ),
        (
            lambda payload: payload["artifacts"].append(
                {
                    "kind": "world_snapshot",
                    "digest_sha256": "0" * 64,
                    "uri": "inline://snapshot",
                    "debug": True,
                }
            ),
            "artifacts.0.debug",
        ),
        (lambda payload: payload["world_snapshot"].update({"debug": True}), "world_snapshot.debug"),
        (lambda payload: payload["security"].update({"debug": True}), "security.debug"),
    ],
)
def test_world_scene_package_model_rejects_schema_level_extra_fields(
    mutator,
    expected_path: str,
) -> None:
    payload = _manifest_payload()
    mutator(payload)

    with pytest.raises(ValidationError) as exc_info:
        WorldScenePackageManifest.model_validate(payload)

    errors = exc_info.value.errors()
    assert any(
        ".".join(str(part) for part in error["loc"]) == expected_path
        and error["type"] == "extra_forbidden"
        for error in errors
    )


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
            lambda world_object: world_object.update({"simulation": {"debug": True}}),
            "objects\\[0\\].simulation has unsupported field",
        ),
        (
            lambda world_object: world_object.update({"mesh": []}),
            "objects\\[0\\].mesh must be an object",
        ),
        (
            lambda world_object: world_object.update({"mesh": {"debug": True}}),
            "objects\\[0\\].mesh has unsupported field",
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


def test_world_snapshot_rejects_string_joint_position_before_digest_validation() -> None:
    payload = _manifest_payload()
    payload["world_snapshot"]["joint_positions"] = {"joint_1": "0.5"}

    with pytest.raises(ValidationError, match="joint_positions\\['joint_1'\\] must be a finite number"):
        WorldScenePackageManifest.model_validate(payload)


@pytest.mark.parametrize(
    "field_name",
    [
        "joint_positions",
        "cameras",
        "objects",
        "scenario_time_ms",
        "scenario_duration_ms",
    ],
)
def test_world_snapshot_requires_schema_level_fields(field_name: str) -> None:
    payload = _manifest_payload()
    payload["world_snapshot"].pop(field_name)

    with pytest.raises(ValidationError) as exc_info:
        WorldScenePackageManifest.model_validate(payload)

    assert exc_info.value.errors()[0]["loc"] == ("world_snapshot", field_name)
    assert exc_info.value.errors()[0]["type"] == "missing"


@pytest.mark.parametrize("field_name", ["scenario_time_ms", "scenario_duration_ms"])
def test_world_snapshot_rejects_non_integer_scenario_timing(field_name: str) -> None:
    payload = _manifest_payload()
    payload["world_snapshot"][field_name] = 0.5

    with pytest.raises(ValidationError, match="must be an integer millisecond value"):
        WorldScenePackageManifest.model_validate(payload)
