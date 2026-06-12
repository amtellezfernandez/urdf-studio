from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from backend.models.ilu_assembly import IluAssemblyManifestResponse
from backend.services.ilu_assembly import (
    IluAssemblyError,
    get_ilu_assembly_manifest,
    resolve_ilu_assembly_asset_file,
)


router = APIRouter(prefix="/ilu-assembly", tags=["ilu-assembly"])


@router.get("/{assembly_id}/manifest", response_model=IluAssemblyManifestResponse)
async def get_assembly_manifest(assembly_id: str) -> IluAssemblyManifestResponse:
    try:
        return get_ilu_assembly_manifest(assembly_id)
    except IluAssemblyError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/{assembly_id}/asset")
async def get_assembly_asset(
    assembly_id: str,
    path: str = Query(..., min_length=1),
) -> FileResponse:
    try:
        asset = resolve_ilu_assembly_asset_file(assembly_id, path)
        return FileResponse(asset.file_path, media_type=asset.media_type, filename=asset.file_path.name)
    except IluAssemblyError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
