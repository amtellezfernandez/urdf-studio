from __future__ import annotations

import math
from datetime import datetime
from typing import Literal, TypeAlias, TypeGuard

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.models.json_payload import JsonObject
from backend.services.world_asset_refs import (
    has_world_object_content_asset_ref,
    normalize_portable_world_asset_ref,
)
from backend.services.world_scene_contract import (
    WORLD_OBJECT_MESH_ASSET_KEYS,
    WORLD_OBJECT_TYPES,
)

from backend.services.world_scene_package_params import (
    MAX_ARTIFACT_REFS,
    MAX_CAMERAS_PER_WORLD,
    MAX_INTERFACE_MODALITIES,
    MAX_JOINTS_PER_WORLD,
    MAX_OBJECTS_PER_WORLD,
    MAX_RUNTIME_TARGETS,
    MAX_SCENARIO_DURATION_MS,
    MAX_WORLD_SNAPSHOT_URDF_CHARS,
    MIN_SCENARIO_DURATION_MS,
    MIN_SCENARIO_TIME_MS,
    SHA256_HEX_LENGTH,
    WORLD_SCENE_PACKAGE_TRUST_METADATA_COMPLETE,
    WORLD_SCENE_PACKAGE_TRUST_METADATA_ONLY,
    WORLD_SCENE_PACKAGE_TRUST_SIGNED_METADATA,
    WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1,
    WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1_1,
)

WorldScenePayload: TypeAlias = JsonObject


class WorldRuntimeTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1)
    mode: Literal["native", "python", "container"]
    min_version: str | None = None

    @field_validator("min_version", mode="before")
    @classmethod
    def _validate_min_version_is_not_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("min_version must be omitted or a string.")
        return value


class WorldInterfaceSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    observation_modalities: list[str] = Field(..., max_length=MAX_INTERFACE_MODALITIES)
    action_semantics: str = Field(..., min_length=1)
    timestep_ms: int = Field(..., ge=1)
    frame_convention: str = Field(..., min_length=1)


class WorldArtifactRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str = Field(..., min_length=1)
    digest_sha256: str = Field(
        ...,
        min_length=SHA256_HEX_LENGTH,
        max_length=SHA256_HEX_LENGTH,
        pattern="^[a-fA-F0-9]{64}$",
    )
    uri: str = Field(..., min_length=1)


class WorldSecuritySpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signature_ref: str | None = None
    attestation_refs: list[str]
    sbom_ref: str | None = None


class WorldSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    urdf_xml: str = Field(..., min_length=1, max_length=MAX_WORLD_SNAPSHOT_URDF_CHARS)
    joint_positions: dict[str, float] = Field(..., max_length=MAX_JOINTS_PER_WORLD)
    cameras: list[WorldScenePayload] = Field(..., max_length=MAX_CAMERAS_PER_WORLD)
    objects: list[WorldScenePayload] = Field(..., max_length=MAX_OBJECTS_PER_WORLD)
    scenario_time_ms: int = Field(..., ge=MIN_SCENARIO_TIME_MS)
    scenario_duration_ms: int = Field(
        ...,
        ge=MIN_SCENARIO_DURATION_MS,
        le=MAX_SCENARIO_DURATION_MS,
    )

    @field_validator("joint_positions", mode="before")
    @classmethod
    def _validate_joint_positions_are_numbers(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        for joint_name, joint_position in value.items():
            if not _is_finite_number(joint_position):
                raise ValueError(f"joint_positions[{joint_name!r}] must be a finite number.")
        return value

    @field_validator("joint_positions")
    @classmethod
    def _validate_finite_joint_positions(cls, value: dict[str, float]) -> dict[str, float]:
        for joint_name, joint_position in value.items():
            if not math.isfinite(joint_position):
                raise ValueError(f"joint_positions[{joint_name!r}] must be finite.")
        return value

    @field_validator("scenario_time_ms", "scenario_duration_ms", mode="before")
    @classmethod
    def _validate_scenario_timing_is_integer(cls, value: object) -> object:
        if not isinstance(value, int) or isinstance(value, bool):
            raise ValueError("must be an integer millisecond value.")
        return value

    @field_validator("cameras", "objects")
    @classmethod
    def _validate_finite_payload_numbers(
        cls, value: list[WorldScenePayload]
    ) -> list[WorldScenePayload]:
        raise_for_non_finite_world_payload_numbers(value)
        return value

    @field_validator("cameras")
    @classmethod
    def _validate_camera_payloads(cls, value: list[WorldScenePayload]) -> list[WorldScenePayload]:
        raise_for_invalid_world_scene_cameras(value)
        return value

    @field_validator("objects")
    @classmethod
    def _validate_object_payloads(cls, value: list[WorldScenePayload]) -> list[WorldScenePayload]:
        raise_for_invalid_world_scene_objects(value)
        return value


def raise_for_non_finite_world_payload_numbers(value: object, path: str = "") -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"{path or 'payload'} must not contain non-finite numbers.")
    if isinstance(value, list):
        for index, item in enumerate(value):
            raise_for_non_finite_world_payload_numbers(
                item,
                f"{path}[{index}]" if path else f"[{index}]",
            )
        return
    if isinstance(value, dict):
        for key, item in value.items():
            field_path = f"{path}.{key}" if path else str(key)
            raise_for_non_finite_world_payload_numbers(item, field_path)


def _is_record(value: object) -> TypeGuard[WorldScenePayload]:
    return isinstance(value, dict)


def _is_non_empty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _is_finite_number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _is_positive_integer_number(value: object) -> bool:
    if not _is_finite_number(value):
        return False
    parsed = float(value)
    return parsed >= 1.0 and parsed.is_integer()


def _is_positive_number(value: object) -> bool:
    return _is_finite_number(value) and float(value) > 0.0


def _is_valid_fov_deg(value: object) -> bool:
    return _is_finite_number(value) and 1.0 <= float(value) <= 179.0


def _is_boolean(value: object) -> bool:
    return isinstance(value, bool)


def raise_for_invalid_world_scene_cameras(cameras: list[WorldScenePayload]) -> None:
    for index, camera in enumerate(cameras):
        _raise_for_invalid_camera_payload(camera, index)


def _raise_for_invalid_camera_payload(camera: WorldScenePayload, index: int) -> None:
    camera_path = f"cameras[{index}]"
    if not _is_record(camera):
        raise ValueError(f"{camera_path} must be an object.")
    allowed_camera_fields = {"id", "name", "parent_joint", "pose", "intrinsics"}
    _raise_for_extra_fields(camera, allowed_camera_fields, camera_path)
    for field_name in ("id", "name", "parent_joint"):
        if not _is_non_empty_string(camera.get(field_name)):
            raise ValueError(f"{camera_path}.{field_name} must be a non-empty string.")
    _raise_for_invalid_camera_pose(camera.get("pose"), f"{camera_path}.pose")
    _raise_for_invalid_camera_intrinsics(camera.get("intrinsics"), f"{camera_path}.intrinsics")


def _raise_for_invalid_camera_pose(value: object, path: str) -> None:
    if not _is_record(value):
        raise ValueError(f"{path} must be an object.")
    _raise_for_extra_fields(value, {"xyz", "rpy"}, path)
    _raise_for_invalid_vector3(value.get("xyz"), f"{path}.xyz")
    _raise_for_invalid_vector3(value.get("rpy"), f"{path}.rpy")


def _raise_for_invalid_camera_intrinsics(value: object, path: str) -> None:
    if not _is_record(value):
        raise ValueError(f"{path} must be an object.")
    _raise_for_extra_fields(
        value,
        {"width", "height", "fov_deg", "fx", "fy", "cx", "cy", "distortion"},
        path,
    )
    if not _is_positive_integer_number(value.get("width")):
        raise ValueError(f"{path}.width must be a positive integer.")
    if not _is_positive_integer_number(value.get("height")):
        raise ValueError(f"{path}.height must be a positive integer.")
    if "fov_deg" in value and not _is_valid_fov_deg(value.get("fov_deg")):
        raise ValueError(f"{path}.fov_deg must be between 1 and 179 degrees.")
    for field_name in ("fx", "fy"):
        if field_name in value and not _is_positive_number(value.get(field_name)):
            raise ValueError(f"{path}.{field_name} must be a finite number > 0.")
    for field_name in ("cx", "cy"):
        if field_name in value and not _is_finite_number(value.get(field_name)):
            raise ValueError(f"{path}.{field_name} must be a finite number.")
    if not any(field_name in value for field_name in ("fov_deg", "fx", "fy")):
        raise ValueError(f"{path} must include fov_deg, fx, or fy.")
    if "distortion" in value and not _is_record(value.get("distortion")):
        raise ValueError(f"{path}.distortion must be an object.")


def _raise_for_invalid_vector3(value: object, path: str) -> None:
    if not isinstance(value, list | tuple) or len(value) != 3:
        raise ValueError(f"{path} must be an array of 3 finite numbers.")
    for axis, component in enumerate(value):
        if not _is_finite_number(component):
            raise ValueError(f"{path}[{axis}] must be a finite number.")


WORLD_OBJECT_SOURCES = {
    "user",
    "world-scenario",
    "demo-world",
}
WORLD_OBJECT_IK_TARGET_TYPES = {"punctual", "orbit"}
WORLD_OBJECT_ORBIT_TARGET_POINTS = {"center", "primary", "secondary"}
WORLD_OBJECT_SIMULATION_FIELDS = {
    "fixed",
    "collision",
    "mass_kg",
    "friction",
    "restitution",
    "semantic_role",
}
WORLD_OBJECT_MESH_FIELDS = {
    *WORLD_OBJECT_MESH_ASSET_KEYS,
    "scale",
    "scale_xyz",
}
WORLD_OBJECT_APPEARANCE_FIELDS = {"representations"}
WORLD_OBJECT_APPEARANCE_REPRESENTATION_FIELDS = {
    "id",
    "kind",
    "asset_ref",
    "scale_xyz",
    "semantic_role",
}
WORLD_OBJECT_APPEARANCE_REPRESENTATION_KINDS = {"mesh", "primitive", "splat"}
WORLD_OBJECT_PHYSICS_FIELDS = {
    *WORLD_OBJECT_SIMULATION_FIELDS,
    "collision_geometry",
    "inertia",
}
WORLD_OBJECT_PHYSICS_GEOMETRY_FIELDS = {
    "id",
    "kind",
    "asset_ref",
    "size_xyz",
    "radius",
    "length",
    "scale_xyz",
}
WORLD_OBJECT_PHYSICS_GEOMETRY_KINDS = {"box", "sphere", "cylinder", "mesh"}
WORLD_OBJECT_INERTIA_FIELDS = {"ixx", "iyy", "izz", "ixy", "ixz", "iyz"}
WORLD_OBJECT_CONSISTENCY_FIELDS = {
    "appearance_ref",
    "physics_ref",
    "method",
    "metrics",
    "status",
}
WORLD_OBJECT_CONSISTENCY_STATUSES = {"valid", "warning", "missing", "unchecked"}


def raise_for_invalid_world_scene_objects(
    objects: list[WorldScenePayload],
    *,
    require_mesh_asset_ref: bool = True,
) -> None:
    for index, world_object in enumerate(objects):
        _raise_for_invalid_object_payload(
            world_object,
            index,
            require_mesh_asset_ref=require_mesh_asset_ref,
        )


def _raise_for_invalid_object_payload(
    world_object: WorldScenePayload,
    index: int,
    *,
    require_mesh_asset_ref: bool,
) -> None:
    object_path = f"objects[{index}]"
    if not _is_record(world_object):
        raise ValueError(f"{object_path} must be an object.")
    for field_name in ("id", "name", "color"):
        if not _is_non_empty_string(world_object.get(field_name)):
            raise ValueError(f"{object_path}.{field_name} must be a non-empty string.")
    object_type = world_object.get("type")
    if object_type not in WORLD_OBJECT_TYPES:
        allowed = ", ".join(sorted(WORLD_OBJECT_TYPES))
        raise ValueError(f"{object_path}.type must be one of: {allowed}.")
    _raise_for_invalid_vector3(world_object.get("position_xyz"), f"{object_path}.position_xyz")
    _raise_for_positive_vector3(world_object.get("size_xyz"), f"{object_path}.size_xyz")
    if "rotation_rpy_rad" in world_object:
        _raise_for_invalid_vector3(
            world_object.get("rotation_rpy_rad"),
            f"{object_path}.rotation_rpy_rad",
        )
    _raise_for_invalid_object_optional_fields(world_object, object_path)
    _raise_for_invalid_object_simulation(world_object.get("simulation"), object_path)
    _raise_for_invalid_object_mesh_metadata(
        world_object,
        object_path,
        require_mesh_asset_ref=require_mesh_asset_ref,
    )
    _raise_for_invalid_object_appearance(world_object.get("appearance"), world_object, object_path)
    _raise_for_invalid_object_physics(world_object.get("physics"), object_path)
    _raise_for_invalid_object_consistency(world_object.get("consistency"), object_path)


def _raise_for_invalid_object_optional_fields(
    world_object: WorldScenePayload, object_path: str
) -> None:
    if "source" in world_object and world_object.get("source") not in WORLD_OBJECT_SOURCES:
        allowed = ", ".join(sorted(WORLD_OBJECT_SOURCES))
        raise ValueError(f"{object_path}.source must be one of: {allowed}.")
    if "tracked_joint_name" in world_object and world_object.get("tracked_joint_name") is not None:
        if not isinstance(world_object.get("tracked_joint_name"), str):
            raise ValueError(f"{object_path}.tracked_joint_name must be a string or null.")
    for field_name in ("is_hidden", "is_ik_target"):
        if field_name in world_object and not _is_boolean(world_object.get(field_name)):
            raise ValueError(f"{object_path}.{field_name} must be a boolean.")
    ik_target_type = world_object.get("ik_target_type", "punctual")
    if ik_target_type not in WORLD_OBJECT_IK_TARGET_TYPES:
        allowed = ", ".join(sorted(WORLD_OBJECT_IK_TARGET_TYPES))
        raise ValueError(f"{object_path}.ik_target_type must be one of: {allowed}.")
    if ik_target_type == "orbit":
        _raise_for_positive_number_field(world_object.get("orbit_radius"), f"{object_path}.orbit_radius")
        for field_name in ("orbit_inclination_deg", "orbit_phase_deg", "orbit_secondary_offset_deg"):
            if not _is_finite_number(world_object.get(field_name)):
                raise ValueError(f"{object_path}.{field_name} must be a finite number.")
        if "orbit_target_point" in world_object:
            if world_object.get("orbit_target_point") not in WORLD_OBJECT_ORBIT_TARGET_POINTS:
                allowed = ", ".join(sorted(WORLD_OBJECT_ORBIT_TARGET_POINTS))
                raise ValueError(f"{object_path}.orbit_target_point must be one of: {allowed}.")


def _raise_for_invalid_object_simulation(value: object, object_path: str) -> None:
    if value is None:
        return
    if not _is_record(value):
        raise ValueError(f"{object_path}.simulation must be an object.")
    _raise_for_extra_fields(value, WORLD_OBJECT_SIMULATION_FIELDS, f"{object_path}.simulation")
    for field_name in ("fixed", "collision"):
        if field_name in value and not _is_boolean(value.get(field_name)):
            raise ValueError(f"{object_path}.simulation.{field_name} must be a boolean.")
    _raise_for_optional_finite_number(
        value.get("mass_kg"),
        f"{object_path}.simulation.mass_kg",
        minimum=0.0,
    )
    _raise_for_optional_finite_number(
        value.get("friction"),
        f"{object_path}.simulation.friction",
        minimum=0.01,
        maximum=5.0,
    )
    _raise_for_optional_finite_number(
        value.get("restitution"),
        f"{object_path}.simulation.restitution",
        minimum=0.0,
        maximum=1.0,
    )
    if "semantic_role" in value and value.get("semantic_role") is not None:
        if not isinstance(value.get("semantic_role"), str):
            raise ValueError(f"{object_path}.simulation.semantic_role must be a string or null.")


def _raise_for_invalid_object_mesh_metadata(
    world_object: WorldScenePayload,
    object_path: str,
    *,
    require_mesh_asset_ref: bool,
) -> None:
    if "asset_ref" in world_object:
        _raise_for_portable_asset_ref(world_object.get("asset_ref"), f"{object_path}.asset_ref")
    for field_name in ("asset_scale_xyz", "mesh_scale_xyz", "scale_xyz"):
        if field_name in world_object:
            _raise_for_positive_vector3(world_object.get(field_name), f"{object_path}.{field_name}")
    mesh = world_object.get("mesh")
    if mesh is not None and not _is_record(mesh):
        raise ValueError(f"{object_path}.mesh must be an object.")
    if _is_record(mesh):
        _raise_for_extra_fields(mesh, WORLD_OBJECT_MESH_FIELDS, f"{object_path}.mesh")
        for field_name in WORLD_OBJECT_MESH_ASSET_KEYS:
            if field_name in mesh:
                _raise_for_portable_asset_ref(mesh.get(field_name), f"{object_path}.mesh.{field_name}")
        if "scale" in mesh:
            scale = mesh.get("scale")
            if _is_finite_number(scale):
                _raise_for_positive_number_field(scale, f"{object_path}.mesh.scale")
            else:
                _raise_for_positive_vector3(scale, f"{object_path}.mesh.scale")
        if "scale_xyz" in mesh:
            _raise_for_positive_vector3(mesh.get("scale_xyz"), f"{object_path}.mesh.scale_xyz")
    if (
        require_mesh_asset_ref
        and world_object.get("type") == "mesh"
        and not _has_wsp_mesh_asset_ref(world_object)
    ):
        raise ValueError(f"{object_path}.mesh asset reference is required for mesh objects.")


def _raise_for_invalid_object_appearance(
    value: object,
    world_object: WorldScenePayload,
    object_path: str,
) -> None:
    if value is None:
        return
    if not _is_record(value):
        raise ValueError(f"{object_path}.appearance must be an object.")
    _raise_for_extra_fields(value, WORLD_OBJECT_APPEARANCE_FIELDS, f"{object_path}.appearance")
    representations = value.get("representations")
    if not isinstance(representations, list) or not representations:
        raise ValueError(f"{object_path}.appearance.representations must be a non-empty array.")
    has_splat = False
    for index, representation in enumerate(representations):
        representation_path = f"{object_path}.appearance.representations[{index}]"
        if not _is_record(representation):
            raise ValueError(f"{representation_path} must be an object.")
        _raise_for_extra_fields(
            representation,
            WORLD_OBJECT_APPEARANCE_REPRESENTATION_FIELDS,
            representation_path,
        )
        if not _is_non_empty_string(representation.get("id")):
            raise ValueError(f"{representation_path}.id must be a non-empty string.")
        kind = representation.get("kind")
        if kind not in WORLD_OBJECT_APPEARANCE_REPRESENTATION_KINDS:
            allowed = ", ".join(sorted(WORLD_OBJECT_APPEARANCE_REPRESENTATION_KINDS))
            raise ValueError(f"{representation_path}.kind must be one of: {allowed}.")
        if kind in {"mesh", "splat"}:
            _raise_for_portable_asset_ref(
                representation.get("asset_ref"),
                f"{representation_path}.asset_ref",
            )
        elif "asset_ref" in representation:
            _raise_for_portable_asset_ref(
                representation.get("asset_ref"),
                f"{representation_path}.asset_ref",
            )
        if "scale_xyz" in representation:
            _raise_for_positive_vector3(
                representation.get("scale_xyz"),
                f"{representation_path}.scale_xyz",
            )
        if "semantic_role" in representation and representation.get("semantic_role") is not None:
            if not isinstance(representation.get("semantic_role"), str):
                raise ValueError(f"{representation_path}.semantic_role must be a string or null.")
        has_splat = has_splat or kind == "splat"
    if has_splat and not _has_physics_collision_geometry(world_object):
        raise ValueError(
            f"{object_path}.appearance splat representations require physics.collision_geometry."
        )


def _raise_for_invalid_object_physics(value: object, object_path: str) -> None:
    if value is None:
        return
    if not _is_record(value):
        raise ValueError(f"{object_path}.physics must be an object.")
    _raise_for_extra_fields(value, WORLD_OBJECT_PHYSICS_FIELDS, f"{object_path}.physics")
    for field_name in ("fixed", "collision"):
        if field_name in value and not _is_boolean(value.get(field_name)):
            raise ValueError(f"{object_path}.physics.{field_name} must be a boolean.")
    _raise_for_optional_finite_number(
        value.get("mass_kg"),
        f"{object_path}.physics.mass_kg",
        minimum=0.0,
    )
    _raise_for_optional_finite_number(
        value.get("friction"),
        f"{object_path}.physics.friction",
        minimum=0.01,
        maximum=5.0,
    )
    _raise_for_optional_finite_number(
        value.get("restitution"),
        f"{object_path}.physics.restitution",
        minimum=0.0,
        maximum=1.0,
    )
    if "semantic_role" in value and value.get("semantic_role") is not None:
        if not isinstance(value.get("semantic_role"), str):
            raise ValueError(f"{object_path}.physics.semantic_role must be a string or null.")
    if "collision_geometry" in value:
        _raise_for_invalid_physics_collision_geometry(
            value.get("collision_geometry"),
            f"{object_path}.physics.collision_geometry",
        )
    if "inertia" in value:
        _raise_for_invalid_physics_inertia(value.get("inertia"), f"{object_path}.physics.inertia")


def _raise_for_invalid_physics_collision_geometry(value: object, path: str) -> None:
    if not _is_record(value):
        raise ValueError(f"{path} must be an object.")
    _raise_for_extra_fields(value, WORLD_OBJECT_PHYSICS_GEOMETRY_FIELDS, path)
    if "id" in value and not _is_non_empty_string(value.get("id")):
        raise ValueError(f"{path}.id must be a non-empty string.")
    kind = value.get("kind")
    if kind not in WORLD_OBJECT_PHYSICS_GEOMETRY_KINDS:
        allowed = ", ".join(sorted(WORLD_OBJECT_PHYSICS_GEOMETRY_KINDS))
        raise ValueError(f"{path}.kind must be one of: {allowed}.")
    if kind == "box":
        _raise_for_positive_vector3(value.get("size_xyz"), f"{path}.size_xyz")
    if kind == "sphere":
        _raise_for_positive_number_field(value.get("radius"), f"{path}.radius")
    if kind == "cylinder":
        _raise_for_positive_number_field(value.get("radius"), f"{path}.radius")
        _raise_for_positive_number_field(value.get("length"), f"{path}.length")
    if kind == "mesh":
        _raise_for_portable_asset_ref(value.get("asset_ref"), f"{path}.asset_ref")
    if "asset_ref" in value:
        _raise_for_portable_asset_ref(value.get("asset_ref"), f"{path}.asset_ref")
    if "scale_xyz" in value:
        _raise_for_positive_vector3(value.get("scale_xyz"), f"{path}.scale_xyz")


def _raise_for_invalid_physics_inertia(value: object, path: str) -> None:
    if not _is_record(value):
        raise ValueError(f"{path} must be an object.")
    _raise_for_extra_fields(value, WORLD_OBJECT_INERTIA_FIELDS, path)
    for field_name in ("ixx", "iyy", "izz"):
        if not _is_finite_number(value.get(field_name)) or value.get(field_name) < 0:
            raise ValueError(f"{path}.{field_name} must be a finite number >= 0.")
    for field_name in ("ixy", "ixz", "iyz"):
        if field_name in value and not _is_finite_number(value.get(field_name)):
            raise ValueError(f"{path}.{field_name} must be a finite number.")


def _raise_for_invalid_object_consistency(value: object, object_path: str) -> None:
    if value is None:
        return
    if not _is_record(value):
        raise ValueError(f"{object_path}.consistency must be an object.")
    _raise_for_extra_fields(value, WORLD_OBJECT_CONSISTENCY_FIELDS, f"{object_path}.consistency")
    for field_name in ("appearance_ref", "physics_ref", "method"):
        if not _is_non_empty_string(value.get(field_name)):
            raise ValueError(f"{object_path}.consistency.{field_name} must be a non-empty string.")
    status = value.get("status")
    if status not in WORLD_OBJECT_CONSISTENCY_STATUSES:
        allowed = ", ".join(sorted(WORLD_OBJECT_CONSISTENCY_STATUSES))
        raise ValueError(f"{object_path}.consistency.status must be one of: {allowed}.")
    if "metrics" in value and not _is_record(value.get("metrics")):
        raise ValueError(f"{object_path}.consistency.metrics must be an object.")


def _has_wsp_mesh_asset_ref(world_object: WorldScenePayload) -> bool:
    return has_world_object_content_asset_ref(world_object)


def _has_physics_collision_geometry(world_object: WorldScenePayload) -> bool:
    physics = world_object.get("physics")
    return _is_record(physics) and _is_record(physics.get("collision_geometry"))


def _is_portable_asset_ref(value: object) -> bool:
    if not _is_non_empty_string(value):
        return False
    try:
        normalize_portable_world_asset_ref(value)
    except ValueError:
        return False
    return True


def _raise_for_portable_asset_ref(value: object, path: str) -> None:
    if not _is_non_empty_string(value):
        raise ValueError(f"{path} must be a non-empty string.")
    if not _is_portable_asset_ref(value):
        raise ValueError(f"{path} must be a portable relative asset reference.")


def _raise_for_positive_vector3(value: object, path: str) -> None:
    _raise_for_invalid_vector3(value, path)
    for axis, component in enumerate(value):
        if component <= 0:
            raise ValueError(f"{path}[{axis}] must be > 0.")


def _raise_for_positive_number_field(value: object, path: str) -> None:
    if not _is_positive_number(value):
        raise ValueError(f"{path} must be a finite number > 0.")


def _raise_for_optional_finite_number(
    value: object,
    path: str,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> None:
    if value is None:
        return
    if not _is_finite_number(value):
        raise ValueError(f"{path} must be a finite number or null.")
    parsed = float(value)
    if minimum is not None and parsed < minimum:
        raise ValueError(f"{path} must be >= {minimum:g}.")
    if maximum is not None and parsed > maximum:
        raise ValueError(f"{path} must be <= {maximum:g}.")


def _raise_for_extra_fields(value: WorldScenePayload, allowed_fields: set[str], path: str) -> None:
    extra_fields = sorted(set(value) - allowed_fields)
    if extra_fields:
        joined = ", ".join(extra_fields)
        raise ValueError(f"{path} has unsupported field(s): {joined}.")


class WorldScenePackageManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[
        WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1,
        WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1_1,
    ]
    package_id: str = Field(..., min_length=1)
    version: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    description: str | None = None
    created_at: datetime
    runtime_targets: list[WorldRuntimeTarget] = Field(..., max_length=MAX_RUNTIME_TARGETS)
    interface: WorldInterfaceSpec
    artifacts: list[WorldArtifactRef] = Field(..., max_length=MAX_ARTIFACT_REFS)
    world_snapshot: WorldSnapshot
    provenance: WorldScenePayload
    security: WorldSecuritySpec

    @field_validator("description", mode="before")
    @classmethod
    def _validate_description_is_not_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("description must be omitted or a string.")
        return value


class WorldSceneDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    objects: list[WorldScenePayload] = Field(..., max_length=MAX_OBJECTS_PER_WORLD)
    scenario_time_ms: int = Field(..., ge=MIN_SCENARIO_TIME_MS)
    scenario_duration_ms: int = Field(
        ...,
        ge=MIN_SCENARIO_DURATION_MS,
        le=MAX_SCENARIO_DURATION_MS,
    )
    urdf_xml: str | None = Field(default=None, min_length=1, max_length=MAX_WORLD_SNAPSHOT_URDF_CHARS)
    joint_positions: dict[str, float] | None = Field(default=None, max_length=MAX_JOINTS_PER_WORLD)
    cameras: list[WorldScenePayload] | None = Field(default=None, max_length=MAX_CAMERAS_PER_WORLD)
    environment: WorldScenePayload | None = None

    @field_validator("name", "urdf_xml", mode="before")
    @classmethod
    def _validate_optional_strings_are_not_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("field must be omitted or a string.")
        return value

    @field_validator("joint_positions", mode="before")
    @classmethod
    def _validate_optional_joint_positions_are_numbers(cls, value: object) -> object:
        if value is None or not isinstance(value, dict):
            return value
        for joint_name, joint_position in value.items():
            if not _is_finite_number(joint_position):
                raise ValueError(f"joint_positions[{joint_name!r}] must be a finite number.")
        return value

    @field_validator("joint_positions")
    @classmethod
    def _validate_optional_finite_joint_positions(
        cls,
        value: dict[str, float] | None,
    ) -> dict[str, float] | None:
        if value is None:
            return None
        for joint_name, joint_position in value.items():
            if not math.isfinite(joint_position):
                raise ValueError(f"joint_positions[{joint_name!r}] must be finite.")
        return value

    @field_validator("scenario_time_ms", "scenario_duration_ms", mode="before")
    @classmethod
    def _validate_scene_timing_is_integer(cls, value: object) -> object:
        if not isinstance(value, int) or isinstance(value, bool):
            raise ValueError("must be an integer millisecond value.")
        return value

    @field_validator("objects")
    @classmethod
    def _validate_document_objects(cls, value: list[WorldScenePayload]) -> list[WorldScenePayload]:
        raise_for_non_finite_world_payload_numbers(value)
        raise_for_invalid_world_scene_objects(value, require_mesh_asset_ref=False)
        return value

    @field_validator("cameras")
    @classmethod
    def _validate_optional_document_cameras(
        cls,
        value: list[WorldScenePayload] | None,
    ) -> list[WorldScenePayload] | None:
        if value is None:
            return None
        raise_for_non_finite_world_payload_numbers(value)
        raise_for_invalid_world_scene_cameras(value)
        return value

    @field_validator("environment")
    @classmethod
    def _validate_environment_payload(
        cls,
        value: WorldScenePayload | None,
    ) -> WorldScenePayload | None:
        if value is None:
            return None
        if not isinstance(value, dict):
            raise ValueError("environment must be an object.")
        raise_for_non_finite_world_payload_numbers(value)
        return value


class WorldSceneRegistryEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    package_id: str = Field(..., min_length=1)
    version: str = Field(..., min_length=1)
    description: str | None = None
    provenance: WorldScenePayload
    artifacts: list[WorldArtifactRef] = Field(..., max_length=MAX_ARTIFACT_REFS)
    world: WorldSceneDocument

    @field_validator("description", mode="before")
    @classmethod
    def _validate_envelope_description_is_not_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("description must be omitted or a string.")
        return value


class WorldScenePackageValidationResponse(BaseModel):
    valid: bool
    digest_sha256: str
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


class WorldScenePackagePublishResponse(BaseModel):
    package_id: str
    version: str
    digest_sha256: str
    created: bool


class WorldScenePackageListEntry(BaseModel):
    package_id: str
    latest_version: str
    latest_digest_sha256: str
    updated_at: datetime
    title: str
    description: str | None = None
    owner: str | None = None
    tags: list[str] = Field(default_factory=list)
    preview_image_url: str | None = None
    source_registry: str | None = None
    trust_level: Literal[
        WORLD_SCENE_PACKAGE_TRUST_METADATA_ONLY,
        WORLD_SCENE_PACKAGE_TRUST_SIGNED_METADATA,
        WORLD_SCENE_PACKAGE_TRUST_METADATA_COMPLETE,
    ]
    runtime_targets: list[str] = Field(default_factory=list)


class WorldScenePackageVersionRecord(BaseModel):
    package_id: str
    version: str
    digest_sha256: str
    published_at: datetime
    manifest: WorldScenePackageManifest


class WorldScenePackageVersionDocumentRecord(BaseModel):
    package_id: str
    version: str
    digest_sha256: str
    published_at: datetime
    manifest: WorldSceneRegistryEnvelope


class WorldRegistryBackendStatus(BaseModel):
    backend_id: str
    label: str
    status: Literal["available", "unavailable"]
    reason: str | None = None


class WorldRegistryCapabilitiesResponse(BaseModel):
    source: str
    available: bool
    unavailable_backends: list[WorldRegistryBackendStatus] = Field(default_factory=list)
    can_list: bool
    can_get_version: bool
    can_publish: bool
