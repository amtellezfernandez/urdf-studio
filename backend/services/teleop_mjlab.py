from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from importlib.util import find_spec
import math
import re
import tempfile
from threading import Lock
import time
from pathlib import Path
from typing import Any, Sequence
from uuid import uuid4
import xml.etree.ElementTree as ET

import numpy as np
from scipy.spatial.transform import Rotation

from backend.models.teleop_mjlab import (
    TeleopMjlabEndEffectorSample,
    TeleopMjlabLiveStartResult,
    TeleopMjlabLiveStopResult,
    TeleopMjlabLiveStepResult,
    TeleopMjlabMotionIssue,
    TeleopMjlabMotionThresholds,
    TeleopMjlabRobotModel,
    TeleopMjlabRobotMeshFile,
    TeleopMjlabRolloutContact,
    TeleopMjlabRolloutFrame,
    TeleopMjlabRolloutObjectPose,
    TeleopMjlabRolloutResult,
    TeleopMjlabRuntimeDependency,
    TeleopMjlabRuntimeStatus,
    TeleopMjlabTrajectorySample,
    TeleopMjlabValidationResult,
)
from backend.models.teleop_replay import (
    TeleopReplayRecording,
    TeleopReplayRecordingSample,
)
from backend.services.teleop_mjlab_params import (
    TELEOP_MJLAB_ACCELERATOR_DEPENDENCIES,
    TELEOP_MJLAB_BUNDLE_KIND,
    TELEOP_MJLAB_DEFAULT_LIVE_STEP_MS,
    TELEOP_MJLAB_ISSUE_CODE_EMPTY_RECORDING,
    TELEOP_MJLAB_ISSUE_CODE_JOINT_ACCELERATION_LIMIT,
    TELEOP_MJLAB_ISSUE_CODE_JOINT_VELOCITY_LIMIT,
    TELEOP_MJLAB_ISSUE_CODE_MISSING_JOINT_STATE,
    TELEOP_MJLAB_ISSUE_CODE_NON_MONOTONIC_TIMESTAMP,
    TELEOP_MJLAB_ISSUE_CODE_LIVE_NO_DYNAMIC_OBJECTS,
    TELEOP_MJLAB_ISSUE_CODE_LIVE_RUNTIME_UNAVAILABLE,
    TELEOP_MJLAB_ISSUE_CODE_LIVE_SESSION_LIMIT,
    TELEOP_MJLAB_ISSUE_CODE_LIVE_SESSION_NOT_FOUND,
    TELEOP_MJLAB_ISSUE_CODE_LIVE_SIMULATION_FAILED,
    TELEOP_MJLAB_ISSUE_CODE_LIVE_WORLD_LAYOUT_INVALID,
    TELEOP_MJLAB_ISSUE_CODE_ROLLOUT_NO_DYNAMIC_OBJECTS,
    TELEOP_MJLAB_ISSUE_CODE_ROLLOUT_NO_END_EFFECTOR_SAMPLES,
    TELEOP_MJLAB_ISSUE_CODE_ROLLOUT_RUNTIME_UNAVAILABLE,
    TELEOP_MJLAB_ISSUE_CODE_ROLLOUT_SIMULATION_FAILED,
    TELEOP_MJLAB_ISSUE_CODE_ROLLOUT_WORLD_LAYOUT_INVALID,
    TELEOP_MJLAB_ISSUE_CODE_SELF_COLLISION,
    TELEOP_MJLAB_ISSUE_CODE_SELF_COLLISION_MODEL_INVALID,
    TELEOP_MJLAB_ISSUE_CODE_SELF_COLLISION_MODEL_MISSING,
    TELEOP_MJLAB_ISSUE_CODE_SELF_COLLISION_RUNTIME_UNAVAILABLE,
    TELEOP_MJLAB_ISSUE_CODE_SHORT_TRAJECTORY,
    TELEOP_MJLAB_ISSUE_CODE_TIMESTAMP_GAP,
    TELEOP_MJLAB_ISSUE_SEVERITY_ERROR,
    TELEOP_MJLAB_ISSUE_SEVERITY_WARNING,
    TELEOP_MJLAB_LIVE_BUNDLE_KIND,
    TELEOP_MJLAB_LIVE_SCHEMA_VERSION,
    TELEOP_MJLAB_LIVE_SESSION_TTL_SEC,
    TELEOP_MJLAB_MAX_LIVE_SESSIONS,
    TELEOP_MJLAB_MAX_LIVE_STEP_MS,
    TELEOP_MJLAB_MAX_SELF_COLLISION_ISSUES,
    TELEOP_MJLAB_MILLISECONDS_PER_SECOND,
    TELEOP_MJLAB_MIN_TRAJECTORY_SAMPLE_COUNT,
    TELEOP_MJLAB_ROLLOUT_BUNDLE_KIND,
    TELEOP_MJLAB_ROLLOUT_GRIPPER_FINGER_HALF_EXTENTS_M,
    TELEOP_MJLAB_ROLLOUT_GRIPPER_LIFT_PLATE_HALF_EXTENTS_M,
    TELEOP_MJLAB_ROLLOUT_GRIPPER_LIFT_PLATE_OFFSET_M,
    TELEOP_MJLAB_ROLLOUT_GRIPPER_MAX_OPENING_M,
    TELEOP_MJLAB_ROLLOUT_SCHEMA_VERSION,
    TELEOP_MJLAB_RUNTIME_DEPENDENCIES,
    TELEOP_MJLAB_RUNTIME_DEPENDENCY_MUJOCO,
    TELEOP_MJLAB_RUNTIME_NAME,
    TELEOP_MJLAB_RUNTIME_STATUS_AVAILABLE,
    TELEOP_MJLAB_RUNTIME_STATUS_UNAVAILABLE,
    TELEOP_MJLAB_SCHEMA_VERSION,
    TELEOP_MJLAB_STAGED_MESH_DIRNAME,
    TELEOP_MJLAB_STAGED_MESH_FILENAME_PREFIX,
    TELEOP_MJLAB_TIMESTAMP_SEMANTICS_COMMAND_SOURCE,
    TELEOP_MJLAB_TRAJECTORY_SOURCE_RECORDED_JOINT_STATE,
    TELEOP_MJLAB_TRAJECTORY_SOURCE_STUDIO_JOINT_TARGETS,
    TELEOP_MJLAB_WORLD_BODY_ID,
    TELEOP_MJLAB_ZERO_DURATION_MS,
    TELEOP_MJLAB_ZERO_METRIC,
    TELEOP_MJLAB_ZERO_TIMESTAMP_MS,
)
from backend.services.world_layout_static_transfer import (
    STUDIO_Y_UP_TO_Z_UP,
    SimPrimitive,
    WorldLayoutFrameMap,
    WorldLayoutTransferError,
    build_sim_primitives,
    export_primitives_to_mujoco_mjcf,
    parse_static_world_layout_payload,
)
from backend.services.teleop_replay import (
    resolve_teleop_replay_sample_command_time_ms,
)
from backend.services.teleop_replay_params import (
    TELEOP_REPLAY_COMMAND_KIND_JOINT_TARGETS,
)

MESH_REFERENCE_SCHEME_SEPARATOR = "://"
PACKAGE_REFERENCE_SCHEME = "package"
FILE_REFERENCE_SCHEME = "file"
INVALID_STAGED_MESH_FILENAME_PATTERN = re.compile(r"[^A-Za-z0-9_.-]")
MJLAB_LEFT_FINGER_BODY_NAME = "mjlab_left_finger_proxy"
MJLAB_RIGHT_FINGER_BODY_NAME = "mjlab_right_finger_proxy"
MJLAB_LEFT_FINGER_GEOM_NAME = "mjlab_left_finger"
MJLAB_RIGHT_FINGER_GEOM_NAME = "mjlab_right_finger"
MJLAB_GRIPPER_LIFT_PLATE_BODY_NAME = "mjlab_gripper_lift_plate_proxy"
MJLAB_GRIPPER_LIFT_PLATE_GEOM_NAME = "mjlab_gripper_lift_plate"
MJLAB_GRIPPER_GEOM_NAMES = {
    MJLAB_LEFT_FINGER_GEOM_NAME,
    MJLAB_RIGHT_FINGER_GEOM_NAME,
    MJLAB_GRIPPER_LIFT_PLATE_GEOM_NAME,
}
MJLAB_GRIPPER_BODY_NAMES = (
    MJLAB_LEFT_FINGER_BODY_NAME,
    MJLAB_RIGHT_FINGER_BODY_NAME,
    MJLAB_GRIPPER_LIFT_PLATE_BODY_NAME,
)


StagedMeshReferenceMap = dict[str, str]


@dataclass(frozen=True)
class _RolloutEndEffectorSample:
    sample_index: int
    timestamp_ms: float
    position_xyz: tuple[float, float, float]
    quat_wxyz: tuple[float, float, float, float]
    gripper_opening_m: float


@dataclass
class _MjlabLiveSession:
    session_id: str
    created_at_monotonic: float
    last_used_at_monotonic: float
    mujoco: Any
    model: Any
    data: Any
    frame_map: WorldLayoutFrameMap
    step_ms: float
    dynamic_primitives: tuple[SimPrimitive, ...]
    dynamic_body_ids: dict[str, int]
    proxy_joints: dict[str, tuple[int, int]]
    previous_sample: _RolloutEndEffectorSample
    previous_proxy_poses: dict[str, tuple[np.ndarray, tuple[float, float, float, float]]]
    frame_index: int = 0


_MJLAB_LIVE_SESSIONS: dict[str, _MjlabLiveSession] = {}
_MJLAB_LIVE_SESSION_LOCK = Lock()


def resolve_teleop_mjlab_runtime_status() -> TeleopMjlabRuntimeStatus:
    dependencies = [
        TeleopMjlabRuntimeDependency(
            name=dependency_name,
            available=_is_python_module_available(dependency_name),
        )
        for dependency_name in TELEOP_MJLAB_RUNTIME_DEPENDENCIES
    ]
    accelerator_dependencies = [
        TeleopMjlabRuntimeDependency(
            name=dependency_name,
            available=_is_python_module_available(dependency_name),
        )
        for dependency_name in TELEOP_MJLAB_ACCELERATOR_DEPENDENCIES
    ]
    available = all(dependency.available for dependency in dependencies)
    return TeleopMjlabRuntimeStatus(
        runtime_name=TELEOP_MJLAB_RUNTIME_NAME,
        available=available,
        status=(
            TELEOP_MJLAB_RUNTIME_STATUS_AVAILABLE
            if available
            else TELEOP_MJLAB_RUNTIME_STATUS_UNAVAILABLE
        ),
        dependencies=dependencies,
        accelerator_dependencies=accelerator_dependencies,
    )


def _is_python_module_available(module_name: str) -> bool:
    try:
        return find_spec(module_name) is not None
    except (ImportError, ModuleNotFoundError, ValueError):
        return False


def validate_teleop_mjlab_motion(
    recording: TeleopReplayRecording,
    *,
    thresholds: TeleopMjlabMotionThresholds | None = None,
    robot_model: TeleopMjlabRobotModel | None = None,
) -> TeleopMjlabValidationResult:
    resolved_thresholds = thresholds or TeleopMjlabMotionThresholds()
    runtime = resolve_teleop_mjlab_runtime_status()
    issues: list[TeleopMjlabMotionIssue] = []
    trajectory = _build_trajectory(recording, issues)
    metrics = _compute_motion_metrics(
        trajectory,
        thresholds=resolved_thresholds,
        issues=issues,
    )
    if not recording.samples:
        issues.append(
            _build_issue(
                code=TELEOP_MJLAB_ISSUE_CODE_EMPTY_RECORDING,
                reason="MJLab validation requires at least one recorded sample.",
            )
        )
    if len(trajectory) < TELEOP_MJLAB_MIN_TRAJECTORY_SAMPLE_COUNT:
        issues.append(
            _build_issue(
                code=TELEOP_MJLAB_ISSUE_CODE_SHORT_TRAJECTORY,
                reason=(
                    "MJLab motion validation requires at least two trajectory "
                    "samples."
                ),
            )
        )

    self_collision_metrics = _compute_self_collision_metrics(
        trajectory,
        thresholds=resolved_thresholds,
        robot_model=robot_model,
        issues=issues,
    )
    joint_names = sorted(
        {
            joint_name
            for sample in trajectory
            for joint_name in sample.joint_positions_rad
        }
    )
    success = not any(
        issue.severity == TELEOP_MJLAB_ISSUE_SEVERITY_ERROR for issue in issues
    )
    manifest = _build_mjlab_manifest(
        recording=recording,
        runtime=runtime,
        thresholds=resolved_thresholds,
        trajectory=trajectory,
        joint_names=joint_names,
        self_collision_metrics=self_collision_metrics,
    )
    return TeleopMjlabValidationResult(
        success=success,
        recording_id=recording.recording_id,
        runtime=runtime,
        sample_count=len(recording.samples),
        trajectory_sample_count=len(trajectory),
        joint_names=joint_names,
        duration_ms=metrics["duration_ms"],
        max_joint_velocity_rad_per_sec=metrics["max_joint_velocity_rad_per_sec"],
        max_joint_acceleration_rad_per_sec2=metrics[
            "max_joint_acceleration_rad_per_sec2"
        ],
        max_timestamp_gap_ms=metrics["max_timestamp_gap_ms"],
        self_collision_checked=self_collision_metrics["checked"],
        self_collision_sample_count=int(self_collision_metrics["sample_count"]),
        self_collision_count=int(self_collision_metrics["collision_count"]),
        thresholds=resolved_thresholds,
        issues=issues,
        trajectory=trajectory,
        manifest=manifest,
    )


def rollout_teleop_mjlab_physics(
    recording: TeleopReplayRecording,
    *,
    world_layout: dict[str, Any],
    end_effector_samples: list[TeleopMjlabEndEffectorSample],
    frame_map: WorldLayoutFrameMap = "studio-y-up-to-z-up",
    include_mjcf: bool = False,
    rollout_step_ms: float = 5.0,
) -> TeleopMjlabRolloutResult:
    runtime = resolve_teleop_mjlab_runtime_status()
    trajectory_issues: list[TeleopMjlabMotionIssue] = []
    trajectory = _build_trajectory(recording, trajectory_issues)
    issues = [
        _as_rollout_trajectory_warning(issue)
        for issue in trajectory_issues
    ]
    world_warnings: list[str] = []
    primitives: tuple[SimPrimitive, ...] = ()
    dynamic_primitives: tuple[SimPrimitive, ...] = ()
    mjcf_xml: str | None = None
    frames: list[TeleopMjlabRolloutFrame] = []

    if not end_effector_samples:
        issues.append(
            _build_issue(
                code=TELEOP_MJLAB_ISSUE_CODE_ROLLOUT_NO_END_EFFECTOR_SAMPLES,
                reason=(
                    "MJLab rollout requires end-effector pose samples from "
                    "the leader arm or robot FK."
                ),
            )
        )

    try:
        layout = parse_static_world_layout_payload(world_layout)
        primitives, parsed_warnings = build_sim_primitives(
            layout,
            frame_map=frame_map,
            include_hidden=True,
        )
        world_warnings.extend(parsed_warnings)
        dynamic_primitives = tuple(
            primitive for primitive in primitives if primitive.body_type == "dynamic"
        )
        if not dynamic_primitives:
            issues.append(
                _build_issue(
                    code=TELEOP_MJLAB_ISSUE_CODE_ROLLOUT_NO_DYNAMIC_OBJECTS,
                    reason=(
                        "MJLab rollout requires at least one dynamic world "
                        "layout object, for example a grabbable container."
                    ),
                )
            )
    except WorldLayoutTransferError as exc:
        layout = None
        issues.append(
            _build_issue(
                code=TELEOP_MJLAB_ISSUE_CODE_ROLLOUT_WORLD_LAYOUT_INVALID,
                reason=f"MJLab could not parse the rollout world layout: {exc}",
            )
        )

    if not _is_python_module_available(TELEOP_MJLAB_RUNTIME_DEPENDENCY_MUJOCO):
        issues.append(
            _build_issue(
                code=TELEOP_MJLAB_ISSUE_CODE_ROLLOUT_RUNTIME_UNAVAILABLE,
                reason="MJLab rollout requires the MuJoCo runtime.",
            )
        )

    if not any(issue.severity == TELEOP_MJLAB_ISSUE_SEVERITY_ERROR for issue in issues):
        try:
            import mujoco

            mjcf_xml = _build_mjlab_proxy_rollout_mjcf(
                primitives,
                model_name=layout.name if layout is not None else recording.recording_id,
                rollout_step_ms=rollout_step_ms,
            )
            model = mujoco.MjModel.from_xml_string(mjcf_xml)
            data = mujoco.MjData(model)
            frames = _run_mjlab_proxy_rollout(
                mujoco=mujoco,
                model=model,
                data=data,
                trajectory=trajectory,
                dynamic_primitives=dynamic_primitives,
                end_effector_samples=end_effector_samples,
                frame_map=frame_map,
                rollout_step_ms=rollout_step_ms,
            )
        except Exception as exc:
            issues.append(
                _build_issue(
                    code=TELEOP_MJLAB_ISSUE_CODE_ROLLOUT_SIMULATION_FAILED,
                    reason=f"MJLab rollout simulation failed: {exc}",
                )
            )
            frames = []

    success = not any(
        issue.severity == TELEOP_MJLAB_ISSUE_SEVERITY_ERROR for issue in issues
    )
    contact_count = sum(len(frame.contacts) for frame in frames)
    return TeleopMjlabRolloutResult(
        success=success,
        recording_id=recording.recording_id,
        runtime=runtime,
        frame_count=len(frames),
        dynamic_object_count=len(dynamic_primitives),
        contact_count=contact_count,
        frame_map=frame_map,
        issues=issues,
        trajectory=trajectory,
        frames=frames,
        world_warnings=world_warnings,
        mjcf_xml=mjcf_xml if include_mjcf else None,
        manifest={
            "schema_version": TELEOP_MJLAB_ROLLOUT_SCHEMA_VERSION,
            "bundle_kind": TELEOP_MJLAB_ROLLOUT_BUNDLE_KIND,
            "recording_id": recording.recording_id,
            "task_language": recording.task_language,
            "runtime": runtime.model_dump(by_alias=True),
            "frame_map": frame_map,
            "dynamic_object_count": len(dynamic_primitives),
            "contact_count": contact_count,
            "rollout_step_ms": rollout_step_ms,
            "gripper_proxy": {
                "body_names": [
                    MJLAB_LEFT_FINGER_BODY_NAME,
                    MJLAB_RIGHT_FINGER_BODY_NAME,
                    MJLAB_GRIPPER_LIFT_PLATE_BODY_NAME,
                ],
                "geom_names": [
                    MJLAB_LEFT_FINGER_GEOM_NAME,
                    MJLAB_RIGHT_FINGER_GEOM_NAME,
                    MJLAB_GRIPPER_LIFT_PLATE_GEOM_NAME,
                ],
            },
        },
    )


def start_teleop_mjlab_live_session(
    *,
    world_layout: dict[str, Any],
    initial_end_effector_sample: TeleopMjlabEndEffectorSample,
    frame_map: WorldLayoutFrameMap = "studio-y-up-to-z-up",
    include_mjcf: bool = False,
    step_ms: float = TELEOP_MJLAB_DEFAULT_LIVE_STEP_MS,
) -> TeleopMjlabLiveStartResult:
    runtime = resolve_teleop_mjlab_runtime_status()
    issues: list[TeleopMjlabMotionIssue] = []
    world_warnings: list[str] = []
    primitives: tuple[SimPrimitive, ...] = ()
    dynamic_primitives: tuple[SimPrimitive, ...] = ()
    mjcf_xml: str | None = None
    frame: TeleopMjlabRolloutFrame | None = None
    session_id: str | None = None

    _prune_mjlab_live_sessions()
    with _MJLAB_LIVE_SESSION_LOCK:
        active_session_count = len(_MJLAB_LIVE_SESSIONS)
    if active_session_count >= TELEOP_MJLAB_MAX_LIVE_SESSIONS:
        issues.append(
            _build_issue(
                code=TELEOP_MJLAB_ISSUE_CODE_LIVE_SESSION_LIMIT,
                reason=(
                    "MJLab live session limit reached. Stop an existing "
                    "session before starting another one."
                ),
            )
        )

    try:
        layout = parse_static_world_layout_payload(world_layout)
        primitives, parsed_warnings = build_sim_primitives(
            layout,
            frame_map=frame_map,
            include_hidden=True,
        )
        world_warnings.extend(parsed_warnings)
        dynamic_primitives = tuple(
            primitive for primitive in primitives if primitive.body_type == "dynamic"
        )
        if not dynamic_primitives:
            issues.append(
                _build_issue(
                    code=TELEOP_MJLAB_ISSUE_CODE_LIVE_NO_DYNAMIC_OBJECTS,
                    reason=(
                        "MJLab live interaction requires at least one dynamic "
                        "world layout object."
                    ),
                )
            )
    except WorldLayoutTransferError as exc:
        layout = None
        issues.append(
            _build_issue(
                code=TELEOP_MJLAB_ISSUE_CODE_LIVE_WORLD_LAYOUT_INVALID,
                reason=f"MJLab could not parse the live world layout: {exc}",
            )
        )

    if not _is_python_module_available(TELEOP_MJLAB_RUNTIME_DEPENDENCY_MUJOCO):
        issues.append(
            _build_issue(
                code=TELEOP_MJLAB_ISSUE_CODE_LIVE_RUNTIME_UNAVAILABLE,
                reason="MJLab live interaction requires the MuJoCo runtime.",
            )
        )

    if not any(issue.severity == TELEOP_MJLAB_ISSUE_SEVERITY_ERROR for issue in issues):
        try:
            import mujoco

            mjcf_xml = _build_mjlab_proxy_rollout_mjcf(
                primitives,
                model_name=layout.name if layout is not None else "mjlab_live_session",
                rollout_step_ms=step_ms,
            )
            model = mujoco.MjModel.from_xml_string(mjcf_xml)
            data = mujoco.MjData(model)
            proxy_joints = _resolve_mjlab_gripper_proxy_joints(
                mujoco=mujoco,
                model=model,
            )
            dynamic_body_ids = _resolve_mjlab_dynamic_body_ids(
                mujoco=mujoco,
                model=model,
                dynamic_primitives=dynamic_primitives,
            )
            initial_sample = _transform_rollout_end_effector_sample(
                initial_end_effector_sample,
                frame_map=frame_map,
            )
            previous_proxy_poses = _set_mjlab_gripper_proxy_pose(
                data,
                proxy_joints=proxy_joints,
                sample=initial_sample,
                dt_seconds=None,
                previous_proxy_poses=None,
            )
            mujoco.mj_forward(model, data)
            frame = _build_mjlab_rollout_frame(
                mujoco=mujoco,
                model=model,
                data=data,
                sample=initial_sample,
                trajectory_by_sample_index={},
                dynamic_primitives=dynamic_primitives,
                dynamic_body_ids=dynamic_body_ids,
            )
            session_id = f"mjlab-live-{uuid4().hex}"
            now = time.monotonic()
            session = _MjlabLiveSession(
                session_id=session_id,
                created_at_monotonic=now,
                last_used_at_monotonic=now,
                mujoco=mujoco,
                model=model,
                data=data,
                frame_map=frame_map,
                step_ms=step_ms,
                dynamic_primitives=dynamic_primitives,
                dynamic_body_ids=dynamic_body_ids,
                proxy_joints=proxy_joints,
                previous_sample=initial_sample,
                previous_proxy_poses=previous_proxy_poses,
            )
            with _MJLAB_LIVE_SESSION_LOCK:
                _MJLAB_LIVE_SESSIONS[session_id] = session
        except Exception as exc:
            issues.append(
                _build_issue(
                    code=TELEOP_MJLAB_ISSUE_CODE_LIVE_SIMULATION_FAILED,
                    reason=f"MJLab live session failed to start: {exc}",
                )
            )
            frame = None
            session_id = None

    success = not any(
        issue.severity == TELEOP_MJLAB_ISSUE_SEVERITY_ERROR for issue in issues
    )
    return TeleopMjlabLiveStartResult(
        success=success,
        session_id=session_id,
        runtime=runtime,
        frame_map=frame_map,
        dynamic_object_count=len(dynamic_primitives),
        step_ms=step_ms,
        issues=issues,
        frame=frame,
        world_warnings=world_warnings,
        mjcf_xml=mjcf_xml if include_mjcf else None,
        manifest={
            "schema_version": TELEOP_MJLAB_LIVE_SCHEMA_VERSION,
            "bundle_kind": TELEOP_MJLAB_LIVE_BUNDLE_KIND,
            "session_id": session_id,
            "runtime": runtime.model_dump(by_alias=True),
            "frame_map": frame_map,
            "dynamic_object_count": len(dynamic_primitives),
            "step_ms": step_ms,
        },
    )


def step_teleop_mjlab_live_session(
    *,
    session_id: str,
    end_effector_sample: TeleopMjlabEndEffectorSample,
) -> TeleopMjlabLiveStepResult:
    _prune_mjlab_live_sessions()
    issues: list[TeleopMjlabMotionIssue] = []
    with _MJLAB_LIVE_SESSION_LOCK:
        session = _MJLAB_LIVE_SESSIONS.get(session_id)
        if session is None:
            issues.append(
                _build_issue(
                    code=TELEOP_MJLAB_ISSUE_CODE_LIVE_SESSION_NOT_FOUND,
                    reason="MJLab live session was not found or has expired.",
                )
            )
            return TeleopMjlabLiveStepResult(
                success=False,
                session_id=session_id,
                frame_index=0,
                contact_count=0,
                sim_step_count=0,
                physics_step_wall_ms=0.0,
                realtime_factor=0.0,
                issues=issues,
                frame=None,
            )

        try:
            target_sample = _transform_rollout_end_effector_sample(
                end_effector_sample,
                frame_map=session.frame_map,
            )
            frame, sim_step_count, wall_ms, realtime_factor = (
                _step_mjlab_live_session_locked(session, target_sample)
            )
            session.last_used_at_monotonic = time.monotonic()
            session.frame_index += 1
            return TeleopMjlabLiveStepResult(
                success=True,
                session_id=session_id,
                frame_index=session.frame_index,
                contact_count=len(frame.contacts),
                sim_step_count=sim_step_count,
                physics_step_wall_ms=wall_ms,
                realtime_factor=realtime_factor,
                issues=[],
                frame=frame,
            )
        except Exception as exc:
            issues.append(
                _build_issue(
                    code=TELEOP_MJLAB_ISSUE_CODE_LIVE_SIMULATION_FAILED,
                    reason=f"MJLab live step failed: {exc}",
                )
            )
            return TeleopMjlabLiveStepResult(
                success=False,
                session_id=session_id,
                frame_index=session.frame_index,
                contact_count=0,
                sim_step_count=0,
                physics_step_wall_ms=0.0,
                realtime_factor=0.0,
                issues=issues,
                frame=None,
            )


def stop_teleop_mjlab_live_session(*, session_id: str) -> TeleopMjlabLiveStopResult:
    with _MJLAB_LIVE_SESSION_LOCK:
        released = _MJLAB_LIVE_SESSIONS.pop(session_id, None) is not None
    return TeleopMjlabLiveStopResult(
        success=True,
        session_id=session_id,
        released=released,
    )


def _build_trajectory(
    recording: TeleopReplayRecording,
    issues: list[TeleopMjlabMotionIssue],
) -> list[TeleopMjlabTrajectorySample]:
    trajectory: list[TeleopMjlabTrajectorySample] = []
    carried_positions: dict[str, float] = {}

    for sample in recording.samples:
        resolved = _resolve_sample_joint_positions(sample, carried_positions)
        if resolved is None:
            issues.append(
                _build_issue(
                    code=TELEOP_MJLAB_ISSUE_CODE_MISSING_JOINT_STATE,
                    reason=(
                        "MJLab validation requires joint targets or captured "
                        "post-command joint state."
                    ),
                    sample_index=sample.sample_index,
                )
            )
            continue
        source, positions = resolved
        carried_positions.update(positions)
        trajectory.append(
            TeleopMjlabTrajectorySample(
                sample_index=sample.sample_index,
                timestamp_ms=max(
                    TELEOP_MJLAB_ZERO_TIMESTAMP_MS,
                    resolve_teleop_replay_sample_command_time_ms(recording, sample),
                ),
                source=source,
                joint_positions_rad=dict(carried_positions),
            )
        )
    return trajectory


def _resolve_sample_joint_positions(
    sample: TeleopReplayRecordingSample,
    carried_positions: dict[str, float],
) -> tuple[str, dict[str, float]] | None:
    if (
        sample.command.kind == TELEOP_REPLAY_COMMAND_KIND_JOINT_TARGETS
        and sample.command.joint_targets
    ):
        return (
            TELEOP_MJLAB_TRAJECTORY_SOURCE_STUDIO_JOINT_TARGETS,
            dict(sample.command.joint_targets),
        )
    if sample.post_command_state is not None and sample.post_command_state.joint_positions_rad:
        return (
            TELEOP_MJLAB_TRAJECTORY_SOURCE_RECORDED_JOINT_STATE,
            dict(sample.post_command_state.joint_positions_rad),
        )
    if carried_positions:
        return TELEOP_MJLAB_TRAJECTORY_SOURCE_RECORDED_JOINT_STATE, {}
    return None


def _compute_motion_metrics(
    trajectory: list[TeleopMjlabTrajectorySample],
    *,
    thresholds: TeleopMjlabMotionThresholds,
    issues: list[TeleopMjlabMotionIssue],
) -> dict[str, float]:
    max_velocity = TELEOP_MJLAB_ZERO_METRIC
    max_acceleration = TELEOP_MJLAB_ZERO_METRIC
    max_timestamp_gap = TELEOP_MJLAB_ZERO_DURATION_MS
    previous_sample: TeleopMjlabTrajectorySample | None = None
    previous_velocity_by_joint: dict[str, float] = {}

    for sample in trajectory:
        if previous_sample is None:
            previous_sample = sample
            continue

        delta_ms = sample.timestamp_ms - previous_sample.timestamp_ms
        if delta_ms <= TELEOP_MJLAB_ZERO_DURATION_MS:
            issues.append(
                _build_issue(
                    code=TELEOP_MJLAB_ISSUE_CODE_NON_MONOTONIC_TIMESTAMP,
                    reason="MJLab trajectory timestamps must be strictly increasing.",
                    sample_index=sample.sample_index,
                    value=delta_ms,
                    limit=TELEOP_MJLAB_ZERO_DURATION_MS,
                )
            )
            previous_sample = sample
            continue

        max_timestamp_gap = max(max_timestamp_gap, delta_ms)
        if delta_ms > thresholds.max_timestamp_gap_ms:
            issues.append(
                _build_issue(
                    code=TELEOP_MJLAB_ISSUE_CODE_TIMESTAMP_GAP,
                    reason="MJLab trajectory contains a timestamp gap above the limit.",
                    sample_index=sample.sample_index,
                    value=delta_ms,
                    limit=thresholds.max_timestamp_gap_ms,
                )
            )

        delta_seconds = delta_ms / TELEOP_MJLAB_MILLISECONDS_PER_SECOND
        for joint_name in sorted(sample.joint_positions_rad):
            if joint_name not in previous_sample.joint_positions_rad:
                continue
            velocity = (
                sample.joint_positions_rad[joint_name]
                - previous_sample.joint_positions_rad[joint_name]
            ) / delta_seconds
            abs_velocity = abs(velocity)
            max_velocity = max(max_velocity, abs_velocity)
            if abs_velocity > thresholds.max_joint_velocity_rad_per_sec:
                issues.append(
                    _build_issue(
                        code=TELEOP_MJLAB_ISSUE_CODE_JOINT_VELOCITY_LIMIT,
                        reason="MJLab trajectory exceeds joint velocity limit.",
                        sample_index=sample.sample_index,
                        joint_name=joint_name,
                        value=abs_velocity,
                        limit=thresholds.max_joint_velocity_rad_per_sec,
                    )
                )

            previous_velocity = previous_velocity_by_joint.get(joint_name)
            if previous_velocity is not None:
                abs_acceleration = abs(velocity - previous_velocity) / delta_seconds
                max_acceleration = max(max_acceleration, abs_acceleration)
                if (
                    abs_acceleration
                    > thresholds.max_joint_acceleration_rad_per_sec2
                ):
                    issues.append(
                        _build_issue(
                            code=TELEOP_MJLAB_ISSUE_CODE_JOINT_ACCELERATION_LIMIT,
                            reason=(
                                "MJLab trajectory exceeds joint acceleration "
                                "limit."
                            ),
                            sample_index=sample.sample_index,
                            joint_name=joint_name,
                            value=abs_acceleration,
                            limit=thresholds.max_joint_acceleration_rad_per_sec2,
                        )
                    )
            previous_velocity_by_joint[joint_name] = velocity
        previous_sample = sample

    duration_ms = (
        trajectory[-1].timestamp_ms - trajectory[0].timestamp_ms
        if len(trajectory) >= TELEOP_MJLAB_MIN_TRAJECTORY_SAMPLE_COUNT
        else TELEOP_MJLAB_ZERO_DURATION_MS
    )
    return {
        "duration_ms": max(TELEOP_MJLAB_ZERO_DURATION_MS, duration_ms),
        "max_joint_velocity_rad_per_sec": max_velocity,
        "max_joint_acceleration_rad_per_sec2": max_acceleration,
        "max_timestamp_gap_ms": max_timestamp_gap,
    }


def _compute_self_collision_metrics(
    trajectory: list[TeleopMjlabTrajectorySample],
    *,
    thresholds: TeleopMjlabMotionThresholds,
    robot_model: TeleopMjlabRobotModel | None,
    issues: list[TeleopMjlabMotionIssue],
) -> dict[str, int | bool]:
    if not thresholds.require_self_collision_check:
        return {"checked": False, "sample_count": 0, "collision_count": 0}

    if not robot_model or not (robot_model.urdf_xml or "").strip():
        issues.append(
            _build_issue(
                code=TELEOP_MJLAB_ISSUE_CODE_SELF_COLLISION_MODEL_MISSING,
                reason=(
                    "MJLab self-collision validation requires the active robot "
                    "URDF model."
                ),
                severity=TELEOP_MJLAB_ISSUE_SEVERITY_WARNING,
            )
        )
        return {"checked": False, "sample_count": 0, "collision_count": 0}

    if not _is_python_module_available(TELEOP_MJLAB_RUNTIME_DEPENDENCY_MUJOCO):
        issues.append(
            _build_issue(
                code=TELEOP_MJLAB_ISSUE_CODE_SELF_COLLISION_RUNTIME_UNAVAILABLE,
                reason=(
                    "MJLab self-collision validation requires the MuJoCo "
                    "runtime."
                ),
                severity=TELEOP_MJLAB_ISSUE_SEVERITY_WARNING,
            )
        )
        return {"checked": False, "sample_count": 0, "collision_count": 0}

    try:
        import mujoco

        with tempfile.TemporaryDirectory(prefix="teleop-mjlab-collision-") as workspace:
            urdf_path = _stage_robot_model_for_mujoco(
                robot_model=robot_model,
                workspace_dir=Path(workspace),
            )
            model = mujoco.MjModel.from_xml_path(str(urdf_path))
            data = mujoco.MjData(model)
            collision_count = _scan_mujoco_self_collisions(
                mujoco=mujoco,
                model=model,
                data=data,
                trajectory=trajectory,
                thresholds=thresholds,
                issues=issues,
            )
    except Exception as exc:
        issues.append(
            _build_issue(
                code=TELEOP_MJLAB_ISSUE_CODE_SELF_COLLISION_MODEL_INVALID,
                reason=(
                    "MJLab could not compile the robot model for "
                    f"self-collision validation: {exc}"
                ),
                severity=TELEOP_MJLAB_ISSUE_SEVERITY_WARNING,
            )
        )
        return {"checked": False, "sample_count": 0, "collision_count": 0}

    return {
        "checked": True,
        "sample_count": len(trajectory),
        "collision_count": collision_count,
    }


def _prune_mjlab_live_sessions() -> None:
    now = time.monotonic()
    with _MJLAB_LIVE_SESSION_LOCK:
        expired_session_ids = [
            session_id
            for session_id, session in _MJLAB_LIVE_SESSIONS.items()
            if now - session.last_used_at_monotonic > TELEOP_MJLAB_LIVE_SESSION_TTL_SEC
        ]
        for session_id in expired_session_ids:
            _MJLAB_LIVE_SESSIONS.pop(session_id, None)


def _step_mjlab_live_session_locked(
    session: _MjlabLiveSession,
    target_sample: _RolloutEndEffectorSample,
) -> tuple[TeleopMjlabRolloutFrame, int, float, float]:
    duration_ms = target_sample.timestamp_ms - session.previous_sample.timestamp_ms
    if duration_ms <= 0:
        duration_ms = session.step_ms
    duration_ms = min(TELEOP_MJLAB_MAX_LIVE_STEP_MS, max(session.step_ms, duration_ms))
    step_count = max(1, math.ceil(duration_ms / session.step_ms))
    dt_seconds = session.step_ms / TELEOP_MJLAB_MILLISECONDS_PER_SECOND
    start_monotonic = time.perf_counter()

    for step_index in range(1, step_count + 1):
        interpolated_sample = _interpolate_rollout_sample(
            session.previous_sample,
            target_sample,
            step_index / step_count,
        )
        session.previous_proxy_poses = _set_mjlab_gripper_proxy_pose(
            session.data,
            proxy_joints=session.proxy_joints,
            sample=interpolated_sample,
            dt_seconds=dt_seconds,
            previous_proxy_poses=session.previous_proxy_poses,
        )
        session.mujoco.mj_step(session.model, session.data)

    wall_ms = (time.perf_counter() - start_monotonic) * TELEOP_MJLAB_MILLISECONDS_PER_SECOND

    session.previous_sample = target_sample
    frame = _build_mjlab_rollout_frame(
        mujoco=session.mujoco,
        model=session.model,
        data=session.data,
        sample=target_sample,
        trajectory_by_sample_index={},
        dynamic_primitives=session.dynamic_primitives,
        dynamic_body_ids=session.dynamic_body_ids,
    )
    realtime_factor = (
        duration_ms / wall_ms
        if wall_ms > TELEOP_MJLAB_ZERO_DURATION_MS
        else TELEOP_MJLAB_ZERO_METRIC
    )
    return frame, step_count, wall_ms, realtime_factor


def _as_rollout_trajectory_warning(
    issue: TeleopMjlabMotionIssue,
) -> TeleopMjlabMotionIssue:
    return TeleopMjlabMotionIssue(
        severity=TELEOP_MJLAB_ISSUE_SEVERITY_WARNING,
        code=issue.code,
        reason=issue.reason,
        sample_index=issue.sample_index,
        joint_name=issue.joint_name,
        link_names=issue.link_names,
        value=issue.value,
        limit=issue.limit,
    )


def _build_mjlab_proxy_rollout_mjcf(
    primitives: Sequence[SimPrimitive],
    *,
    model_name: str,
    rollout_step_ms: float,
) -> str:
    mjcf_text = export_primitives_to_mujoco_mjcf(
        primitives,
        model_name=model_name,
        include_floor=True,
    )
    root = ET.fromstring(mjcf_text)
    option = root.find("option")
    if option is None:
        option = ET.SubElement(root, "option")
    option.set(
        "timestep",
        _format_mjcf_float(rollout_step_ms / TELEOP_MJLAB_MILLISECONDS_PER_SECOND),
    )
    option.set("iterations", "80")

    worldbody = root.find("worldbody")
    if worldbody is None:
        worldbody = ET.SubElement(root, "worldbody")
    _append_mjlab_proxy_finger_body(
        worldbody,
        body_name=MJLAB_LEFT_FINGER_BODY_NAME,
        geom_name=MJLAB_LEFT_FINGER_GEOM_NAME,
        rgba=(0.95, 0.95, 0.95, 0.8),
    )
    _append_mjlab_proxy_finger_body(
        worldbody,
        body_name=MJLAB_RIGHT_FINGER_BODY_NAME,
        geom_name=MJLAB_RIGHT_FINGER_GEOM_NAME,
        rgba=(0.85, 0.85, 0.85, 0.8),
    )
    _append_mjlab_proxy_lift_plate_body(worldbody)
    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="unicode")


def _append_mjlab_proxy_finger_body(
    worldbody: ET.Element,
    *,
    body_name: str,
    geom_name: str,
    rgba: tuple[float, float, float, float],
) -> None:
    body = ET.SubElement(
        worldbody,
        "body",
        {
            "name": body_name,
            "pos": "0 0 0.2",
            "quat": "1 0 0 0",
        },
    )
    ET.SubElement(body, "joint", {"name": f"{body_name}_free", "type": "free"})
    ET.SubElement(
        body,
        "geom",
        {
            "name": geom_name,
            "type": "box",
            "size": _format_mjcf_vec(
                TELEOP_MJLAB_ROLLOUT_GRIPPER_FINGER_HALF_EXTENTS_M
            ),
            "rgba": _format_mjcf_vec(rgba),
            "friction": "8 0.1 0.1",
            "condim": "6",
            "mass": "5",
        },
    )

def _append_mjlab_proxy_lift_plate_body(worldbody: ET.Element) -> None:
    body = ET.SubElement(
        worldbody,
        "body",
        {
            "name": MJLAB_GRIPPER_LIFT_PLATE_BODY_NAME,
            "pos": "0 0 0.1",
            "quat": "1 0 0 0",
        },
    )
    ET.SubElement(
        body,
        "joint",
        {"name": f"{MJLAB_GRIPPER_LIFT_PLATE_BODY_NAME}_free", "type": "free"},
    )
    ET.SubElement(
        body,
        "geom",
        {
            "name": MJLAB_GRIPPER_LIFT_PLATE_GEOM_NAME,
            "type": "box",
            "size": _format_mjcf_vec(
                TELEOP_MJLAB_ROLLOUT_GRIPPER_LIFT_PLATE_HALF_EXTENTS_M
            ),
            "rgba": "0.3 0.65 1 0.35",
            "friction": "8 0.1 0.1",
            "condim": "6",
            "mass": "5",
        },
    )


def _run_mjlab_proxy_rollout(
    *,
    mujoco: Any,
    model: Any,
    data: Any,
    trajectory: list[TeleopMjlabTrajectorySample],
    dynamic_primitives: tuple[SimPrimitive, ...],
    end_effector_samples: list[TeleopMjlabEndEffectorSample],
    frame_map: WorldLayoutFrameMap,
    rollout_step_ms: float,
) -> list[TeleopMjlabRolloutFrame]:
    rollout_samples = _prepare_rollout_end_effector_samples(
        end_effector_samples,
        frame_map=frame_map,
    )
    if not rollout_samples:
        return []

    proxy_joints = _resolve_mjlab_gripper_proxy_joints(mujoco=mujoco, model=model)
    dynamic_body_ids = _resolve_mjlab_dynamic_body_ids(
        mujoco=mujoco,
        model=model,
        dynamic_primitives=dynamic_primitives,
    )
    trajectory_by_sample_index = {
        sample.sample_index: sample
        for sample in trajectory
    }

    previous_sample = rollout_samples[0]
    previous_proxy_poses = _set_mjlab_gripper_proxy_pose(
        data,
        proxy_joints=proxy_joints,
        sample=previous_sample,
        dt_seconds=None,
        previous_proxy_poses=None,
    )
    mujoco.mj_forward(model, data)
    frames = [
        _build_mjlab_rollout_frame(
            mujoco=mujoco,
            model=model,
            data=data,
            sample=previous_sample,
            trajectory_by_sample_index=trajectory_by_sample_index,
            dynamic_primitives=dynamic_primitives,
            dynamic_body_ids=dynamic_body_ids,
        )
    ]

    for target_sample in rollout_samples[1:]:
        duration_ms = max(
            rollout_step_ms,
            target_sample.timestamp_ms - previous_sample.timestamp_ms,
        )
        step_count = max(1, math.ceil(duration_ms / rollout_step_ms))
        for step_index in range(1, step_count + 1):
            interpolated_sample = _interpolate_rollout_sample(
                previous_sample,
                target_sample,
                step_index / step_count,
            )
            previous_proxy_poses = _set_mjlab_gripper_proxy_pose(
                data,
                proxy_joints=proxy_joints,
                sample=interpolated_sample,
                dt_seconds=rollout_step_ms / TELEOP_MJLAB_MILLISECONDS_PER_SECOND,
                previous_proxy_poses=previous_proxy_poses,
            )
            mujoco.mj_step(model, data)
        frames.append(
            _build_mjlab_rollout_frame(
                mujoco=mujoco,
                model=model,
                data=data,
                sample=target_sample,
                trajectory_by_sample_index=trajectory_by_sample_index,
                dynamic_primitives=dynamic_primitives,
                dynamic_body_ids=dynamic_body_ids,
            )
        )
        previous_sample = target_sample

    return frames


def _prepare_rollout_end_effector_samples(
    samples: list[TeleopMjlabEndEffectorSample],
    *,
    frame_map: WorldLayoutFrameMap,
) -> list[_RolloutEndEffectorSample]:
    return sorted(
        (
            _transform_rollout_end_effector_sample(sample, frame_map=frame_map)
            for sample in samples
        ),
        key=lambda sample: (sample.timestamp_ms, sample.sample_index),
    )


def _transform_rollout_end_effector_sample(
    sample: TeleopMjlabEndEffectorSample,
    *,
    frame_map: WorldLayoutFrameMap,
) -> _RolloutEndEffectorSample:
    return _RolloutEndEffectorSample(
        sample_index=sample.sample_index,
        timestamp_ms=sample.timestamp_ms,
        position_xyz=_transform_rollout_position(sample.position_xyz, frame_map),
        quat_wxyz=_transform_rollout_quat(sample.quat_wxyz, frame_map),
        gripper_opening_m=min(
            TELEOP_MJLAB_ROLLOUT_GRIPPER_MAX_OPENING_M,
            max(0.0, sample.gripper_opening_m),
        ),
    )


def _transform_rollout_position(
    position_xyz: Sequence[float],
    frame_map: WorldLayoutFrameMap,
) -> tuple[float, float, float]:
    transformed = _rollout_frame_matrix(frame_map) @ np.array(position_xyz, dtype=float)
    return tuple(float(component) for component in transformed)


def _transform_rollout_quat(
    quat_wxyz: Sequence[float],
    frame_map: WorldLayoutFrameMap,
) -> tuple[float, float, float, float]:
    normalized = _normalize_quat_wxyz(quat_wxyz)
    if frame_map == "identity":
        return normalized
    frame = _rollout_frame_matrix(frame_map)
    rotation = Rotation.from_quat(
        [normalized[1], normalized[2], normalized[3], normalized[0]]
    ).as_matrix()
    transformed_rotation = frame @ rotation @ frame.T
    quat_xyzw = Rotation.from_matrix(transformed_rotation).as_quat()
    return _normalize_quat_wxyz((quat_xyzw[3], quat_xyzw[0], quat_xyzw[1], quat_xyzw[2]))


def _rollout_frame_matrix(frame_map: WorldLayoutFrameMap) -> np.ndarray:
    if frame_map == "identity":
        return np.eye(3)
    if frame_map == "studio-y-up-to-z-up":
        return STUDIO_Y_UP_TO_Z_UP
    raise ValueError(f"Unsupported MJLab rollout frame map: {frame_map}")


def _interpolate_rollout_sample(
    start: _RolloutEndEffectorSample,
    end: _RolloutEndEffectorSample,
    alpha: float,
) -> _RolloutEndEffectorSample:
    clamped_alpha = min(1.0, max(0.0, alpha))
    return _RolloutEndEffectorSample(
        sample_index=end.sample_index,
        timestamp_ms=start.timestamp_ms
        + (end.timestamp_ms - start.timestamp_ms) * clamped_alpha,
        position_xyz=tuple(
            start.position_xyz[index]
            + (end.position_xyz[index] - start.position_xyz[index]) * clamped_alpha
            for index in range(3)
        ),
        quat_wxyz=_nlerp_quat_wxyz(start.quat_wxyz, end.quat_wxyz, clamped_alpha),
        gripper_opening_m=start.gripper_opening_m
        + (end.gripper_opening_m - start.gripper_opening_m) * clamped_alpha,
    )


def _set_mjlab_gripper_proxy_pose(
    data: Any,
    *,
    proxy_joints: dict[str, tuple[int, int]],
    sample: _RolloutEndEffectorSample,
    dt_seconds: float | None,
    previous_proxy_poses: dict[str, tuple[np.ndarray, tuple[float, float, float, float]]] | None,
) -> dict[str, tuple[np.ndarray, tuple[float, float, float, float]]]:
    poses = _desired_mjlab_gripper_proxy_poses(sample)
    return _set_mjlab_gripper_proxy_poses(
        data,
        proxy_joints=proxy_joints,
        poses=poses,
        dt_seconds=dt_seconds,
        previous_proxy_poses=previous_proxy_poses,
    )


def _set_mjlab_gripper_proxy_poses(
    data: Any,
    *,
    proxy_joints: dict[str, tuple[int, int]],
    poses: dict[str, tuple[np.ndarray, tuple[float, float, float, float]]],
    dt_seconds: float | None,
    previous_proxy_poses: dict[str, tuple[np.ndarray, tuple[float, float, float, float]]] | None,
) -> dict[str, tuple[np.ndarray, tuple[float, float, float, float]]]:
    for body_name, (position, quat_wxyz) in poses.items():
        qpos_address, qvel_address = proxy_joints[body_name]
        data.qpos[qpos_address : qpos_address + 7] = [
            float(position[0]),
            float(position[1]),
            float(position[2]),
            quat_wxyz[0],
            quat_wxyz[1],
            quat_wxyz[2],
            quat_wxyz[3],
        ]
        previous_pose = (
            previous_proxy_poses.get(body_name)
            if previous_proxy_poses is not None
            else None
        )
        if previous_pose is not None and dt_seconds is not None and dt_seconds > 0:
            linear_velocity = (position - previous_pose[0]) / dt_seconds
        else:
            linear_velocity = np.zeros(3)
        data.qvel[qvel_address : qvel_address + 6] = [
            float(linear_velocity[0]),
            float(linear_velocity[1]),
            float(linear_velocity[2]),
            0.0,
            0.0,
            0.0,
        ]
    return poses


def _desired_mjlab_gripper_proxy_poses(
    sample: _RolloutEndEffectorSample,
) -> dict[str, tuple[np.ndarray, tuple[float, float, float, float]]]:
    finger_half_y = TELEOP_MJLAB_ROLLOUT_GRIPPER_FINGER_HALF_EXTENTS_M[1]
    center_offset_m = (sample.gripper_opening_m * 0.5) + finger_half_y
    offset = _rotate_vector_by_quat_wxyz(sample.quat_wxyz, (0.0, center_offset_m, 0.0))
    center = np.array(sample.position_xyz, dtype=float)
    lift_plate_offset = _rotate_vector_by_quat_wxyz(
        sample.quat_wxyz,
        TELEOP_MJLAB_ROLLOUT_GRIPPER_LIFT_PLATE_OFFSET_M
    )
    return {
        MJLAB_LEFT_FINGER_BODY_NAME: (center + offset, sample.quat_wxyz),
        MJLAB_RIGHT_FINGER_BODY_NAME: (center - offset, sample.quat_wxyz),
        MJLAB_GRIPPER_LIFT_PLATE_BODY_NAME: (
            center + lift_plate_offset,
            sample.quat_wxyz,
        ),
    }


def _rotate_vector_by_quat_wxyz(
    quat_wxyz: Sequence[float],
    vector_xyz: Sequence[float],
) -> np.ndarray:
    quat_vector = np.array(
        [quat_wxyz[1], quat_wxyz[2], quat_wxyz[3]],
        dtype=float,
    )
    vector = np.array(vector_xyz, dtype=float)
    uv = np.cross(quat_vector, vector)
    uuv = np.cross(quat_vector, uv)
    return vector + 2.0 * (quat_wxyz[0] * uv + uuv)


def _resolve_mjlab_gripper_proxy_joints(
    *,
    mujoco: Any,
    model: Any,
) -> dict[str, tuple[int, int]]:
    proxy_joints: dict[str, tuple[int, int]] = {}
    for body_name in MJLAB_GRIPPER_BODY_NAMES:
        joint_name = f"{body_name}_free"
        joint_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, joint_name)
        if joint_id < 0:
            raise ValueError(f"Missing MJLab proxy gripper joint: {joint_name}")
        proxy_joints[body_name] = (
            int(model.jnt_qposadr[joint_id]),
            int(model.jnt_dofadr[joint_id]),
        )
    return proxy_joints


def _resolve_mjlab_dynamic_body_ids(
    *,
    mujoco: Any,
    model: Any,
    dynamic_primitives: tuple[SimPrimitive, ...],
) -> dict[str, int]:
    body_ids: dict[str, int] = {}
    for primitive in dynamic_primitives:
        body_name = f"{primitive.sim_name}_body"
        body_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, body_name)
        if body_id < 0:
            raise ValueError(
                f"Missing MuJoCo dynamic body for world object: {primitive.source_id}"
            )
        body_ids[primitive.source_id] = int(body_id)
    return body_ids


def _build_mjlab_rollout_frame(
    *,
    mujoco: Any,
    model: Any,
    data: Any,
    sample: _RolloutEndEffectorSample,
    trajectory_by_sample_index: dict[int, TeleopMjlabTrajectorySample],
    dynamic_primitives: tuple[SimPrimitive, ...],
    dynamic_body_ids: dict[str, int],
) -> TeleopMjlabRolloutFrame:
    trajectory_sample = trajectory_by_sample_index.get(sample.sample_index)
    return TeleopMjlabRolloutFrame(
        sample_index=sample.sample_index,
        timestamp_ms=sample.timestamp_ms,
        joint_positions_rad=(
            dict(trajectory_sample.joint_positions_rad)
            if trajectory_sample is not None
            else {}
        ),
        object_poses=[
            _build_mjlab_rollout_object_pose(
                data=data,
                primitive=primitive,
                body_id=dynamic_body_ids[primitive.source_id],
            )
            for primitive in dynamic_primitives
        ],
        contacts=_scan_mjlab_rollout_contacts(
            mujoco=mujoco,
            model=model,
            data=data,
            dynamic_body_ids=dynamic_body_ids,
            sample_index=sample.sample_index,
        ),
    )


def _build_mjlab_rollout_object_pose(
    *,
    data: Any,
    primitive: SimPrimitive,
    body_id: int,
) -> TeleopMjlabRolloutObjectPose:
    return TeleopMjlabRolloutObjectPose(
        object_id=primitive.source_id,
        name=primitive.source_name,
        sim_name=primitive.sim_name,
        position_xyz=tuple(float(value) for value in data.xpos[body_id]),
        quat_wxyz=tuple(float(value) for value in data.xquat[body_id]),
    )


def _scan_mjlab_rollout_contacts(
    *,
    mujoco: Any,
    model: Any,
    data: Any,
    dynamic_body_ids: dict[str, int],
    sample_index: int,
) -> list[TeleopMjlabRolloutContact]:
    source_id_by_body_id = {
        body_id: source_id
        for source_id, body_id in dynamic_body_ids.items()
    }
    contacts: list[TeleopMjlabRolloutContact] = []
    for contact_index in range(data.ncon):
        contact = data.contact[contact_index]
        geom_ids = (int(contact.geom1), int(contact.geom2))
        body_ids = tuple(int(model.geom_bodyid[geom_id]) for geom_id in geom_ids)
        object_id = (
            source_id_by_body_id.get(body_ids[0])
            or source_id_by_body_id.get(body_ids[1])
        )
        if object_id is None:
            continue
        geom_names = [
            _mujoco_object_name(mujoco, model, mujoco.mjtObj.mjOBJ_GEOM, geom_id)
            for geom_id in geom_ids
        ]
        contacts.append(
            TeleopMjlabRolloutContact(
                sample_index=sample_index,
                object_id=object_id,
                geom_names=geom_names,
                body_names=[
                    _mujoco_object_name(
                        mujoco,
                        model,
                        mujoco.mjtObj.mjOBJ_BODY,
                        body_id,
                    )
                    for body_id in body_ids
                ],
                distance_m=float(contact.dist),
                with_gripper=any(name in MJLAB_GRIPPER_GEOM_NAMES for name in geom_names),
            )
        )
    return contacts


def _mujoco_object_name(mujoco: Any, model: Any, obj_type: Any, obj_id: int) -> str:
    return mujoco.mj_id2name(model, obj_type, obj_id) or f"object_{obj_id}"


def _normalize_quat_wxyz(values: Sequence[float]) -> tuple[float, float, float, float]:
    norm = math.sqrt(sum(float(value) * float(value) for value in values))
    if norm <= TELEOP_MJLAB_ZERO_METRIC:
        return (1.0, 0.0, 0.0, 0.0)
    return tuple(float(value) / norm for value in values)  # type: ignore[return-value]


def _nlerp_quat_wxyz(
    start: Sequence[float],
    end: Sequence[float],
    alpha: float,
) -> tuple[float, float, float, float]:
    start_array = np.array(_normalize_quat_wxyz(start), dtype=float)
    end_array = np.array(_normalize_quat_wxyz(end), dtype=float)
    if float(np.dot(start_array, end_array)) < 0:
        end_array = -end_array
    blended = start_array + (end_array - start_array) * alpha
    return _normalize_quat_wxyz(tuple(float(value) for value in blended))


def _format_mjcf_float(value: float) -> str:
    return f"{float(value):.12g}"


def _format_mjcf_vec(values: Sequence[float]) -> str:
    return " ".join(_format_mjcf_float(float(value)) for value in values)


def _stage_robot_model_for_mujoco(
    *,
    robot_model: TeleopMjlabRobotModel,
    workspace_dir: Path,
) -> Path:
    mesh_reference_map = _stage_robot_mesh_files(
        mesh_files=robot_model.mesh_files,
        workspace_dir=workspace_dir,
    )
    urdf_xml = _rewrite_urdf_mesh_references(
        robot_model.urdf_xml or "",
        mesh_reference_map=mesh_reference_map,
    )
    urdf_path = workspace_dir / "robot.urdf"
    urdf_path.write_text(urdf_xml, encoding="utf-8")
    return urdf_path


def _stage_robot_mesh_files(
    *,
    mesh_files: list[TeleopMjlabRobotMeshFile],
    workspace_dir: Path,
) -> StagedMeshReferenceMap:
    mesh_dir = workspace_dir / TELEOP_MJLAB_STAGED_MESH_DIRNAME
    mesh_dir.mkdir(parents=True, exist_ok=True)
    reference_map: StagedMeshReferenceMap = {}
    staged_by_content_path: dict[str, str] = {}

    for mesh_index, mesh_file in enumerate(mesh_files):
        normalized_path = _normalize_mesh_reference(mesh_file.path)
        if not normalized_path:
            continue
        staged_reference = staged_by_content_path.get(normalized_path)
        if staged_reference is None:
            staged_reference = _write_staged_mesh_file(
                mesh_file=mesh_file,
                normalized_path=normalized_path,
                mesh_index=mesh_index,
                mesh_dir=mesh_dir,
            )
            staged_by_content_path[normalized_path] = staged_reference
        for alias in _build_mesh_reference_aliases(normalized_path):
            reference_map.setdefault(alias, staged_reference)

    return reference_map


def _write_staged_mesh_file(
    *,
    mesh_file: TeleopMjlabRobotMeshFile,
    normalized_path: str,
    mesh_index: int,
    mesh_dir: Path,
) -> str:
    try:
        mesh_bytes = base64.b64decode(mesh_file.base64_content, validate=True)
    except binascii.Error as exc:
        raise ValueError(f"Invalid base64 mesh payload for {mesh_file.path!r}.") from exc

    raw_filename = Path(normalized_path).name or f"mesh_{mesh_index}"
    safe_filename = INVALID_STAGED_MESH_FILENAME_PATTERN.sub("_", raw_filename)
    staged_filename = (
        f"{TELEOP_MJLAB_STAGED_MESH_FILENAME_PREFIX}_{mesh_index}_{safe_filename}"
    )
    staged_path = mesh_dir / staged_filename
    staged_path.write_bytes(mesh_bytes)
    # MuJoCo's URDF compiler resolves some mesh references by basename even when
    # the URDF contains a relative folder. Keep a root-level copy and rewrite to
    # the basename so XML compilation is deterministic across mesh schemes.
    root_staged_path = mesh_dir.parent / staged_filename
    if root_staged_path != staged_path:
        root_staged_path.write_bytes(mesh_bytes)
    return staged_filename


def _rewrite_urdf_mesh_references(
    urdf_xml: str,
    *,
    mesh_reference_map: StagedMeshReferenceMap,
) -> str:
    if not mesh_reference_map:
        return urdf_xml
    root = ET.fromstring(urdf_xml)
    for mesh_element in root.iter("mesh"):
        raw_filename = (mesh_element.get("filename") or "").strip()
        if not raw_filename:
            continue
        staged_reference = _resolve_staged_mesh_reference(
            raw_filename,
            mesh_reference_map=mesh_reference_map,
        )
        if staged_reference:
            mesh_element.set("filename", staged_reference)
    return ET.tostring(root, encoding="unicode")


def _resolve_staged_mesh_reference(
    raw_reference: str,
    *,
    mesh_reference_map: StagedMeshReferenceMap,
) -> str | None:
    normalized_reference = _normalize_mesh_reference(raw_reference)
    candidate_aliases = _build_mesh_reference_aliases(normalized_reference)
    for alias in candidate_aliases:
        staged_reference = mesh_reference_map.get(alias)
        if staged_reference:
            return staged_reference

    suffix_matches = [
        staged_reference
        for alias, staged_reference in mesh_reference_map.items()
        if (
            normalized_reference
            and (alias.endswith(f"/{normalized_reference}") or alias == normalized_reference)
        )
    ]
    unique_suffix_matches = sorted(set(suffix_matches))
    if len(unique_suffix_matches) == 1:
        return unique_suffix_matches[0]

    basename = Path(normalized_reference).name
    basename_matches = [
        staged_reference
        for alias, staged_reference in mesh_reference_map.items()
        if Path(alias).name == basename
    ]
    unique_basename_matches = sorted(set(basename_matches))
    return unique_basename_matches[0] if len(unique_basename_matches) == 1 else None


def _build_mesh_reference_aliases(normalized_path: str) -> list[str]:
    aliases = [normalized_path]
    path_parts = normalized_path.split("/")
    for start_index in range(1, len(path_parts)):
        aliases.append("/".join(path_parts[start_index:]))
    basename = Path(normalized_path).name
    if basename:
        aliases.append(basename)
    return list(dict.fromkeys(alias for alias in aliases if alias))


def _normalize_mesh_reference(reference: str) -> str:
    normalized = reference.strip().replace("\\", "/")
    if normalized.startswith(f"{FILE_REFERENCE_SCHEME}{MESH_REFERENCE_SCHEME_SEPARATOR}"):
        normalized = normalized.split(MESH_REFERENCE_SCHEME_SEPARATOR, 1)[1]
    elif normalized.startswith(f"{PACKAGE_REFERENCE_SCHEME}{MESH_REFERENCE_SCHEME_SEPARATOR}"):
        normalized = normalized.split(MESH_REFERENCE_SCHEME_SEPARATOR, 1)[1]
    elif MESH_REFERENCE_SCHEME_SEPARATOR in normalized:
        return normalized
    normalized = normalized.lstrip("/")
    parts: list[str] = []
    for part in normalized.split("/"):
        if not part or part == ".":
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return "/".join(parts)


def _scan_mujoco_self_collisions(
    *,
    mujoco,
    model,
    data,
    trajectory: list[TeleopMjlabTrajectorySample],
    thresholds: TeleopMjlabMotionThresholds,
    issues: list[TeleopMjlabMotionIssue],
) -> int:
    collision_count = 0
    joint_ids_by_name = _resolve_mujoco_joint_ids_by_name(mujoco, model)

    for sample in trajectory:
        _apply_mujoco_joint_positions(
            joint_positions=sample.joint_positions_rad,
            joint_ids_by_name=joint_ids_by_name,
            model=model,
            data=data,
        )
        mujoco.mj_forward(model, data)

        for contact_index in range(data.ncon):
            contact = data.contact[contact_index]
            if float(contact.dist) > thresholds.max_self_collision_distance_m:
                continue
            link_names = _resolve_mujoco_contact_link_names(
                mujoco=mujoco,
                model=model,
                geom_ids=(int(contact.geom1), int(contact.geom2)),
            )
            if link_names is None:
                continue
            collision_count += 1
            if collision_count > TELEOP_MJLAB_MAX_SELF_COLLISION_ISSUES:
                continue
            issues.append(
                _build_issue(
                    code=TELEOP_MJLAB_ISSUE_CODE_SELF_COLLISION,
                    reason=(
                        "MJLab detected robot self-collision between "
                        f"{link_names[0]} and {link_names[1]}."
                    ),
                    sample_index=sample.sample_index,
                    link_names=link_names,
                    value=max(TELEOP_MJLAB_ZERO_METRIC, -float(contact.dist)),
                    limit=thresholds.max_self_collision_distance_m,
                    severity=TELEOP_MJLAB_ISSUE_SEVERITY_WARNING,
                )
            )

    return collision_count


def _resolve_mujoco_joint_ids_by_name(mujoco, model) -> dict[str, int]:
    joint_ids_by_name: dict[str, int] = {}
    for joint_id in range(model.njnt):
        joint_name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_JOINT, joint_id)
        if joint_name:
            joint_ids_by_name[joint_name] = joint_id
    return joint_ids_by_name


def _apply_mujoco_joint_positions(
    *,
    joint_positions: dict[str, float],
    joint_ids_by_name: dict[str, int],
    model,
    data,
) -> None:
    for joint_name, joint_position in joint_positions.items():
        joint_id = joint_ids_by_name.get(joint_name)
        if joint_id is None:
            continue
        qpos_address = int(model.jnt_qposadr[joint_id])
        data.qpos[qpos_address] = joint_position


def _resolve_mujoco_contact_link_names(
    *,
    mujoco,
    model,
    geom_ids: tuple[int, int],
) -> list[str] | None:
    body_ids = [int(model.geom_bodyid[geom_id]) for geom_id in geom_ids]
    if (
        body_ids[0] == body_ids[1]
        or body_ids[0] == TELEOP_MJLAB_WORLD_BODY_ID
        or body_ids[1] == TELEOP_MJLAB_WORLD_BODY_ID
    ):
        return None

    link_names = [
        mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY, body_id)
        or f"body_{body_id}"
        for body_id in body_ids
    ]
    return sorted(link_names)


def _build_issue(
    *,
    code: str,
    reason: str,
    sample_index: int | None = None,
    joint_name: str | None = None,
    link_names: list[str] | None = None,
    value: float | None = None,
    limit: float | None = None,
    severity: str = TELEOP_MJLAB_ISSUE_SEVERITY_ERROR,
) -> TeleopMjlabMotionIssue:
    return TeleopMjlabMotionIssue(
        severity=severity,
        code=code,
        reason=reason,
        sample_index=sample_index,
        joint_name=joint_name,
        link_names=link_names or [],
        value=value,
        limit=limit,
    )


def _build_mjlab_manifest(
    *,
    recording: TeleopReplayRecording,
    runtime: TeleopMjlabRuntimeStatus,
    thresholds: TeleopMjlabMotionThresholds,
    trajectory: list[TeleopMjlabTrajectorySample],
    joint_names: list[str],
    self_collision_metrics: dict[str, int | bool],
) -> dict[str, object]:
    return {
        "schema_version": TELEOP_MJLAB_SCHEMA_VERSION,
        "bundle_kind": TELEOP_MJLAB_BUNDLE_KIND,
        "recording_id": recording.recording_id,
        "task_language": recording.task_language,
        "runtime": runtime.model_dump(by_alias=True),
        "timestamp_semantics": TELEOP_MJLAB_TIMESTAMP_SEMANTICS_COMMAND_SOURCE,
        "joint_names": joint_names,
        "thresholds": thresholds.model_dump(by_alias=True),
        "self_collision": {
            "checked": self_collision_metrics["checked"],
            "sample_count": self_collision_metrics["sample_count"],
            "collision_count": self_collision_metrics["collision_count"],
        },
        "trajectory_sample_count": len(trajectory),
        "trajectory": [
            sample.model_dump(by_alias=True)
            for sample in trajectory
        ],
    }
