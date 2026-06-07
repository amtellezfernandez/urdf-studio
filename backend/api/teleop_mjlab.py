from __future__ import annotations

from fastapi import APIRouter

from backend.models.teleop_mjlab import (
    TeleopMjlabLiveStartRequest,
    TeleopMjlabLiveStartResult,
    TeleopMjlabLiveStepRequest,
    TeleopMjlabLiveStepResult,
    TeleopMjlabLiveStopResult,
    TeleopMjlabRolloutRequest,
    TeleopMjlabRolloutResult,
    TeleopMjlabRuntimeStatus,
    TeleopMjlabValidateRequest,
    TeleopMjlabValidationResult,
)
from backend.services.teleop_mjlab import (
    resolve_teleop_mjlab_runtime_status,
    rollout_teleop_mjlab_physics,
    start_teleop_mjlab_live_session,
    step_teleop_mjlab_live_session,
    stop_teleop_mjlab_live_session,
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


@router.post("/live/start", response_model=TeleopMjlabLiveStartResult)
def start_teleop_mjlab_live(
    req: TeleopMjlabLiveStartRequest,
) -> TeleopMjlabLiveStartResult:
    return start_teleop_mjlab_live_session(
        world_layout=req.world_layout,
        initial_end_effector_sample=req.initial_end_effector_sample,
        frame_map=req.frame_map,
        include_mjcf=req.include_mjcf,
        accelerated_drive=req.accelerated_drive,
        step_ms=req.step_ms,
    )


@router.post("/live/step", response_model=TeleopMjlabLiveStepResult)
def step_teleop_mjlab_live(
    req: TeleopMjlabLiveStepRequest,
) -> TeleopMjlabLiveStepResult:
    return step_teleop_mjlab_live_session(
        session_id=req.session_id,
        end_effector_sample=req.end_effector_sample,
    )


@router.delete("/live/{session_id}", response_model=TeleopMjlabLiveStopResult)
def stop_teleop_mjlab_live(session_id: str) -> TeleopMjlabLiveStopResult:
    return stop_teleop_mjlab_live_session(session_id=session_id)
