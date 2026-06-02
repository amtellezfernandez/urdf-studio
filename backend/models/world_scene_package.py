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
