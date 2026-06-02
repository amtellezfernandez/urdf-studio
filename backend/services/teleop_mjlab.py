from __future__ import annotations

import base64
import binascii
from importlib.util import find_spec
import re
import tempfile
from pathlib import Path
import xml.etree.ElementTree as ET

from backend.models.teleop_mjlab import (
    TeleopMjlabMotionIssue,
    TeleopMjlabMotionThresholds,
    TeleopMjlabRobotModel,
    TeleopMjlabRobotMeshFile,
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
    TELEOP_MJLAB_BUNDLE_KIND,
    TELEOP_MJLAB_ISSUE_CODE_EMPTY_RECORDING,
    TELEOP_MJLAB_ISSUE_CODE_JOINT_ACCELERATION_LIMIT,
    TELEOP_MJLAB_ISSUE_CODE_JOINT_VELOCITY_LIMIT,
    TELEOP_MJLAB_ISSUE_CODE_MISSING_JOINT_STATE,
    TELEOP_MJLAB_ISSUE_CODE_NON_MONOTONIC_TIMESTAMP,
    TELEOP_MJLAB_ISSUE_CODE_SELF_COLLISION,
    TELEOP_MJLAB_ISSUE_CODE_SELF_COLLISION_MODEL_INVALID,
    TELEOP_MJLAB_ISSUE_CODE_SELF_COLLISION_MODEL_MISSING,
    TELEOP_MJLAB_ISSUE_CODE_SELF_COLLISION_RUNTIME_UNAVAILABLE,
    TELEOP_MJLAB_ISSUE_CODE_SHORT_TRAJECTORY,
    TELEOP_MJLAB_ISSUE_CODE_TIMESTAMP_GAP,
    TELEOP_MJLAB_ISSUE_SEVERITY_ERROR,
    TELEOP_MJLAB_ISSUE_SEVERITY_WARNING,
    TELEOP_MJLAB_MAX_SELF_COLLISION_ISSUES,
    TELEOP_MJLAB_MILLISECONDS_PER_SECOND,
    TELEOP_MJLAB_MIN_TRAJECTORY_SAMPLE_COUNT,
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


StagedMeshReferenceMap = dict[str, str]


def resolve_teleop_mjlab_runtime_status() -> TeleopMjlabRuntimeStatus:
    dependencies = [
        TeleopMjlabRuntimeDependency(
            name=dependency_name,
            available=find_spec(dependency_name) is not None,
        )
        for dependency_name in TELEOP_MJLAB_RUNTIME_DEPENDENCIES
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
    )


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

    if find_spec(TELEOP_MJLAB_RUNTIME_DEPENDENCY_MUJOCO) is None:
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
