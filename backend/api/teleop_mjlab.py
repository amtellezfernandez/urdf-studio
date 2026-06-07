from __future__ import annotations

from fastapi import APIRouter

from backend.models.teleop_mjlab import (
    TeleopMjlabRolloutRequest,
    TeleopMjlabRolloutResult,
    TeleopMjlabRuntimeStatus,
    TeleopMjlabValidateRequest,
    TeleopMjlabValidationResult,
)
from backend.services.teleop_mjlab import (
    resolve_teleop_mjlab_runtime_status,
    rollout_teleop_mjlab_physics,
    validate_teleop_mjlab_motion,
)

router = APIRouter(prefix="/teleop/mjlab", tags=["teleop-mjlab"])


@router.get("/runtime", response_model=TeleopMjlabRuntimeStatus)
def get_teleop_mjlab_runtime_status() -> TeleopMjlabRuntimeStatus:
    return resolve_teleop_mjlab_runtime_status()


@router.post("/validate", response_model=TeleopMjlabValidationResult)
def validate_teleop_mjlab_recording(
    req: TeleopMjlabValidateRequest,
) -> TeleopMjlabValidationResult:
    return validate_teleop_mjlab_motion(
        req.recording,
        thresholds=req.thresholds,
        robot_model=req.robot_model,
    )


@router.post("/rollout", response_model=TeleopMjlabRolloutResult)
def rollout_teleop_mjlab_recording(
    req: TeleopMjlabRolloutRequest,
) -> TeleopMjlabRolloutResult:
    return rollout_teleop_mjlab_physics(
        req.recording,
        world_layout=req.world_layout,
        end_effector_samples=req.end_effector_samples,
        frame_map=req.frame_map,
        include_mjcf=req.include_mjcf,
        rollout_step_ms=req.rollout_step_ms,
    )
