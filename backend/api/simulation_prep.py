from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile

from backend.models.simulation_prep import SimulationPrepValidationReport
from backend.services.simulation_prep_mujoco import run_simulation_prep_validation

router = APIRouter(prefix="/simulation-prep", tags=["simulation-prep"])

_MAX_URDF_BYTES = 4 * 1024 * 1024
_MAX_MESH_BYTES = 64 * 1024 * 1024
_MAX_MESH_FILES = 512


async def _read_upload_bytes(upload: UploadFile, *, max_bytes: int, detail: str) -> bytes:
    payload = await upload.read()
    if len(payload) > max_bytes:
        raise HTTPException(status_code=413, detail=detail)
    return payload


async def _read_mesh_uploads(mesh_uploads: list[UploadFile]) -> dict[str, bytes]:
    mesh_files_by_name: dict[str, bytes] = {}
    for mesh_upload in mesh_uploads:
        if not mesh_upload.filename:
            continue
        mesh_files_by_name[mesh_upload.filename] = await _read_upload_bytes(
            mesh_upload,
            max_bytes=_MAX_MESH_BYTES,
            detail=f"Mesh file '{mesh_upload.filename}' exceeds 64 MB limit.",
        )
    return mesh_files_by_name


@router.post("/validate", response_model=SimulationPrepValidationReport)
async def validate_simulation_prep(
    urdf_file: UploadFile = File(..., description="URDF XML file"),
    mesh_files: list[UploadFile] | None = File(default=None, description="Mesh files referenced by the URDF"),
) -> SimulationPrepValidationReport:
    urdf_bytes = await _read_upload_bytes(
        urdf_file,
        max_bytes=_MAX_URDF_BYTES,
        detail="URDF file exceeds 4 MB limit.",
    )

    mesh_uploads = mesh_files or []
    if len(mesh_uploads) > _MAX_MESH_FILES:
        raise HTTPException(status_code=413, detail=f"Too many mesh files (max {_MAX_MESH_FILES}).")

    mesh_files_by_name = await _read_mesh_uploads(mesh_uploads)

    try:
        urdf_content = urdf_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"URDF file is not valid UTF-8: {exc}") from exc

    return run_simulation_prep_validation(urdf_content, mesh_files_by_name)
