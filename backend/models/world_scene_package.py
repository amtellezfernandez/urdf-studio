from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.services.world_asset_refs import normalize_portable_world_asset_ref

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
)


class WorldRuntimeTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1)
    mode: Literal["native", "python", "container"]
    min_version: Optional[str] = None

    @field_validator("min_version", mode="before")
    @classmethod
    def _validate_min_version_is_not_null(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("min_version must be omitted or a string.")
        return value


class WorldInterfaceSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    observation_modalities: List[str] = Field(
        default_factory=list, max_length=MAX_INTERFACE_MODALITIES
    )
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

    signature_ref: Optional[str] = None
    attestation_refs: List[str] = Field(default_factory=list)
    sbom_ref: Optional[str] = None


class WorldSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    urdf_xml: str = Field(..., min_length=1, max_length=MAX_WORLD_SNAPSHOT_URDF_CHARS)
    joint_positions: Dict[str, float] = Field(
        default_factory=dict, max_length=MAX_JOINTS_PER_WORLD
    )
    cameras: List[Dict[str, Any]] = Field(
        default_factory=list, max_length=MAX_CAMERAS_PER_WORLD
    )
    objects: List[Dict[str, Any]] = Field(
        default_factory=list, max_length=MAX_OBJECTS_PER_WORLD
    )
    scenario_time_ms: int = Field(default=MIN_SCENARIO_TIME_MS, ge=MIN_SCENARIO_TIME_MS)
    scenario_duration_ms: int = Field(
        default=MIN_SCENARIO_DURATION_MS,
        ge=MIN_SCENARIO_DURATION_MS,
        le=MAX_SCENARIO_DURATION_MS,
    )

    @field_validator("joint_positions", mode="before")
    @classmethod
    def _validate_joint_positions_are_numbers(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        for joint_name, joint_position in value.items():
            if not _is_finite_number(joint_position):
                raise ValueError(f"joint_positions[{joint_name!r}] must be a finite number.")
        return value

    @field_validator("joint_positions")
    @classmethod
    def _validate_finite_joint_positions(cls, value: Dict[str, float]) -> Dict[str, float]:
        for joint_name, joint_position in value.items():
            if not math.isfinite(joint_position):
                raise ValueError(f"joint_positions[{joint_name!r}] must be finite.")
        return value

    @field_validator("scenario_time_ms", "scenario_duration_ms", mode="before")
    @classmethod
    def _validate_scenario_timing_is_integer(cls, value: Any) -> Any:
        if not isinstance(value, int) or isinstance(value, bool):
            raise ValueError("must be an integer millisecond value.")
        return value

    @field_validator("cameras", "objects")
    @classmethod
    def _validate_finite_payload_numbers(cls, value: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        _raise_for_non_finite_payload_numbers(value)
        return value

    @field_validator("cameras")
    @classmethod
    def _validate_camera_payloads(cls, value: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        _raise_for_invalid_camera_payloads(value)
        return value

    @field_validator("objects")
    @classmethod
    def _validate_object_payloads(cls, value: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        _raise_for_invalid_object_payloads(value)
        return value


def _raise_for_non_finite_payload_numbers(value: Any, path: str = "") -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"{path or 'payload'} must not contain non-finite numbers.")
    if isinstance(value, list):
        for index, item in enumerate(value):
            _raise_for_non_finite_payload_numbers(item, f"{path}[{index}]" if path else f"[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            field_path = f"{path}.{key}" if path else str(key)
            _raise_for_non_finite_payload_numbers(item, field_path)


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _is_positive_integer_number(value: Any) -> bool:
    if not _is_finite_number(value):
        return False
    parsed = float(value)
    return parsed >= 1.0 and parsed.is_integer()


def _is_positive_number(value: Any) -> bool:
    return _is_finite_number(value) and float(value) > 0.0


def _is_valid_fov_deg(value: Any) -> bool:
    return _is_finite_number(value) and 1.0 <= float(value) <= 179.0


def _is_boolean(value: Any) -> bool:
    return isinstance(value, bool)


def _raise_for_invalid_camera_payloads(cameras: List[Dict[str, Any]]) -> None:
    for index, camera in enumerate(cameras):
        _raise_for_invalid_camera_payload(camera, index)


def _raise_for_invalid_camera_payload(camera: Dict[str, Any], index: int) -> None:
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


def _raise_for_invalid_camera_pose(value: Any, path: str) -> None:
    if not _is_record(value):
        raise ValueError(f"{path} must be an object.")
    _raise_for_extra_fields(value, {"xyz", "rpy"}, path)
    _raise_for_invalid_vector3(value.get("xyz"), f"{path}.xyz")
    _raise_for_invalid_vector3(value.get("rpy"), f"{path}.rpy")


def _raise_for_invalid_camera_intrinsics(value: Any, path: str) -> None:
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


def _raise_for_invalid_vector3(value: Any, path: str) -> None:
    if not isinstance(value, list | tuple) or len(value) != 3:
        raise ValueError(f"{path} must be an array of 3 finite numbers.")
    for axis, component in enumerate(value):
        if not _is_finite_number(component):
            raise ValueError(f"{path}[{axis}] must be a finite number.")


WORLD_OBJECT_TYPES = {"cube", "point", "sphere", "cylinder", "mesh"}
WORLD_OBJECT_SOURCES = {
    "user",
    "world-scenario",
    "demo-world",
    "runtime-detection",
    "runtime-demo",
    "runtime-restricted-area",
    "runtime-trajectory",
}
WORLD_OBJECT_IK_TARGET_TYPES = {"punctual", "orbit"}
WORLD_OBJECT_ORBIT_TARGET_POINTS = {"center", "primary", "secondary"}
WORLD_OBJECT_MESH_ASSET_KEYS = ("asset_ref", "path", "uri", "filename")
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


def _raise_for_invalid_object_payloads(objects: List[Dict[str, Any]]) -> None:
    for index, world_object in enumerate(objects):
        _raise_for_invalid_object_payload(world_object, index)


def _raise_for_invalid_object_payload(world_object: Dict[str, Any], index: int) -> None:
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
    _raise_for_invalid_object_mesh_metadata(world_object, object_path)


def _raise_for_invalid_object_optional_fields(world_object: Dict[str, Any], object_path: str) -> None:
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


def _raise_for_invalid_object_simulation(value: Any, object_path: str) -> None:
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


def _raise_for_invalid_object_mesh_metadata(world_object: Dict[str, Any], object_path: str) -> None:
    if "asset_ref" in world_object:
        _raise_for_portable_asset_ref(world_object.get("asset_ref"), f"{object_path}.asset_ref")
    if "asset_scale_xyz" in world_object:
        _raise_for_positive_vector3(world_object.get("asset_scale_xyz"), f"{object_path}.asset_scale_xyz")
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
    if world_object.get("type") == "mesh" and not _has_wsp_mesh_asset_ref(world_object):
        raise ValueError(f"{object_path}.mesh asset reference is required for mesh objects.")


def _has_wsp_mesh_asset_ref(world_object: Dict[str, Any]) -> bool:
    if _is_non_empty_string(world_object.get("asset_ref")):
        return _is_portable_asset_ref(world_object.get("asset_ref"))
    mesh = world_object.get("mesh")
    if not _is_record(mesh):
        return False
    return any(
        _is_non_empty_string(mesh.get(field_name)) and _is_portable_asset_ref(mesh.get(field_name))
        for field_name in WORLD_OBJECT_MESH_ASSET_KEYS
    )


def _is_portable_asset_ref(value: Any) -> bool:
    if not _is_non_empty_string(value):
        return False
    try:
        normalize_portable_world_asset_ref(value)
    except ValueError:
        return False
    return True


def _raise_for_portable_asset_ref(value: Any, path: str) -> None:
    if not _is_non_empty_string(value):
        raise ValueError(f"{path} must be a non-empty string.")
    if not _is_portable_asset_ref(value):
        raise ValueError(f"{path} must be a portable relative asset reference.")


def _raise_for_positive_vector3(value: Any, path: str) -> None:
    _raise_for_invalid_vector3(value, path)
    for axis, component in enumerate(value):
        if component <= 0:
            raise ValueError(f"{path}[{axis}] must be > 0.")


def _raise_for_positive_number_field(value: Any, path: str) -> None:
    if not _is_positive_number(value):
        raise ValueError(f"{path} must be a finite number > 0.")


def _raise_for_optional_finite_number(
    value: Any,
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


def _raise_for_extra_fields(value: Dict[str, Any], allowed_fields: set[str], path: str) -> None:
    extra_fields = sorted(set(value) - allowed_fields)
    if extra_fields:
        joined = ", ".join(extra_fields)
        raise ValueError(f"{path} has unsupported field(s): {joined}.")


class WorldScenePackageManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1]
    package_id: str = Field(..., min_length=1)
    version: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    description: Optional[str] = None
    created_at: datetime
    runtime_targets: List[WorldRuntimeTarget] = Field(..., max_length=MAX_RUNTIME_TARGETS)
    interface: WorldInterfaceSpec
    artifacts: List[WorldArtifactRef] = Field(..., max_length=MAX_ARTIFACT_REFS)
    world_snapshot: WorldSnapshot
    provenance: Dict[str, Any]
    security: WorldSecuritySpec

    @field_validator("description", mode="before")
    @classmethod
    def _validate_description_is_not_null(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("description must be omitted or a string.")
        return value


class WorldScenePackageValidationResponse(BaseModel):
    valid: bool
    digest_sha256: str
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)


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
    description: Optional[str] = None
    owner: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    preview_image_url: Optional[str] = None
    source_registry: Optional[str] = None
    trust_level: Literal[
        WORLD_SCENE_PACKAGE_TRUST_METADATA_ONLY,
        WORLD_SCENE_PACKAGE_TRUST_SIGNED_METADATA,
        WORLD_SCENE_PACKAGE_TRUST_METADATA_COMPLETE,
    ]
    runtime_targets: List[str] = Field(default_factory=list)


class WorldScenePackageVersionRecord(BaseModel):
    package_id: str
    version: str
    digest_sha256: str
    published_at: datetime
    manifest: WorldScenePackageManifest


class WorldRegistryBackendStatus(BaseModel):
    backend_id: str
    label: str
    status: Literal["available", "unavailable"]
    reason: Optional[str] = None


class WorldRegistryCapabilitiesResponse(BaseModel):
    source: str
    available: bool
    unavailable_backends: List[WorldRegistryBackendStatus] = Field(default_factory=list)
    can_list: bool
    can_get_version: bool
    can_publish: bool
