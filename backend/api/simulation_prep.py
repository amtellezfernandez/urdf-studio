from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile

from backend.models.simulation_prep import SimulationPrepValidationReport
from backend.services.simulation_prep_mujoco import run_simulation_prep_validation

router = APIRouter(prefix="/simulation-prep", tags=["simulation-prep"])

_MAX_URDF_BYTES = 4 * 1024 * 1024
_MAX_MESH_BYTES = 64 * 1024 * 1024
_MAX_MESH_FILES = 512


@router.post("/validate", response_model=SimulationPrepValidationReport)
async def validate_simulation_prep(
    urdf_file: UploadFile = File(..., description="URDF XML file"),
    mesh_files: list[UploadFile] | None = File(default=None, description="Mesh files referenced by the URDF"),
) -> SimulationPrepValidationReport:
    urdf_bytes = await urdf_file.read()
    if len(urdf_bytes) > _MAX_URDF_BYTES:
        raise HTTPException(status_code=413, detail="URDF file exceeds 4 MB limit.")

    mesh_uploads = mesh_files or []
    if len(mesh_uploads) > _MAX_MESH_FILES:
        raise HTTPException(status_code=413, detail=f"Too many mesh files (max {_MAX_MESH_FILES}).")

    mesh_files_by_name: dict[str, bytes] = {}
    for upload in mesh_uploads:
        data = await upload.read()
        if len(data) > _MAX_MESH_BYTES:
            raise HTTPException(status_code=413, detail=f"Mesh file '{upload.filename}' exceeds 64 MB limit.")
        if upload.filename:
            mesh_files_by_name[upload.filename] = data

    try:
        urdf_content = urdf_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"URDF file is not valid UTF-8: {exc}") from exc

    return run_simulation_prep_validation(urdf_content, mesh_files_by_name)
