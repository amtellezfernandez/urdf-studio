from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
from statistics import mean, pstdev
from time import monotonic, sleep
from typing import Protocol

from backend.models.robot_gateway import (
    RobotGatewayJointJogRequest,
    RobotGatewayLeaseRequest,
)
from backend.models.teleop_replay import (
    TeleopReplayExportResult,
    TeleopReplayGatewayStateSnapshot,
    TeleopReplayRecording,
    TeleopReplayRecordingSample,
    TeleopReplaySampleResult,
    TeleopReplayValidationResult,
)
from backend.robot_gateway.adapters import RobotGatewayAdapterConfig
from backend.robot_gateway.params import ROBOT_GATEWAY_OPENARM_PROFILE_ID
from backend.robot_gateway.runtime import RobotGatewayRuntime, RobotGatewayRuntimeConfig
from backend.services.teleop_replay_params import (
    TELEOP_REPLAY_ACTION_SEMANTICS_GATEWAY_DELTA,
    TELEOP_REPLAY_ACTION_SEMANTICS_KINEMATIC_ABSOLUTE,
    TELEOP_REPLAY_CHUNKS_SIZE,
    TELEOP_REPLAY_CODEBASE_VERSION,
    TELEOP_REPLAY_COMMAND_KIND_ESTOP,
    TELEOP_REPLAY_COMMAND_KIND_JOINT_JOG,
    TELEOP_REPLAY_COMMAND_KIND_JOINT_TARGETS,
    TELEOP_REPLAY_COMMAND_KIND_STOP,
    TELEOP_REPLAY_CONTEXT_PHYSICS_SOURCE_NONE,
    TELEOP_REPLAY_CONTEXT_REPLAY_GUARANTEE_KINEMATIC,
    TELEOP_REPLAY_CONTEXT_TELEOPERATION_MODE_STUDIO_KINEMATIC,
    TELEOP_REPLAY_DATA_CHUNK_INDEX,
    TELEOP_REPLAY_DATASET_FORMAT_VERSION,
    TELEOP_REPLAY_DEFAULT_FPS,
    TELEOP_REPLAY_DEFAULT_JOINT_TOLERANCE_RAD,
    TELEOP_REPLAY_EPISODE_INDEX,
    TELEOP_REPLAY_EXPORT_MODE_GATEWAY_REPLAY,
    TELEOP_REPLAY_EXPORT_MODE_STUDIO_KINEMATIC,
    TELEOP_REPLAY_FEATURE_DTYPE_FLOAT32,
    TELEOP_REPLAY_FEATURE_DTYPE_INT64,
    TELEOP_REPLAY_FILE_INDEX,
    TELEOP_REPLAY_FIRST_DATASET_INDEX,
    TELEOP_REPLAY_FPS_IS_NOMINAL,
    TELEOP_REPLAY_INFO_FILENAME,
    TELEOP_REPLAY_JSON_INDENT_SPACES,
    TELEOP_REPLAY_GATEWAY_REPLAY_COMMAND_KINDS,
    TELEOP_REPLAY_MILLISECONDS_PER_SECOND,
    TELEOP_REPLAY_META_FILENAME,
    TELEOP_REPLAY_MJLAB_EXPORT_GATE_RECORDING_MISMATCH,
    TELEOP_REPLAY_MJLAB_EXPORT_GATE_REQUIRED,
    TELEOP_REPLAY_MJLAB_EXPORT_REJECTION_PREFIX,
    TELEOP_REPLAY_MJLAB_EXPORT_SELF_COLLISION_UNCHECKED,
    TELEOP_REPLAY_NO_REPLAYED_SAMPLE_COUNT,
    TELEOP_REPLAY_OPERATOR_ID,
    TELEOP_REPLAY_EMPTY_STATS_COUNT,
    TELEOP_REPLAY_OBSERVATION_SEMANTICS_GATEWAY_STATE,
    TELEOP_REPLAY_OBSERVATION_SEMANTICS_KINEMATIC_PROXY,
    TELEOP_REPLAY_OUTPUT_ROOT,
    TELEOP_REPLAY_PARQUET_CHUNK_NAME,
    TELEOP_REPLAY_PARQUET_FILE_NAME,
    TELEOP_REPLAY_SCHEMA_VERSION,
    TELEOP_REPLAY_SCALAR_FEATURE_SHAPE,
    TELEOP_REPLAY_SINGLE_EPISODE_COUNT,
    TELEOP_REPLAY_SINGLE_TASK_COUNT,
    TELEOP_REPLAY_STATS_FILENAME,
    TELEOP_REPLAY_TASK_INDEX,
    TELEOP_REPLAY_TASKS_FILENAME,
    TELEOP_REPLAY_FPS_SEMANTICS_NOMINAL_IRREGULAR,
    TELEOP_REPLAY_TIMESTAMP_SEMANTICS_COMMAND_SOURCE,
    TELEOP_REPLAY_TIMING_MODE_LOGICAL,
    TELEOP_REPLAY_TIMING_MODE_WALL_CLOCK,
    TELEOP_REPLAY_ZERO_FEATURE_VALUE,
    TELEOP_REPLAY_ZERO_JOINT_ERROR_RAD,
    TELEOP_REPLAY_ZERO_JOINT_RAD,
    TELEOP_REPLAY_ZERO_MILLISECONDS,
    TELEOP_REPLAY_ZERO_TIMESTAMP_SECONDS,
    format_teleop_replay_run_id,
)


class TeleopReplayInputError(ValueError):
    pass


class TeleopReplayDependencyError(RuntimeError):
    pass


class TeleopReplayClock(Protocol):
    timing_mode: str

    def wait_until_ms(self, scheduled_time_ms: float) -> float:
        ...


@dataclass(frozen=True)
class TeleopReplayMjlabExportGate:
    recording_id: str
    success: bool
    self_collision_checked: bool


class LogicalTeleopReplayClock:
    timing_mode = TELEOP_REPLAY_TIMING_MODE_LOGICAL

    def __init__(self) -> None:
        self.current_time_ms = TELEOP_REPLAY_ZERO_MILLISECONDS

    def wait_until_ms(self, scheduled_time_ms: float) -> float:
        wait_ms = max(
            TELEOP_REPLAY_ZERO_MILLISECONDS,
            scheduled_time_ms - self.current_time_ms,
        )
        self.current_time_ms = max(self.current_time_ms, scheduled_time_ms)
        return wait_ms


class WallClockTeleopReplayClock:
    timing_mode = TELEOP_REPLAY_TIMING_MODE_WALL_CLOCK

    def __init__(self) -> None:
        self.started_at_seconds = monotonic()

    def wait_until_ms(self, scheduled_time_ms: float) -> float:
        elapsed_ms = (
            monotonic() - self.started_at_seconds
        ) * TELEOP_REPLAY_MILLISECONDS_PER_SECOND
        wait_ms = max(
            TELEOP_REPLAY_ZERO_MILLISECONDS,
            scheduled_time_ms - elapsed_ms,
        )
        if wait_ms > TELEOP_REPLAY_ZERO_MILLISECONDS:
            sleep(wait_ms / TELEOP_REPLAY_MILLISECONDS_PER_SECOND)
        return wait_ms


@dataclass(frozen=True)
class TeleopReplayScheduleEntry:
    sample: TeleopReplayRecordingSample
    scheduled_time_ms: float
    scheduled_delay_ms: float


def validate_teleop_replay(
    recording: TeleopReplayRecording,
    *,
    joint_tolerance_rad: float = TELEOP_REPLAY_DEFAULT_JOINT_TOLERANCE_RAD,
    replay_clock: TeleopReplayClock | None = None,
) -> TeleopReplayValidationResult:
    replayable_samples = _require_replayable_samples(recording)
    replay_schedule = _build_replay_schedule(recording, replayable_samples)
    clock = replay_clock or LogicalTeleopReplayClock()
    runtime = _build_replay_runtime(recording, replayable_samples)
    sample_results: list[TeleopReplaySampleResult] = []
    max_joint_error_rad = TELEOP_REPLAY_ZERO_JOINT_ERROR_RAD
    scheduled_sleep_ms = TELEOP_REPLAY_ZERO_MILLISECONDS
    max_scheduled_delay_ms = TELEOP_REPLAY_ZERO_MILLISECONDS

    for schedule_entry in replay_schedule:
        sample = schedule_entry.sample
        waited_ms = clock.wait_until_ms(schedule_entry.scheduled_time_ms)
        scheduled_sleep_ms += waited_ms
        max_scheduled_delay_ms = max(
            max_scheduled_delay_ms,
            schedule_entry.scheduled_delay_ms,
        )
        ack_accepted = _apply_replay_sample(runtime, sample)
        actual_state = runtime.read_state()
        sample_error_rad = _compute_state_error_rad(
            expected=sample.post_command_state,
            actual_positions=actual_state.joint_positions_rad,
        )
        max_joint_error_rad = max(max_joint_error_rad, sample_error_rad)
        sample_success = ack_accepted and sample_error_rad <= joint_tolerance_rad
        sample_results.append(
            TeleopReplaySampleResult(
                sample_index=sample.sample_index,
                command_kind=sample.command.kind,
                accepted=sample_success,
                max_joint_error_rad=sample_error_rad,
                scheduled_time_ms=schedule_entry.scheduled_time_ms,
                scheduled_delay_ms=schedule_entry.scheduled_delay_ms,
                reason=(
                    "replayed"
                    if sample_success
                    else _build_sample_failure_reason(
                        ack_accepted=ack_accepted,
                        sample_error_rad=sample_error_rad,
                        joint_tolerance_rad=joint_tolerance_rad,
                    )
                ),
            )
        )

    return TeleopReplayValidationResult(
        success=all(result.accepted for result in sample_results),
        recording_id=recording.recording_id,
        sample_count=len(recording.samples),
        replayed_sample_count=len(replayable_samples),
        max_joint_error_rad=max_joint_error_rad,
        joint_tolerance_rad=joint_tolerance_rad,
        timing_mode=clock.timing_mode,
        scheduled_duration_ms=_resolve_replay_schedule_duration_ms(replay_schedule),
        scheduled_sleep_ms=scheduled_sleep_ms,
        max_scheduled_delay_ms=max_scheduled_delay_ms,
        sample_results=sample_results,
    )


def build_teleop_replay_mjlab_export_gate(
    *,
    recording_id: str,
    success: bool,
    self_collision_checked: bool,
) -> TeleopReplayMjlabExportGate:
    return TeleopReplayMjlabExportGate(
        recording_id=recording_id,
        success=success,
        self_collision_checked=self_collision_checked,
    )


def _require_mjlab_export_gate(
    recording: TeleopReplayRecording,
    mjlab_export_gate: TeleopReplayMjlabExportGate | None,
) -> None:
    if mjlab_export_gate is None:
        raise TeleopReplayInputError(TELEOP_REPLAY_MJLAB_EXPORT_GATE_REQUIRED)
    if mjlab_export_gate.recording_id != recording.recording_id:
        raise TeleopReplayInputError(
            TELEOP_REPLAY_MJLAB_EXPORT_GATE_RECORDING_MISMATCH
        )
    if not mjlab_export_gate.success:
        raise TeleopReplayInputError(TELEOP_REPLAY_MJLAB_EXPORT_REJECTION_PREFIX)
    if not mjlab_export_gate.self_collision_checked:
        raise TeleopReplayInputError(
            TELEOP_REPLAY_MJLAB_EXPORT_SELF_COLLISION_UNCHECKED
        )


def export_teleop_replay_lerobot(
    recording: TeleopReplayRecording,
    *,
    joint_tolerance_rad: float = TELEOP_REPLAY_DEFAULT_JOINT_TOLERANCE_RAD,
    mjlab_export_gate: TeleopReplayMjlabExportGate | None = None,
    output_dir: Path | None = None,
) -> TeleopReplayExportResult:
    _require_mjlab_export_gate(recording, mjlab_export_gate)
    validation = validate_teleop_replay(
        recording,
        joint_tolerance_rad=joint_tolerance_rad,
    )
    if not validation.success:
        return TeleopReplayExportResult(
            **validation.model_dump(),
            output_path="",
            dataset_path="",
            artifact_paths=[],
        )

    dataset_path = (
        output_dir
        if output_dir is not None
        else TELEOP_REPLAY_OUTPUT_ROOT
        / format_teleop_replay_run_id(recording.recording_id)
    )
    artifact_paths = _write_lerobot_dataset(recording, dataset_path)
    return TeleopReplayExportResult(
        **validation.model_dump(),
        output_path=str(dataset_path),
        dataset_path=str(dataset_path),
        artifact_paths=[str(path) for path in artifact_paths],
    )


def export_teleop_kinematic_lerobot(
    recording: TeleopReplayRecording,
    *,
    joint_tolerance_rad: float = TELEOP_REPLAY_DEFAULT_JOINT_TOLERANCE_RAD,
    mjlab_export_gate: TeleopReplayMjlabExportGate | None = None,
    output_dir: Path | None = None,
) -> TeleopReplayExportResult:
    _require_mjlab_export_gate(recording, mjlab_export_gate)
    samples = _require_studio_kinematic_samples(recording)
    joint_names = _collect_kinematic_joint_names(samples)
    data_rows = _build_kinematic_lerobot_data_rows(recording, samples, joint_names)
    validation = _build_kinematic_export_validation(
        recording,
        samples,
        joint_tolerance_rad=joint_tolerance_rad,
    )
    dataset_path = (
        output_dir
        if output_dir is not None
        else TELEOP_REPLAY_OUTPUT_ROOT
        / format_teleop_replay_run_id(recording.recording_id)
    )
    artifact_paths = _write_lerobot_dataset_from_rows(
        recording,
        dataset_path,
        joint_names,
        data_rows,
        sample_count=len(samples),
        export_mode=TELEOP_REPLAY_EXPORT_MODE_STUDIO_KINEMATIC,
        source_samples=samples,
    )
    return TeleopReplayExportResult(
        **validation.model_dump(),
        output_path=str(dataset_path),
        dataset_path=str(dataset_path),
        artifact_paths=[str(path) for path in artifact_paths],
    )


def resolve_teleop_replay_output_dir(
    output_dir: str | None,
    *,
    recording_id: str,
) -> Path:
    if output_dir is None or not output_dir.strip():
        return TELEOP_REPLAY_OUTPUT_ROOT / format_teleop_replay_run_id(recording_id)

    root = TELEOP_REPLAY_OUTPUT_ROOT.resolve(strict=False)
    candidate = Path(output_dir).expanduser()
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved = candidate.resolve(strict=False)
    if not _is_path_relative_to(resolved, root):
        raise TeleopReplayInputError(
            f"Teleop replay output directory must stay under {root}."
        )
    return resolved


def _require_replayable_samples(
    recording: TeleopReplayRecording,
) -> list[TeleopReplayRecordingSample]:
    if not recording.samples:
        raise TeleopReplayInputError("Teleop replay requires at least one sample.")
    unsupported_command_indices = [
        sample.sample_index
        for sample in recording.samples
        if sample.command.kind not in TELEOP_REPLAY_GATEWAY_REPLAY_COMMAND_KINDS
    ]
    if unsupported_command_indices:
        formatted_indices = ", ".join(
            str(index) for index in unsupported_command_indices
        )
        supported_kinds = ", ".join(sorted(TELEOP_REPLAY_GATEWAY_REPLAY_COMMAND_KINDS))
        raise TeleopReplayInputError(
            "Teleop replay only supports gateway command kinds "
            f"{supported_kinds}; unsupported samples: {formatted_indices}."
        )
    missing_state_indices = [
        sample.sample_index
        for sample in recording.samples
        if sample.state_capture_status != "captured" or sample.post_command_state is None
    ]
    if missing_state_indices:
        formatted_indices = ", ".join(str(index) for index in missing_state_indices)
        raise TeleopReplayInputError(
            f"Teleop replay requires post-command gateway state for samples: {formatted_indices}."
        )
    return recording.samples


def _is_path_relative_to(candidate: Path, root: Path) -> bool:
    return candidate == root or root in candidate.parents


def _require_studio_kinematic_samples(
    recording: TeleopReplayRecording,
) -> list[TeleopReplayRecordingSample]:
    if not recording.samples:
        raise TeleopReplayInputError(
            "Studio kinematic export requires at least one sample."
        )
    invalid_indices: list[int] = []
    for sample in recording.samples:
        if (
            sample.command.kind != TELEOP_REPLAY_COMMAND_KIND_JOINT_TARGETS
            or not sample.command.joint_targets
        ):
            invalid_indices.append(sample.sample_index)
            continue
        if (
            _read_sample_context(sample, "teleoperationMode", "teleoperation_mode")
            != TELEOP_REPLAY_CONTEXT_TELEOPERATION_MODE_STUDIO_KINEMATIC
            or _read_sample_context(sample, "physicsSource", "physics_source")
            != TELEOP_REPLAY_CONTEXT_PHYSICS_SOURCE_NONE
            or _read_sample_context(sample, "replayGuarantee", "replay_guarantee")
            != TELEOP_REPLAY_CONTEXT_REPLAY_GUARANTEE_KINEMATIC
        ):
            invalid_indices.append(sample.sample_index)
    if invalid_indices:
        formatted_indices = ", ".join(str(index) for index in invalid_indices)
        raise TeleopReplayInputError(
            "Studio kinematic export requires joint target samples with "
            "studio_kinematic/none/kinematic provenance for samples: "
            f"{formatted_indices}."
        )
    return recording.samples


def _read_sample_context(
    sample: TeleopReplayRecordingSample,
    camel_key: str,
    snake_key: str,
) -> object:
    if camel_key in sample.context:
        return sample.context[camel_key]
    return sample.context.get(snake_key)


def _build_replay_schedule(
    recording: TeleopReplayRecording,
    samples: list[TeleopReplayRecordingSample],
) -> list[TeleopReplayScheduleEntry]:
    schedule: list[TeleopReplayScheduleEntry] = []
    previous_time_ms = TELEOP_REPLAY_ZERO_MILLISECONDS
    for sample in samples:
        scheduled_time_ms = _resolve_sample_command_time_ms(recording, sample)
        scheduled_delay_ms = max(
            TELEOP_REPLAY_ZERO_MILLISECONDS,
            scheduled_time_ms - previous_time_ms,
        )
        schedule.append(
            TeleopReplayScheduleEntry(
                sample=sample,
                scheduled_time_ms=scheduled_time_ms,
                scheduled_delay_ms=scheduled_delay_ms,
            )
        )
        previous_time_ms = max(previous_time_ms, scheduled_time_ms)
    return schedule


def _resolve_replay_schedule_duration_ms(
    schedule: list[TeleopReplayScheduleEntry],
) -> float:
    if not schedule:
        return TELEOP_REPLAY_ZERO_MILLISECONDS
    return max(entry.scheduled_time_ms for entry in schedule)


def _resolve_sample_command_time_ms(
    recording: TeleopReplayRecording,
    sample: TeleopReplayRecordingSample,
) -> float:
    for absolute_timestamp_ms in (
        sample.metadata.source_ts_ms,
        sample.recorded_at_ms,
    ):
        if _is_episode_timestamp(recording, absolute_timestamp_ms):
            return max(
                TELEOP_REPLAY_ZERO_MILLISECONDS,
                float(absolute_timestamp_ms - recording.started_at_ms),
            )
    return max(
        TELEOP_REPLAY_ZERO_MILLISECONDS,
        float(sample.recorded_at_ms - recording.started_at_ms),
    )


def resolve_teleop_replay_sample_command_time_ms(
    recording: TeleopReplayRecording,
    sample: TeleopReplayRecordingSample,
) -> float:
    return _resolve_sample_command_time_ms(recording, sample)


def _is_episode_timestamp(
    recording: TeleopReplayRecording,
    absolute_timestamp_ms: int | float,
) -> bool:
    if isinstance(absolute_timestamp_ms, bool):
        return False
    if isinstance(absolute_timestamp_ms, int):
        return recording.started_at_ms <= absolute_timestamp_ms <= recording.ended_at_ms
    if isinstance(absolute_timestamp_ms, float):
        return (
            math.isfinite(absolute_timestamp_ms)
            and absolute_timestamp_ms >= recording.started_at_ms
            and absolute_timestamp_ms <= recording.ended_at_ms
        )
    return False


def _build_lerobot_timestamp_seconds(
    recording: TeleopReplayRecording,
    sample: TeleopReplayRecordingSample,
) -> float:
    return _resolve_sample_command_time_ms(
        recording,
        sample,
    ) / TELEOP_REPLAY_MILLISECONDS_PER_SECOND


def _build_replay_runtime(
    recording: TeleopReplayRecording,
    samples: list[TeleopReplayRecordingSample],
) -> RobotGatewayRuntime:
    first_state = samples[0].post_command_state
    if first_state is None:
        raise TeleopReplayInputError("Teleop replay requires post-command gateway state.")
    joint_names = _collect_replay_joint_names(samples)
    initial_positions = _build_initial_joint_positions(samples, joint_names)
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(
            runtime_mode="control",
            adapter_config=RobotGatewayAdapterConfig(
                adapter_kind="fake_openarm",
                robot_id=first_state.robot_id,
                joint_names=tuple(joint_names),
                initial_joint_positions_rad=initial_positions,
                enforce_motion_limits=False,
            ),
        )
    )
    lease = runtime.request_lease(
        RobotGatewayLeaseRequest(
            operator_id=TELEOP_REPLAY_OPERATOR_ID,
            profile_id=_read_recording_profile_id(recording, first_state),
        )
    )
    if not lease.accepted:
        raise TeleopReplayInputError(lease.reason or "Replay lease was rejected.")
    return runtime


def _read_recording_profile_id(
    recording: TeleopReplayRecording,
    first_state: TeleopReplayGatewayStateSnapshot,
) -> str:
    for sample in recording.samples:
        profile_id = sample.context.get("profileId") or sample.context.get("profile_id")
        if isinstance(profile_id, str) and profile_id.strip():
            return profile_id.strip()
    return first_state.profile_id or ROBOT_GATEWAY_OPENARM_PROFILE_ID


def _collect_replay_joint_names(samples: list[TeleopReplayRecordingSample]) -> list[str]:
    joint_names: set[str] = set()
    for sample in samples:
        if sample.post_command_state is None:
            continue
        joint_names.update(sample.post_command_state.joint_positions_rad)
    return sorted(joint_names)


def _collect_kinematic_joint_names(
    samples: list[TeleopReplayRecordingSample],
) -> list[str]:
    joint_names: set[str] = set()
    for sample in samples:
        if sample.command.joint_targets:
            joint_names.update(sample.command.joint_targets)
    if not joint_names:
        raise TeleopReplayInputError(
            "Studio kinematic export requires at least one joint target."
        )
    return sorted(joint_names)


def _build_initial_joint_positions(
    samples: list[TeleopReplayRecordingSample],
    joint_names: list[str],
) -> dict[str, float]:
    first_pre_state = samples[0].pre_command_state
    if first_pre_state is None:
        return {joint_name: TELEOP_REPLAY_ZERO_JOINT_RAD for joint_name in joint_names}
    return {
        joint_name: first_pre_state.joint_positions_rad.get(
            joint_name,
            TELEOP_REPLAY_ZERO_JOINT_RAD,
        )
        for joint_name in joint_names
    }


def _build_first_known_kinematic_targets(
    samples: list[TeleopReplayRecordingSample],
    joint_names: list[str],
) -> dict[str, float]:
    initial_targets: dict[str, float] = {}
    for joint_name in joint_names:
        for sample in samples:
            target = (sample.command.joint_targets or {}).get(joint_name)
            if target is None:
                continue
            initial_targets[joint_name] = target
            break
        initial_targets.setdefault(joint_name, TELEOP_REPLAY_ZERO_JOINT_RAD)
    return initial_targets


def _apply_replay_sample(
    runtime: RobotGatewayRuntime,
    sample: TeleopReplayRecordingSample,
) -> bool:
    if sample.command.kind == TELEOP_REPLAY_COMMAND_KIND_JOINT_JOG:
        joint_jog = sample.command.joint_jog or {}
        joint_name = joint_jog.get("joint_name")
        delta_rad = joint_jog.get("delta_rad")
        if not isinstance(joint_name, str) or not isinstance(delta_rad, int | float):
            return False
        ack = runtime.apply_joint_jog(
            RobotGatewayJointJogRequest(
                operator_id=TELEOP_REPLAY_OPERATOR_ID,
                joint_name=joint_name,
                delta_rad=float(delta_rad),
                sequence=sample.metadata.sequence,
                source_ts_ms=TELEOP_REPLAY_ZERO_MILLISECONDS,
            )
        )
        return ack.accepted
    if sample.command.kind == TELEOP_REPLAY_COMMAND_KIND_STOP:
        return runtime.stop(sequence=sample.metadata.sequence).accepted
    if sample.command.kind == TELEOP_REPLAY_COMMAND_KIND_ESTOP:
        return runtime.estop(sequence=sample.metadata.sequence).accepted
    return False


def _compute_state_error_rad(
    *,
    expected: TeleopReplayGatewayStateSnapshot | None,
    actual_positions: dict[str, float],
) -> float:
    if expected is None:
        return math.inf
    max_error_rad = TELEOP_REPLAY_ZERO_JOINT_ERROR_RAD
    for joint_name, expected_value in expected.joint_positions_rad.items():
        actual_value = actual_positions.get(joint_name)
        if actual_value is None:
            return math.inf
        max_error_rad = max(max_error_rad, abs(actual_value - expected_value))
    return max_error_rad


def _build_sample_failure_reason(
    *,
    ack_accepted: bool,
    sample_error_rad: float,
    joint_tolerance_rad: float,
) -> str:
    if not ack_accepted:
        return "command rejected by replay runtime"
    if sample_error_rad > joint_tolerance_rad:
        return "post-command joint state diverged"
    return "replay failed"


def _write_lerobot_dataset(
    recording: TeleopReplayRecording,
    dataset_path: Path,
) -> list[Path]:
    samples = _require_replayable_samples(recording)
    joint_names = _collect_replay_joint_names(samples)
    data_rows = _build_lerobot_data_rows(recording, samples, joint_names)
    return _write_lerobot_dataset_from_rows(
        recording,
        dataset_path,
        joint_names,
        data_rows,
        sample_count=len(samples),
        export_mode=TELEOP_REPLAY_EXPORT_MODE_GATEWAY_REPLAY,
        source_samples=samples,
    )


def _write_lerobot_dataset_from_rows(
    recording: TeleopReplayRecording,
    dataset_path: Path,
    joint_names: list[str],
    data_rows: list[dict[str, object]],
    *,
    sample_count: int,
    export_mode: str,
    source_samples: list[TeleopReplayRecordingSample],
) -> list[Path]:
    stats = _build_lerobot_stats(data_rows, joint_names)

    data_file = (
        dataset_path
        / "data"
        / TELEOP_REPLAY_PARQUET_CHUNK_NAME
        / TELEOP_REPLAY_PARQUET_FILE_NAME
    )
    episodes_file = (
        dataset_path
        / "meta"
        / "episodes"
        / TELEOP_REPLAY_PARQUET_CHUNK_NAME
        / TELEOP_REPLAY_PARQUET_FILE_NAME
    )
    tasks_file = dataset_path / "meta" / TELEOP_REPLAY_TASKS_FILENAME
    info_file = dataset_path / "meta" / TELEOP_REPLAY_INFO_FILENAME
    stats_file = dataset_path / "meta" / TELEOP_REPLAY_STATS_FILENAME
    replay_meta_file = dataset_path / "meta" / TELEOP_REPLAY_META_FILENAME

    _write_json(info_file, _build_lerobot_info(recording, joint_names, len(data_rows)))
    _write_json(stats_file, stats)
    _write_json(
        replay_meta_file,
        {
            "schema_version": TELEOP_REPLAY_SCHEMA_VERSION,
            "recording_id": recording.recording_id,
            "source_recording_schema_version": recording.schema_version,
            "joint_names": joint_names,
            "sample_count": sample_count,
            "export_mode": export_mode,
            "action_semantics": _resolve_lerobot_action_semantics(export_mode),
            "observation_semantics": _resolve_lerobot_observation_semantics(
                export_mode
            ),
            "timestamp_semantics": TELEOP_REPLAY_TIMESTAMP_SEMANTICS_COMMAND_SOURCE,
            "fps_semantics": TELEOP_REPLAY_FPS_SEMANTICS_NOMINAL_IRREGULAR,
            "provenance": _build_provenance_summary(source_samples),
        },
    )
    _write_parquet(
        tasks_file,
        [{"task": recording.task_language, "task_index": TELEOP_REPLAY_TASK_INDEX}],
    )
    _write_parquet(
        episodes_file,
        [_build_episode_row(recording, stats, len(data_rows))],
    )
    _write_parquet(data_file, data_rows)
    return [info_file, stats_file, replay_meta_file, tasks_file, episodes_file, data_file]


def _resolve_lerobot_action_semantics(export_mode: str) -> str:
    if export_mode == TELEOP_REPLAY_EXPORT_MODE_STUDIO_KINEMATIC:
        return TELEOP_REPLAY_ACTION_SEMANTICS_KINEMATIC_ABSOLUTE
    return TELEOP_REPLAY_ACTION_SEMANTICS_GATEWAY_DELTA


def _resolve_lerobot_observation_semantics(export_mode: str) -> str:
    if export_mode == TELEOP_REPLAY_EXPORT_MODE_STUDIO_KINEMATIC:
        return TELEOP_REPLAY_OBSERVATION_SEMANTICS_KINEMATIC_PROXY
    return TELEOP_REPLAY_OBSERVATION_SEMANTICS_GATEWAY_STATE


def _build_provenance_summary(
    samples: list[TeleopReplayRecordingSample],
) -> dict[str, object]:
    return {
        "teleoperation_modes": _collect_context_values(samples, "teleoperationMode"),
        "input_sources": _collect_context_values(samples, "inputSource"),
        "physics_sources": _collect_context_values(samples, "physicsSource"),
        "replay_guarantees": _collect_context_values(samples, "replayGuarantee"),
        "command_kinds": sorted({sample.command.kind for sample in samples}),
    }


def _collect_context_values(
    samples: list[TeleopReplayRecordingSample],
    camel_key: str,
) -> list[object]:
    values = {
        sample.context[camel_key]
        for sample in samples
        if camel_key in sample.context and sample.context[camel_key] is not None
    }
    return sorted(values, key=str)


def _build_lerobot_data_rows(
    recording: TeleopReplayRecording,
    samples: list[TeleopReplayRecordingSample],
    joint_names: list[str],
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for frame_index, sample in enumerate(samples):
        post_state = sample.post_command_state
        if post_state is None:
            continue
        action = _build_action_vector(sample, joint_names)
        observation = [
            post_state.joint_positions_rad.get(
                joint_name,
                TELEOP_REPLAY_ZERO_JOINT_RAD,
            )
            for joint_name in joint_names
        ]
        rows.append(
            {
                "action": action,
                "observation.state": observation,
                "timestamp": max(
                    TELEOP_REPLAY_ZERO_TIMESTAMP_SECONDS,
                    _build_lerobot_timestamp_seconds(recording, sample),
                ),
                "frame_index": frame_index,
                "episode_index": TELEOP_REPLAY_EPISODE_INDEX,
                "index": frame_index,
                "task_index": TELEOP_REPLAY_TASK_INDEX,
            }
        )
    return rows


def _build_kinematic_lerobot_data_rows(
    recording: TeleopReplayRecording,
    samples: list[TeleopReplayRecordingSample],
    joint_names: list[str],
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    current_targets = _build_first_known_kinematic_targets(samples, joint_names)
    for frame_index, sample in enumerate(samples):
        if sample.command.joint_targets:
            current_targets.update(sample.command.joint_targets)
        target_vector = [current_targets[joint_name] for joint_name in joint_names]
        rows.append(
            {
                "action": target_vector,
                "observation.state": target_vector,
                "timestamp": max(
                    TELEOP_REPLAY_ZERO_TIMESTAMP_SECONDS,
                    _build_lerobot_timestamp_seconds(recording, sample),
                ),
                "frame_index": frame_index,
                "episode_index": TELEOP_REPLAY_EPISODE_INDEX,
                "index": frame_index,
                "task_index": TELEOP_REPLAY_TASK_INDEX,
            }
        )
    return rows


def _build_kinematic_export_validation(
    recording: TeleopReplayRecording,
    samples: list[TeleopReplayRecordingSample],
    *,
    joint_tolerance_rad: float,
) -> TeleopReplayValidationResult:
    replay_schedule = _build_replay_schedule(recording, samples)
    return TeleopReplayValidationResult(
        success=True,
        recording_id=recording.recording_id,
        sample_count=len(recording.samples),
        replayed_sample_count=TELEOP_REPLAY_NO_REPLAYED_SAMPLE_COUNT,
        max_joint_error_rad=TELEOP_REPLAY_ZERO_JOINT_ERROR_RAD,
        joint_tolerance_rad=joint_tolerance_rad,
        scheduled_duration_ms=_resolve_replay_schedule_duration_ms(replay_schedule),
        scheduled_sleep_ms=_resolve_replay_schedule_duration_ms(replay_schedule),
        max_scheduled_delay_ms=max(
            (entry.scheduled_delay_ms for entry in replay_schedule),
            default=TELEOP_REPLAY_ZERO_MILLISECONDS,
        ),
        sample_results=[
            TeleopReplaySampleResult(
                sample_index=entry.sample.sample_index,
                command_kind=entry.sample.command.kind,
                accepted=True,
                max_joint_error_rad=TELEOP_REPLAY_ZERO_JOINT_ERROR_RAD,
                scheduled_time_ms=entry.scheduled_time_ms,
                scheduled_delay_ms=entry.scheduled_delay_ms,
                reason="exported kinematic joint targets",
            )
            for entry in replay_schedule
        ],
    )


def _build_action_vector(
    sample: TeleopReplayRecordingSample,
    joint_names: list[str],
) -> list[float]:
    action = [TELEOP_REPLAY_ZERO_JOINT_RAD for _joint_name in joint_names]
    if (
        sample.command.kind != TELEOP_REPLAY_COMMAND_KIND_JOINT_JOG
        or not sample.command.joint_jog
    ):
        return action
    joint_name = sample.command.joint_jog.get("joint_name")
    delta_rad = sample.command.joint_jog.get("delta_rad")
    if not isinstance(joint_name, str) or not isinstance(delta_rad, int | float):
        return action
    try:
        joint_index = joint_names.index(joint_name)
    except ValueError:
        return action
    action[joint_index] = float(delta_rad)
    return action


def _build_lerobot_info(
    recording: TeleopReplayRecording,
    joint_names: list[str],
    row_count: int,
) -> dict[str, object]:
    feature_names = [f"{joint_name}.pos" for joint_name in joint_names]
    vector_shape = [len(joint_names)]
    scalar_shape = list(TELEOP_REPLAY_SCALAR_FEATURE_SHAPE)
    robot_type = _read_robot_type(recording)
    return {
        "codebase_version": TELEOP_REPLAY_CODEBASE_VERSION,
        "dataset_format_version": TELEOP_REPLAY_DATASET_FORMAT_VERSION,
        "robot_type": robot_type,
        "fps": TELEOP_REPLAY_DEFAULT_FPS,
        "fps_is_nominal": TELEOP_REPLAY_FPS_IS_NOMINAL,
        "fps_semantics": TELEOP_REPLAY_FPS_SEMANTICS_NOMINAL_IRREGULAR,
        "timestamp_semantics": TELEOP_REPLAY_TIMESTAMP_SEMANTICS_COMMAND_SOURCE,
        "features": {
            "action": {
                "dtype": TELEOP_REPLAY_FEATURE_DTYPE_FLOAT32,
                "names": feature_names,
                "shape": vector_shape,
            },
            "observation.state": {
                "dtype": TELEOP_REPLAY_FEATURE_DTYPE_FLOAT32,
                "names": feature_names,
                "shape": vector_shape,
            },
            "timestamp": {
                "dtype": TELEOP_REPLAY_FEATURE_DTYPE_FLOAT32,
                "shape": scalar_shape,
                "names": None,
            },
            "frame_index": {
                "dtype": TELEOP_REPLAY_FEATURE_DTYPE_INT64,
                "shape": scalar_shape,
                "names": None,
            },
            "episode_index": {
                "dtype": TELEOP_REPLAY_FEATURE_DTYPE_INT64,
                "shape": scalar_shape,
                "names": None,
            },
            "index": {
                "dtype": TELEOP_REPLAY_FEATURE_DTYPE_INT64,
                "shape": scalar_shape,
                "names": None,
            },
            "task_index": {
                "dtype": TELEOP_REPLAY_FEATURE_DTYPE_INT64,
                "shape": scalar_shape,
                "names": None,
            },
        },
        "total_episodes": TELEOP_REPLAY_SINGLE_EPISODE_COUNT,
        "total_frames": row_count,
        "total_tasks": TELEOP_REPLAY_SINGLE_TASK_COUNT,
        "chunks_size": TELEOP_REPLAY_CHUNKS_SIZE,
        "data_path": "data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet",
        "splits": {"train": "0:1"},
    }


def _read_robot_type(recording: TeleopReplayRecording) -> str:
    for sample in recording.samples:
        robot_id = sample.context.get("robotId")
        if isinstance(robot_id, str) and robot_id.strip():
            return robot_id.strip()
        if sample.post_command_state is not None:
            return sample.post_command_state.robot_id
    return "openarm"


def _build_lerobot_stats(
    rows: list[dict[str, object]],
    joint_names: list[str],
) -> dict[str, object]:
    action_values = [row["action"] for row in rows]
    state_values = [row["observation.state"] for row in rows]
    return {
        "frame_index": _build_scalar_stats([float(row["frame_index"]) for row in rows]),
        "episode_index": _build_scalar_stats([float(row["episode_index"]) for row in rows]),
        "index": _build_scalar_stats([float(row["index"]) for row in rows]),
        "task_index": _build_scalar_stats([float(row["task_index"]) for row in rows]),
        "timestamp": _build_scalar_stats([float(row["timestamp"]) for row in rows]),
        "action": _build_vector_stats(action_values, len(joint_names)),
        "observation.state": _build_vector_stats(state_values, len(joint_names)),
    }


def _build_episode_row(
    recording: TeleopReplayRecording,
    stats: dict[str, object],
    row_count: int,
) -> dict[str, object]:
    return {
        "episode_index": TELEOP_REPLAY_EPISODE_INDEX,
        "data/chunk_index": TELEOP_REPLAY_DATA_CHUNK_INDEX,
        "data/file_index": TELEOP_REPLAY_FILE_INDEX,
        "tasks": [recording.task_language],
        "length": row_count,
        "dataset_from_index": TELEOP_REPLAY_FIRST_DATASET_INDEX,
        "dataset_to_index": row_count,
        "stats/action/min": stats["action"]["min"],
        "stats/action/max": stats["action"]["max"],
        "stats/action/mean": stats["action"]["mean"],
        "stats/action/std": stats["action"]["std"],
        "stats/action/count": stats["action"]["count"],
        "stats/observation.state/min": stats["observation.state"]["min"],
        "stats/observation.state/max": stats["observation.state"]["max"],
        "stats/observation.state/mean": stats["observation.state"]["mean"],
        "stats/observation.state/std": stats["observation.state"]["std"],
        "stats/observation.state/count": stats["observation.state"]["count"],
        "stats/timestamp/min": stats["timestamp"]["min"],
        "stats/timestamp/max": stats["timestamp"]["max"],
        "stats/timestamp/mean": stats["timestamp"]["mean"],
        "stats/timestamp/std": stats["timestamp"]["std"],
        "stats/timestamp/count": stats["timestamp"]["count"],
    }


def _build_scalar_stats(values: list[float]) -> dict[str, list[float] | list[int]]:
    if not values:
        return {
            "min": [TELEOP_REPLAY_ZERO_FEATURE_VALUE],
            "max": [TELEOP_REPLAY_ZERO_FEATURE_VALUE],
            "mean": [TELEOP_REPLAY_ZERO_FEATURE_VALUE],
            "std": [TELEOP_REPLAY_ZERO_FEATURE_VALUE],
            "count": [TELEOP_REPLAY_EMPTY_STATS_COUNT],
        }
    return {
        "min": [min(values)],
        "max": [max(values)],
        "mean": [mean(values)],
        "std": [pstdev(values)],
        "count": [len(values)],
    }


def _build_vector_stats(
    values: list[object],
    width: int,
) -> dict[str, list[float] | list[int]]:
    if not values or width == 0:
        return {
            "min": [TELEOP_REPLAY_ZERO_FEATURE_VALUE for _index in range(width)],
            "max": [TELEOP_REPLAY_ZERO_FEATURE_VALUE for _index in range(width)],
            "mean": [TELEOP_REPLAY_ZERO_FEATURE_VALUE for _index in range(width)],
            "std": [TELEOP_REPLAY_ZERO_FEATURE_VALUE for _index in range(width)],
            "count": [TELEOP_REPLAY_EMPTY_STATS_COUNT for _index in range(width)],
        }
    columns = [
        [float(row[index]) for row in values if isinstance(row, list)]
        for index in range(width)
    ]
    return {
        "min": [min(column) for column in columns],
        "max": [max(column) for column in columns],
        "mean": [mean(column) for column in columns],
        "std": [pstdev(column) for column in columns],
        "count": [len(column) for column in columns],
    }


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=TELEOP_REPLAY_JSON_INDENT_SPACES, sort_keys=True),
        encoding="utf-8",
    )


def _write_parquet(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pa, pq = _load_pyarrow()
    pq.write_table(pa.Table.from_pylist(rows), path)


def _load_pyarrow():
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ModuleNotFoundError as exc:
        raise TeleopReplayDependencyError(
            "pyarrow is required for teleop LeRobot export. Run `npm run setup` to install backend Python dependencies."
        ) from exc
    return pa, pq
