from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.models.teleop_mjlab import (
    TeleopMjlabRobotModel,
    TeleopMjlabValidationResult,
)
from backend.models.teleop_replay import (
    TeleopReplayExportRequest,
    TeleopReplayExportResult,
    TeleopReplayValidateRequest,
    TeleopReplayValidationResult,
)
from backend.services.teleop_replay import (
    TeleopReplayDependencyError,
    TeleopReplayInputError,
    build_teleop_replay_mjlab_export_gate,
    export_teleop_kinematic_lerobot,
    export_teleop_replay_lerobot,
    resolve_teleop_replay_output_dir,
    validate_teleop_replay,
)
from backend.services.teleop_mjlab import validate_teleop_mjlab_motion
from backend.services.teleop_replay_params import (
    TELEOP_REPLAY_MJLAB_EXPORT_REJECTION_ISSUE_PREVIEW_COUNT,
    TELEOP_REPLAY_MJLAB_EXPORT_REJECTION_PREFIX,
    TELEOP_REPLAY_MJLAB_EXPORT_SELF_COLLISION_UNCHECKED,
)

router = APIRouter(prefix="/teleop/replay", tags=["teleop-replay"])


def _resolve_export_robot_model(
    req: TeleopReplayExportRequest,
) -> TeleopMjlabRobotModel | None:
    if req.robot_model is None:
        return None
    try:
        return TeleopMjlabRobotModel.model_validate(req.robot_model)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid MJLab robot model payload: {exc}",
        ) from exc


def _validate_recording_for_mjlab_export(
    req: TeleopReplayExportRequest,
) -> TeleopMjlabValidationResult:
    result = validate_teleop_mjlab_motion(
        req.recording,
        robot_model=_resolve_export_robot_model(req),
    )
    if result.success:
        if not result.self_collision_checked:
            raise HTTPException(
                status_code=422,
                detail=TELEOP_REPLAY_MJLAB_EXPORT_SELF_COLLISION_UNCHECKED,
            )
        return result

    issue_reasons = [
        issue.reason
        for issue in result.issues[
            :TELEOP_REPLAY_MJLAB_EXPORT_REJECTION_ISSUE_PREVIEW_COUNT
        ]
    ]
    detail = TELEOP_REPLAY_MJLAB_EXPORT_REJECTION_PREFIX
    if issue_reasons:
        detail = f"{detail}: {'; '.join(issue_reasons)}"
    raise HTTPException(status_code=422, detail=detail)


def _attach_mjlab_export_gate_result(
    export_result: TeleopReplayExportResult,
    mjlab_result: TeleopMjlabValidationResult,
) -> TeleopReplayExportResult:
    return export_result.model_copy(
        update={
            "mjlab_validation": mjlab_result.model_dump(by_alias=True),
        }
    )


@router.post("/validate", response_model=TeleopReplayValidationResult)
def validate_teleop_replay_recording(
    req: TeleopReplayValidateRequest,
) -> TeleopReplayValidationResult:
    try:
        return validate_teleop_replay(
            req.recording,
            joint_tolerance_rad=req.joint_tolerance_rad,
        )
    except TeleopReplayInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/export/lerobot", response_model=TeleopReplayExportResult)
def export_teleop_replay_recording_to_lerobot(
    req: TeleopReplayExportRequest,
) -> TeleopReplayExportResult:
    try:
        output_dir = resolve_teleop_replay_output_dir(
            req.output_dir,
            recording_id=req.recording.recording_id,
        )
        mjlab_result = _validate_recording_for_mjlab_export(req)
        export_result = export_teleop_replay_lerobot(
            req.recording,
            joint_tolerance_rad=req.joint_tolerance_rad,
            mjlab_export_gate=build_teleop_replay_mjlab_export_gate(
                recording_id=mjlab_result.recording_id,
                success=mjlab_result.success,
                self_collision_checked=mjlab_result.self_collision_checked,
            ),
            output_dir=output_dir,
        )
        return _attach_mjlab_export_gate_result(export_result, mjlab_result)
    except TeleopReplayInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except TeleopReplayDependencyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/export/kinematic/lerobot", response_model=TeleopReplayExportResult)
def export_teleop_kinematic_recording_to_lerobot(
    req: TeleopReplayExportRequest,
) -> TeleopReplayExportResult:
    try:
        output_dir = resolve_teleop_replay_output_dir(
            req.output_dir,
            recording_id=req.recording.recording_id,
        )
        mjlab_result = _validate_recording_for_mjlab_export(req)
        export_result = export_teleop_kinematic_lerobot(
            req.recording,
            joint_tolerance_rad=req.joint_tolerance_rad,
            mjlab_export_gate=build_teleop_replay_mjlab_export_gate(
                recording_id=mjlab_result.recording_id,
                success=mjlab_result.success,
                self_collision_checked=mjlab_result.self_collision_checked,
            ),
            output_dir=output_dir,
        )
        return _attach_mjlab_export_gate_result(export_result, mjlab_result)
    except TeleopReplayInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except TeleopReplayDependencyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
