from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from backend.services.dataset_alignment_params import (
    DEFAULT_INDEXED_REPRESENTATION_ID,
    KINEMATIC_FINGERPRINT_VERSION_V1,
    MAPPING_SPEC_VERSION_V1,
    NAMING_STATUS_NAMED,
    NAMING_STATUS_UNNAMED,
    REPRESENTATION_SPEC_VERSION_V1,
    SHA256_HEX_LENGTH,
)


class EmbodimentRef(BaseModel):
    embodiment_id: str = Field(..., min_length=1)
    kinematic_fingerprint: str | None = None
    kinematic_fingerprint_version: Literal[KINEMATIC_FINGERPRINT_VERSION_V1] | None = None
    robot_type: str | None = None
    urdf_sha256: str | None = Field(
        default=None,
        min_length=SHA256_HEX_LENGTH,
        max_length=SHA256_HEX_LENGTH,
        pattern="^[a-fA-F0-9]{64}$",
    )
    srdf_sha256: str | None = Field(
        default=None,
        min_length=SHA256_HEX_LENGTH,
        max_length=SHA256_HEX_LENGTH,
        pattern="^[a-fA-F0-9]{64}$",
    )
    base_frame: str | None = None
    ee_frame: str | None = None


class RepresentationSignalSpec(BaseModel):
    type: str = Field(..., min_length=1)
    units: str = Field(..., min_length=1)
    ordering: str = Field(..., min_length=1)
    joints: list[str] = Field(default_factory=list)
    dt: float | None = Field(default=None, gt=0)
    base_frame: str | None = None


class RepresentationSpec(BaseModel):
    representation_id: str = Field(..., min_length=1)
    version: str = Field(default=REPRESENTATION_SPEC_VERSION_V1, min_length=1)
    state: RepresentationSignalSpec
    action: RepresentationSignalSpec


class MappingEndpointRef(BaseModel):
    embodiment_id: str = Field(..., min_length=1)
    representation_id: str = Field(..., min_length=1)


class MappingJointRule(BaseModel):
    source_joint: str = Field(..., min_length=1)
    target_joint: str = Field(..., min_length=1)
    scale: float = 1.0
    offset: float = 0.0
    invert: bool = False
    unit: str = Field(default="rad", min_length=1)


class MappingSpec(BaseModel):
    mapping_id: str | None = None
    source: MappingEndpointRef
    target: MappingEndpointRef
    joint_rules: list[MappingJointRule] = Field(default_factory=list)
    created_by: str | None = None
    created_at: datetime
    version: str = Field(default=MAPPING_SPEC_VERSION_V1, min_length=1)


class EmbodimentResolveRequest(BaseModel):
    embodiment_id: str | None = None
    urdf_xml: str | None = None
    robot_type: str | None = None
    base_frame: str | None = None
    ee_frame: str | None = None


class EmbodimentResolveResponse(BaseModel):
    embodiment: EmbodimentRef
    matched_existing: bool


class DatasetAlignmentInput(BaseModel):
    dataset_id: str = Field(..., min_length=1)
    embodiment_id: str | None = None
    representation_id: str = Field(default=DEFAULT_INDEXED_REPRESENTATION_ID, min_length=1)
    naming_status: Literal[NAMING_STATUS_NAMED, NAMING_STATUS_UNNAMED] = NAMING_STATUS_NAMED


class DatasetRepresentationValidationRequest(BaseModel):
    datasets: list[DatasetAlignmentInput] = Field(default_factory=list)
    required_representation_id: str | None = None


class DatasetRepresentationValidationResponse(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class MappingListQuery(BaseModel):
    source_embodiment_id: str | None = None
    source_representation_id: str | None = None
    target_embodiment_id: str | None = None
    target_representation_id: str | None = None


class DatasetAlignmentRegistrySnapshot(BaseModel):
    embodiments: list[EmbodimentRef]
    mappings: list[MappingSpec]
