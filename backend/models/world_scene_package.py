from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

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
    name: str = Field(..., min_length=1)
    mode: Literal["native", "python", "container"]
    min_version: Optional[str] = None


class WorldInterfaceSpec(BaseModel):
    observation_modalities: List[str] = Field(
        default_factory=list, max_length=MAX_INTERFACE_MODALITIES
    )
    action_semantics: str = Field(..., min_length=1)
    timestep_ms: int = Field(..., ge=1)
    frame_convention: str = Field(..., min_length=1)


class WorldArtifactRef(BaseModel):
    kind: str = Field(..., min_length=1)
    digest_sha256: str = Field(
        ...,
        min_length=SHA256_HEX_LENGTH,
        max_length=SHA256_HEX_LENGTH,
        pattern="^[a-fA-F0-9]{64}$",
    )
    uri: str = Field(..., min_length=1)


class WorldSecuritySpec(BaseModel):
    signature_ref: Optional[str] = None
    attestation_refs: List[str] = Field(default_factory=list)
    sbom_ref: Optional[str] = None


class WorldSnapshot(BaseModel):
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

    @field_validator("joint_positions")
    @classmethod
    def _validate_finite_joint_positions(cls, value: Dict[str, float]) -> Dict[str, float]:
        for joint_name, joint_position in value.items():
            if not math.isfinite(joint_position):
                raise ValueError(f"joint_positions[{joint_name!r}] must be finite.")
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


def _raise_for_extra_fields(value: Dict[str, Any], allowed_fields: set[str], path: str) -> None:
    extra_fields = sorted(set(value) - allowed_fields)
    if extra_fields:
        joined = ", ".join(extra_fields)
        raise ValueError(f"{path} has unsupported field(s): {joined}.")


class WorldScenePackageManifest(BaseModel):
    schema_version: str = Field(default=WORLD_SCENE_PACKAGE_SCHEMA_VERSION_V1)
    package_id: str = Field(..., min_length=1)
    version: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    description: Optional[str] = None
    created_at: datetime
    runtime_targets: List[WorldRuntimeTarget] = Field(
        default_factory=list, max_length=MAX_RUNTIME_TARGETS
    )
    interface: WorldInterfaceSpec
    artifacts: List[WorldArtifactRef] = Field(default_factory=list, max_length=MAX_ARTIFACT_REFS)
    world_snapshot: WorldSnapshot
    provenance: Dict[str, Any] = Field(default_factory=dict)
    security: WorldSecuritySpec = Field(default_factory=WorldSecuritySpec)


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
