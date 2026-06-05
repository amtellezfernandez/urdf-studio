from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from backend.models.world_scene_package import WorldScenePackageManifest

WORLD_LABS_DEFAULT_MODEL = "marble-1.0"
WORLD_LABS_AVAILABLE_MODELS = ("marble-1.1-plus", "marble-1.1", WORLD_LABS_DEFAULT_MODEL)
WORLD_LABS_MAX_SEED = 4294967295


class WorldLabsCapabilitiesResponse(BaseModel):
    available: bool
    configured: bool
    provider: Literal["world-labs"] = "world-labs"
    marble_url: str
    docs_url: str
    generate_endpoint: str
    default_model: str = WORLD_LABS_DEFAULT_MODEL
    models: list[str] = Field(default_factory=lambda: list(WORLD_LABS_AVAILABLE_MODELS))
    missing_reason: str | None = None


class WorldLabsGenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=8, max_length=2500)
    display_name: str = Field(..., min_length=1, max_length=64)
    model: str = Field(default=WORLD_LABS_DEFAULT_MODEL, min_length=1, max_length=80)
    seed: int | None = Field(default=None, ge=0, le=WORLD_LABS_MAX_SEED)
    tags: list[str] = Field(default_factory=list, max_length=10)
    public: bool = False
    allow_id_access: bool = True
    disable_recaption: bool = True

    @field_validator("tags")
    @classmethod
    def _normalize_tags(cls, value: list[str]) -> list[str]:
        tags: list[str] = []
        for raw_tag in value:
            tag = raw_tag.strip()
            if not tag:
                continue
            if len(tag) > 32:
                raise ValueError("World Labs tags must be 32 characters or fewer.")
            if tag not in tags:
                tags.append(tag)
        return tags


class WorldLabsGenerateResponse(BaseModel):
    operation_id: str
    created_at: str | None = None
    updated_at: str | None = None
    expires_at: str | None = None
    status_url: str
    raw_response: dict[str, Any] = Field(default_factory=dict)


class WorldLabsOperationStatusResponse(BaseModel):
    operation_id: str
    done: bool
    error: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    world_id: str | None = None
    world_marble_url: str | None = None
    thumbnail_url: str | None = None
    collider_mesh_url: str | None = None
    metric_scale_factor: float | None = None
    ground_plane_offset: float | None = None
    world_package: WorldScenePackageManifest | None = None
    raw_response: dict[str, Any] = Field(default_factory=dict)
