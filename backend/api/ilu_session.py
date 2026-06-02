from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from backend.models.ilu_session import (
    IluSessionAssetManifestResponse,
    IluSessionSaveRequest,
    IluSessionSaveResponse,
    IluSessionSnapshotResponse,
)
from backend.services.ilu_session import (
    IluSessionError,
    get_ilu_session_asset_manifest,
    get_ilu_session_snapshot,
    resolve_ilu_session_asset_file,
    save_ilu_session_urdf,
)


router = APIRouter(prefix="/ilu-session", tags=["ilu-session"])


@router.get("/{session_id}", response_model=IluSessionSnapshotResponse)
def get_session_snapshot(session_id: str) -> IluSessionSnapshotResponse:
    try:
        return get_ilu_session_snapshot(session_id)
    except IluSessionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/{session_id}/manifest", response_model=IluSessionAssetManifestResponse)
def get_session_asset_manifest(session_id: str) -> IluSessionAssetManifestResponse:
    try:
        return get_ilu_session_asset_manifest(session_id)
    except IluSessionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/{session_id}/asset")
def get_session_asset(
    session_id: str,
    path: str = Query(..., min_length=1),
    kind: str = Query("source"),
) -> FileResponse:
    try:
        asset = resolve_ilu_session_asset_file(session_id, path, kind)
        return FileResponse(asset.file_path, media_type=asset.media_type, filename=asset.file_path.name)
    except IluSessionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.put("/{session_id}", response_model=IluSessionSaveResponse)
def save_session_snapshot(session_id: str, request: IluSessionSaveRequest) -> IluSessionSaveResponse:
    try:
        return save_ilu_session_urdf(session_id, request.urdf_xml)
    except IluSessionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
