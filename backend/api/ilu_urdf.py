from __future__ import annotations

from fastapi import APIRouter

from backend.models.xacro import XacroExpandRequest, XacroExpandResponse
from backend.services.xacro import expand_xacro


router = APIRouter(prefix="/ilu", tags=["ilu"])


@router.post("/expand", response_model=XacroExpandResponse)
async def expand_ilu_xacro_endpoint(payload: XacroExpandRequest) -> XacroExpandResponse:
    urdf, stderr = expand_xacro(payload)
    return XacroExpandResponse(urdf=urdf, stderr=stderr)
