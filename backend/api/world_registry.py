from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError

from backend.core.simulator_security import require_simulator_operator_access_async
from backend.models.world_scene_package import (
    WorldRegistryCapabilitiesResponse,
    WorldScenePackageListEntry,
    WorldScenePackagePublishResponse,
    WorldScenePackageValidationResponse,
    WorldScenePackageVersionDocumentRecord,
    WorldScenePackageVersionRecord,
)
from backend.services.world_registry import world_registry_service
from backend.services.world_scene_package_compat import (
    read_world_scene_package_manifest,
    world_scene_registry_envelope_from_manifest,
)

router = APIRouter(prefix="/worlds/packages", tags=["world-packages"])


@router.post("/validate", response_model=WorldScenePackageValidationResponse)
async def validate_world_scene_package(
    payload: object,
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorldScenePackageValidationResponse:
    try:
        manifest = read_world_scene_package_manifest(payload)
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return world_registry_service.validate(manifest)


@router.post("", response_model=WorldScenePackagePublishResponse)
async def publish_world_scene_package(
    payload: object,
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorldScenePackagePublishResponse:
    try:
        manifest = read_world_scene_package_manifest(payload)
        return world_registry_service.publish(manifest)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("", response_model=list[WorldScenePackageListEntry])
async def list_world_scene_packages(
    q: str | None = Query(default=None, description="Search query across package metadata"),
    owner: str | None = Query(default=None, description="Owner filter"),
    tags: str | None = Query(default=None, description="Comma-separated tag filter"),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    _access: None = Depends(require_simulator_operator_access_async),
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
    response_model=WorldScenePackageVersionDocumentRecord,
)
async def get_world_scene_package_version(
    package_id: str,
    version: str,
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorldScenePackageVersionDocumentRecord:
    try:
        record = world_registry_service.get_version(package_id, version)
        return WorldScenePackageVersionDocumentRecord(
            package_id=record.package_id,
            version=record.version,
            digest_sha256=record.digest_sha256,
            published_at=record.published_at,
            manifest=world_scene_registry_envelope_from_manifest(record.manifest),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/capabilities", response_model=WorldRegistryCapabilitiesResponse)
async def get_world_registry_capabilities(
    _access: None = Depends(require_simulator_operator_access_async),
) -> WorldRegistryCapabilitiesResponse:
    return world_registry_service.get_capabilities()
