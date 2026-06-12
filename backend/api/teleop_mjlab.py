from __future__ import annotations

from fastapi import APIRouter

from backend.models.teleop_mjlab import (
    TeleopMjlabRuntimeStatus,
    TeleopMjlabValidateRequest,
    TeleopMjlabValidationResult,
)
from backend.services.teleop_mjlab import (
    resolve_teleop_mjlab_runtime_status,
    validate_teleop_mjlab_motion,
)

router = APIRouter(prefix="/teleop/mjlab", tags=["teleop-mjlab"])


@router.get("/runtime", response_model=TeleopMjlabRuntimeStatus)
async def get_teleop_mjlab_runtime_status() -> TeleopMjlabRuntimeStatus:
    return resolve_teleop_mjlab_runtime_status()


@router.post("/validate", response_model=TeleopMjlabValidationResult)
async def validate_teleop_mjlab_recording(
    req: TeleopMjlabValidateRequest,
) -> TeleopMjlabValidationResult:
    return validate_teleop_mjlab_motion(
        req.recording,
        thresholds=req.thresholds,
        robot_model=req.robot_model,
    )
