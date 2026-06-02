from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.core.simulator_security import require_simulator_operator_access
from backend.models.world_scene_package import (
    WorldRegistryCapabilitiesResponse,
    WorldScenePackageListEntry,
    WorldScenePackageManifest,
    WorldScenePackagePublishResponse,
    WorldScenePackageValidationResponse,
    WorldScenePackageVersionRecord,
)
from backend.services.world_registry import world_registry_service

router = APIRouter(prefix="/worlds/packages", tags=["world-packages"])


@router.post("/validate", response_model=WorldScenePackageValidationResponse)
def validate_world_scene_package(
    manifest: WorldScenePackageManifest,
    _access: None = Depends(require_simulator_operator_access),
) -> WorldScenePackageValidationResponse:
    return world_registry_service.validate(manifest)


@router.post("", response_model=WorldScenePackagePublishResponse)
def publish_world_scene_package(
    manifest: WorldScenePackageManifest,
    _access: None = Depends(require_simulator_operator_access),
) -> WorldScenePackagePublishResponse:
    try:
        return world_registry_service.publish(manifest)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("", response_model=list[WorldScenePackageListEntry])
def list_world_scene_packages(
    q: str | None = Query(default=None, description="Search query across package metadata"),
    owner: str | None = Query(default=None, description="Owner filter"),
    tags: str | None = Query(default=None, description="Comma-separated tag filter"),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    _access: None = Depends(require_simulator_operator_access),
) -> list[WorldScenePackageListEntry]:
    parsed_tags = [tag.strip() for tag in (tags or "").split(",") if tag.strip()]
    return world_registry_service.list_packages(
        query=q,
        owner=owner,
        tags=parsed_tags,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{package_id}/versions/{version}",
    response_model=WorldScenePackageVersionRecord,
)
def get_world_scene_package_version(
    package_id: str,
    version: str,
    _access: None = Depends(require_simulator_operator_access),
) -> WorldScenePackageVersionRecord:
    try:
        return world_registry_service.get_version(package_id, version)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/capabilities", response_model=WorldRegistryCapabilitiesResponse)
def get_world_registry_capabilities(
    _access: None = Depends(require_simulator_operator_access),
) -> WorldRegistryCapabilitiesResponse:
    return world_registry_service.get_capabilities()
