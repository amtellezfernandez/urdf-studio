from __future__ import annotations

from copy import deepcopy
import json

import pytest
import pyarrow.parquet as pq
from fastapi import HTTPException

from backend.api.teleop_replay import (
    export_teleop_kinematic_recording_to_lerobot,
    export_teleop_replay_recording_to_lerobot,
    validate_teleop_replay_recording,
)
from backend.models.teleop_replay import (
    TeleopReplayExportRequest,
    TeleopReplayRecording,
    TeleopReplayValidateRequest,
)
from backend.services.teleop_replay import (
    build_teleop_replay_mjlab_export_gate,
    export_teleop_kinematic_lerobot,
    export_teleop_replay_lerobot,
    validate_teleop_replay,
)
from backend.services.teleop_replay_params import (
    TELEOP_REPLAY_ACTION_SEMANTICS_GATEWAY_DELTA,
    TELEOP_REPLAY_ACTION_SEMANTICS_KINEMATIC_ABSOLUTE,
    TELEOP_REPLAY_COMMAND_KIND_TWIST,
    TELEOP_REPLAY_CONTEXT_PHYSICS_SOURCE_NONE,
    TELEOP_REPLAY_CONTEXT_PHYSICS_SOURCE_GATEWAY_PROXY,
    TELEOP_REPLAY_CONTEXT_INPUT_SOURCE_IK_DRAG,
    TELEOP_REPLAY_CONTEXT_REPLAY_GUARANTEE_KINEMATIC,
    TELEOP_REPLAY_CONTEXT_TELEOPERATION_MODE_STUDIO_KINEMATIC,
    TELEOP_REPLAY_DEFAULT_FPS,
    TELEOP_REPLAY_DEFAULT_JOINT_TOLERANCE_RAD,
    TELEOP_REPLAY_EXPORT_MODE_GATEWAY_REPLAY,
    TELEOP_REPLAY_EXPORT_MODE_STUDIO_KINEMATIC,
    TELEOP_REPLAY_FPS_IS_NOMINAL,
    TELEOP_REPLAY_FPS_SEMANTICS_NOMINAL_IRREGULAR,
    TELEOP_REPLAY_INFO_FILENAME,
    TELEOP_REPLAY_MILLISECONDS_PER_SECOND,
    TELEOP_REPLAY_META_FILENAME,
    TELEOP_REPLAY_MJLAB_EXPORT_GATE_REQUIRED,
    TELEOP_REPLAY_MJLAB_EXPORT_REJECTION_PREFIX,
    TELEOP_REPLAY_MJLAB_EXPORT_SELF_COLLISION_UNCHECKED,
    TELEOP_REPLAY_OBSERVATION_SEMANTICS_GATEWAY_STATE,
    TELEOP_REPLAY_OBSERVATION_SEMANTICS_KINEMATIC_PROXY,
    TELEOP_REPLAY_OUTPUT_ROOT,
    TELEOP_REPLAY_PARQUET_CHUNK_NAME,
    TELEOP_REPLAY_PARQUET_FILE_NAME,
    TELEOP_REPLAY_STATS_FILENAME,
    TELEOP_REPLAY_TASKS_FILENAME,
    TELEOP_REPLAY_TIMESTAMP_SEMANTICS_COMMAND_SOURCE,
    TELEOP_REPLAY_TIMING_MODE_LOGICAL,
    TELEOP_REPLAY_ZERO_JOINT_ERROR_RAD,
    TELEOP_REPLAY_ZERO_MILLISECONDS,
)

TEST_RECORDING_ID = "fold-shirt-demo"
TEST_RECORDING_SCHEMA_VERSION = "urdf-studio.teleop-recording.v1"
TEST_SAMPLE_SCHEMA_VERSION = TEST_RECORDING_SCHEMA_VERSION
TEST_TASK_LANGUAGE = "fold a t-shirt"
TEST_STARTED_AT_MS = 1_000
TEST_RECORDED_AT_MS = 1_100
TEST_ENDED_AT_MS = 1_200
TEST_SOURCE_TS_MS = 1_090
TEST_SECOND_SOURCE_TS_MS = 1_160
TEST_OUT_OF_EPISODE_SOURCE_TS_MS = 99
TEST_SAMPLE_INDEX = 0
TEST_SECOND_SAMPLE_INDEX = 1
TEST_COMMAND_SEQUENCE = 1
TEST_SECOND_COMMAND_SEQUENCE = 2
TEST_JOINT_NAME = "openarm_left_joint1"
TEST_SECOND_JOINT_NAME = "openarm_left_joint2"
TEST_UNKNOWN_JOINT_NAME = "openarm_missing_joint"
TEST_INITIAL_POSITION_RAD = 0.2
TEST_DELTA_RAD = 0.1
TEST_SECOND_DELTA_RAD = 0.05
TEST_TWIST_X_MPS = 0.1
TEST_TWIST_Y_MPS = 0.0
TEST_TWIST_OMEGA_RPS = 0.2
TEST_DIVERGENCE_RAD = 0.02
TEST_EXPECTED_POSITION_RAD = TEST_INITIAL_POSITION_RAD + TEST_DELTA_RAD
TEST_SECOND_EXPECTED_POSITION_RAD = TEST_EXPECTED_POSITION_RAD + TEST_SECOND_DELTA_RAD
TEST_DIVERGED_POSITION_RAD = TEST_EXPECTED_POSITION_RAD + TEST_DIVERGENCE_RAD
TEST_KINEMATIC_TARGET_RAD = 0.42
TEST_SECOND_KINEMATIC_TARGET_RAD = 0.84
TEST_MJLAB_REJECTED_TARGET_RAD = 100.0
TEST_ROBOT_ID = "openarm"
TEST_ADAPTER_ID = "fake_openarm"
TEST_PROFILE_ID = "openarm_dual_arm_joint_jog"
TEST_STATE_SEQUENCE = 7
TEST_MJLAB_ROBOT_MODEL = {
    "name": "primitive_check",
    "urdfXml": """
<robot name="primitive_check">
  <link name="base">
    <collision>
      <geometry>
        <box size="0.1 0.1 0.1"/>
      </geometry>
    </collision>
  </link>
</robot>
""",
}
TEST_GATEWAY_EXPORT_TIMESTAMP_SEC = (
    TEST_SOURCE_TS_MS - TEST_STARTED_AT_MS
) / TELEOP_REPLAY_MILLISECONDS_PER_SECOND
TEST_KINEMATIC_EXPORT_TIMESTAMP_SEC = TEST_GATEWAY_EXPORT_TIMESTAMP_SEC
TEST_SPY_TIMING_MODE = "spy"


class SpyTeleopReplayClock:
    timing_mode = TEST_SPY_TIMING_MODE

    def __init__(self) -> None:
        self.waited_until_ms: list[float] = []

    def wait_until_ms(self, scheduled_time_ms: float) -> float:
        self.waited_until_ms.append(scheduled_time_ms)
        return TELEOP_REPLAY_ZERO_MILLISECONDS


def _state(
    position_rad: float,
    *,
    joint_name: str = TEST_JOINT_NAME,
) -> dict[str, object]:
    return {
        "robotId": TEST_ROBOT_ID,
        "adapterId": TEST_ADAPTER_ID,
        "profileId": TEST_PROFILE_ID,
        "sequence": TEST_STATE_SEQUENCE,
        "sourceTsMs": TEST_SOURCE_TS_MS,
        "mode": "manual",
        "estop": False,
        "heartbeatOk": True,
        "jointPositionsRad": {joint_name: position_rad},
        "gripperPositionsRad": {},
    }


def _recording_payload(
    *,
    post_position_rad: float = TEST_EXPECTED_POSITION_RAD,
    command_joint_name: str = TEST_JOINT_NAME,
    state_joint_name: str = TEST_JOINT_NAME,
    include_post_state: bool = True,
) -> dict[str, object]:
    post_state = (
        _state(post_position_rad, joint_name=state_joint_name)
        if include_post_state
        else None
    )
    return {
        "schemaVersion": TEST_RECORDING_SCHEMA_VERSION,
        "recordingId": TEST_RECORDING_ID,
        "taskLanguage": TEST_TASK_LANGUAGE,
        "startedAtMs": TEST_STARTED_AT_MS,
        "endedAtMs": TEST_ENDED_AT_MS,
        "durationMs": TEST_ENDED_AT_MS - TEST_STARTED_AT_MS,
        "sampleCount": 1,
        "droppedSampleCount": 0,
        "samples": [
            {
                "schemaVersion": TEST_SAMPLE_SCHEMA_VERSION,
                "sampleIndex": TEST_SAMPLE_INDEX,
                "command": {
                    "kind": "joint_jog",
                    "jointJog": {
                        "joint_name": command_joint_name,
                        "delta_rad": TEST_DELTA_RAD,
                    },
                },
                "metadata": {
                    "command_kind": "joint_jog",
                    "sequence": TEST_COMMAND_SEQUENCE,
                    "source_ts_ms": TEST_SOURCE_TS_MS,
                },
                "recordedAtMs": TEST_RECORDED_AT_MS,
                "context": {
                    "profileId": TEST_PROFILE_ID,
                    "robotId": TEST_ROBOT_ID,
                },
                "stateCaptureStatus": (
                    "captured" if include_post_state else "state_unavailable"
                ),
                "preCommandState": _state(
                    TEST_INITIAL_POSITION_RAD,
                    joint_name=state_joint_name,
                ),
                "postCommandState": post_state,
            }
        ],
    }


def _recording(**kwargs: object) -> TeleopReplayRecording:
    return TeleopReplayRecording.model_validate(_recording_payload(**kwargs))


def _mjlab_export_gate(recording_id: str = TEST_RECORDING_ID):
    return build_teleop_replay_mjlab_export_gate(
        recording_id=recording_id,
        success=True,
        self_collision_checked=True,
    )


def _twist_recording_payload() -> dict[str, object]:
    payload = _recording_payload(post_position_rad=TEST_INITIAL_POSITION_RAD)
    sample = payload["samples"][0]
    assert isinstance(sample, dict)
    sample["command"] = {
        "kind": TELEOP_REPLAY_COMMAND_KIND_TWIST,
        "twist": {
            "x": TEST_TWIST_X_MPS,
            "y": TEST_TWIST_Y_MPS,
            "omega": TEST_TWIST_OMEGA_RPS,
        },
    }
    metadata = sample["metadata"]
    assert isinstance(metadata, dict)
    metadata["command_kind"] = TELEOP_REPLAY_COMMAND_KIND_TWIST
    return payload


def _kinematic_recording_payload() -> dict[str, object]:
    return {
        "schemaVersion": TEST_RECORDING_SCHEMA_VERSION,
        "recordingId": TEST_RECORDING_ID,
        "taskLanguage": TEST_TASK_LANGUAGE,
        "startedAtMs": TEST_STARTED_AT_MS,
        "endedAtMs": TEST_ENDED_AT_MS,
        "durationMs": TEST_ENDED_AT_MS - TEST_STARTED_AT_MS,
        "sampleCount": 1,
        "droppedSampleCount": 0,
        "samples": [
            {
                "schemaVersion": TEST_SAMPLE_SCHEMA_VERSION,
                "sampleIndex": TEST_SAMPLE_INDEX,
                "command": {
                    "kind": "joint_targets",
                    "jointTargets": {
                        TEST_JOINT_NAME: TEST_KINEMATIC_TARGET_RAD,
                    },
                },
                "metadata": {
                    "command_kind": "joint_targets",
                    "sequence": TEST_COMMAND_SEQUENCE,
                    "source_ts_ms": TEST_SOURCE_TS_MS,
                },
                "recordedAtMs": TEST_RECORDED_AT_MS,
                "context": {
                    "robotId": TEST_ROBOT_ID,
                    "teleoperationMode": (
                        TELEOP_REPLAY_CONTEXT_TELEOPERATION_MODE_STUDIO_KINEMATIC
                    ),
                    "inputSource": TELEOP_REPLAY_CONTEXT_INPUT_SOURCE_IK_DRAG,
                    "physicsSource": TELEOP_REPLAY_CONTEXT_PHYSICS_SOURCE_NONE,
                    "replayGuarantee": TELEOP_REPLAY_CONTEXT_REPLAY_GUARANTEE_KINEMATIC,
                },
                "stateCaptureStatus": "state_unavailable",
                "preCommandState": None,
                "postCommandState": None,
            }
        ],
    }


def _two_sample_kinematic_recording_payload(
    *,
    second_target_rad: float = TEST_SECOND_KINEMATIC_TARGET_RAD,
) -> dict[str, object]:
    payload = _kinematic_recording_payload()
    second_sample = deepcopy(payload["samples"][0])
    second_sample["sampleIndex"] = TEST_SECOND_SAMPLE_INDEX
    second_sample["recordedAtMs"] = TEST_ENDED_AT_MS
    second_sample["metadata"]["sequence"] = TEST_SECOND_COMMAND_SEQUENCE
    second_sample["metadata"]["source_ts_ms"] = TEST_SECOND_SOURCE_TS_MS
    second_sample["command"]["jointTargets"] = {
        TEST_JOINT_NAME: second_target_rad,
    }
    payload["samples"].append(second_sample)
    payload["sampleCount"] = len(payload["samples"])
    return payload


def _kinematic_recording() -> TeleopReplayRecording:
    return TeleopReplayRecording.model_validate(_kinematic_recording_payload())


def test_validate_teleop_replay_reproduces_recorded_joint_state() -> None:
    result = validate_teleop_replay(_recording())

    assert result.success is True
    assert result.replayed_sample_count == 1
    assert result.max_joint_error_rad == TELEOP_REPLAY_ZERO_JOINT_ERROR_RAD
    assert result.sample_results[0].accepted is True
    assert result.timing_mode == TELEOP_REPLAY_TIMING_MODE_LOGICAL
    assert (
        result.sample_results[0].scheduled_time_ms
        == TEST_SOURCE_TS_MS - TEST_STARTED_AT_MS
    )


def test_validate_teleop_replay_preserves_recorded_command_schedule() -> None:
    payload = _recording_payload()
    second_sample = deepcopy(payload["samples"][0])
    second_sample["sampleIndex"] = TEST_SECOND_SAMPLE_INDEX
    second_sample["command"]["jointJog"]["delta_rad"] = TEST_SECOND_DELTA_RAD
    second_sample["metadata"]["sequence"] = TEST_SECOND_COMMAND_SEQUENCE
    second_sample["metadata"]["source_ts_ms"] = TEST_SECOND_SOURCE_TS_MS
    second_sample["recordedAtMs"] = TEST_ENDED_AT_MS
    second_sample["preCommandState"] = _state(TEST_EXPECTED_POSITION_RAD)
    second_sample["postCommandState"] = _state(TEST_SECOND_EXPECTED_POSITION_RAD)
    payload["samples"].append(second_sample)
    payload["sampleCount"] = len(payload["samples"])

    result = validate_teleop_replay(TeleopReplayRecording.model_validate(payload))

    assert result.success is True
    assert result.scheduled_duration_ms == TEST_SECOND_SOURCE_TS_MS - TEST_STARTED_AT_MS
    assert result.scheduled_sleep_ms == TEST_SECOND_SOURCE_TS_MS - TEST_STARTED_AT_MS
    assert result.max_scheduled_delay_ms == TEST_SOURCE_TS_MS - TEST_STARTED_AT_MS
    assert result.sample_results[0].scheduled_delay_ms == (
        TEST_SOURCE_TS_MS - TEST_STARTED_AT_MS
    )
    assert result.sample_results[1].scheduled_delay_ms == (
        TEST_SECOND_SOURCE_TS_MS - TEST_SOURCE_TS_MS
    )


def test_validate_teleop_replay_waits_until_absolute_schedule_times() -> None:
    payload = _recording_payload()
    second_sample = deepcopy(payload["samples"][0])
    second_sample["sampleIndex"] = TEST_SECOND_SAMPLE_INDEX
    second_sample["command"]["jointJog"]["delta_rad"] = TEST_SECOND_DELTA_RAD
    second_sample["metadata"]["sequence"] = TEST_SECOND_COMMAND_SEQUENCE
    second_sample["metadata"]["source_ts_ms"] = TEST_SECOND_SOURCE_TS_MS
    second_sample["recordedAtMs"] = TEST_ENDED_AT_MS
    second_sample["preCommandState"] = _state(TEST_EXPECTED_POSITION_RAD)
    second_sample["postCommandState"] = _state(TEST_SECOND_EXPECTED_POSITION_RAD)
    payload["samples"].append(second_sample)
    payload["sampleCount"] = len(payload["samples"])
    spy_clock = SpyTeleopReplayClock()

    result = validate_teleop_replay(
        TeleopReplayRecording.model_validate(payload),
        replay_clock=spy_clock,
    )

    assert result.success is True
    assert result.timing_mode == spy_clock.timing_mode
    assert spy_clock.waited_until_ms == [
        TEST_SOURCE_TS_MS - TEST_STARTED_AT_MS,
        TEST_SECOND_SOURCE_TS_MS - TEST_STARTED_AT_MS,
    ]


def test_validate_teleop_replay_falls_back_to_recorded_time_for_bad_source_ts() -> None:
    payload = _recording_payload()
    sample = payload["samples"][0]
    assert isinstance(sample, dict)
    metadata = sample["metadata"]
    assert isinstance(metadata, dict)
    metadata["source_ts_ms"] = TEST_OUT_OF_EPISODE_SOURCE_TS_MS

    result = validate_teleop_replay(TeleopReplayRecording.model_validate(payload))

    assert result.success is True
    assert (
        result.sample_results[0].scheduled_time_ms
        == TEST_RECORDED_AT_MS - TEST_STARTED_AT_MS
    )


def test_validate_teleop_replay_fails_when_expected_post_state_diverges() -> None:
    result = validate_teleop_replay(
        _recording(post_position_rad=TEST_DIVERGED_POSITION_RAD),
        joint_tolerance_rad=TELEOP_REPLAY_DEFAULT_JOINT_TOLERANCE_RAD,
    )

    assert result.success is False
    assert result.max_joint_error_rad > TELEOP_REPLAY_DEFAULT_JOINT_TOLERANCE_RAD
    assert result.sample_results[0].reason == "post-command joint state diverged"


def test_validate_teleop_replay_fails_unknown_controlled_joint() -> None:
    result = validate_teleop_replay(
        _recording(
            command_joint_name=TEST_UNKNOWN_JOINT_NAME,
            state_joint_name=TEST_JOINT_NAME,
            post_position_rad=TEST_INITIAL_POSITION_RAD,
        )
    )

    assert result.success is False
    assert result.sample_results[0].reason == "command rejected by replay runtime"


def test_teleop_replay_api_rejects_unsupported_gateway_command_kind() -> None:
    req = TeleopReplayValidateRequest.model_validate(
        {"recording": _twist_recording_payload()}
    )

    with pytest.raises(HTTPException) as exc_info:
        validate_teleop_replay_recording(req)

    assert exc_info.value.status_code == 422
    assert "only supports gateway command kinds" in str(exc_info.value.detail)


def test_teleop_replay_api_rejects_missing_post_state() -> None:
    req = TeleopReplayValidateRequest.model_validate(
        {"recording": _recording_payload(include_post_state=False)}
    )

    with pytest.raises(HTTPException) as exc_info:
        validate_teleop_replay_recording(req)

    assert exc_info.value.status_code == 422
    assert "post-command gateway state" in str(exc_info.value.detail)


def test_export_teleop_replay_writes_minimal_lerobot_dataset(tmp_path) -> None:
    result = export_teleop_replay_lerobot(
        _recording(),
        mjlab_export_gate=_mjlab_export_gate(),
        output_dir=tmp_path,
    )

    assert result.success is True
    assert result.dataset_path == str(tmp_path)
    expected_paths = [
        tmp_path / "meta" / TELEOP_REPLAY_INFO_FILENAME,
        tmp_path / "meta" / TELEOP_REPLAY_STATS_FILENAME,
        tmp_path / "meta" / TELEOP_REPLAY_META_FILENAME,
        tmp_path / "meta" / TELEOP_REPLAY_TASKS_FILENAME,
        tmp_path
        / "meta"
        / "episodes"
        / TELEOP_REPLAY_PARQUET_CHUNK_NAME
        / TELEOP_REPLAY_PARQUET_FILE_NAME,
        tmp_path
        / "data"
        / TELEOP_REPLAY_PARQUET_CHUNK_NAME
        / TELEOP_REPLAY_PARQUET_FILE_NAME,
    ]
    for path in expected_paths:
        assert path.exists()

    info = json.loads((tmp_path / "meta" / TELEOP_REPLAY_INFO_FILENAME).read_text())
    assert info["features"]["action"]["names"] == [f"{TEST_JOINT_NAME}.pos"]
    assert info["fps"] == TELEOP_REPLAY_DEFAULT_FPS
    assert info["fps_is_nominal"] == TELEOP_REPLAY_FPS_IS_NOMINAL
    assert info["fps_semantics"] == TELEOP_REPLAY_FPS_SEMANTICS_NOMINAL_IRREGULAR
    assert info["timestamp_semantics"] == TELEOP_REPLAY_TIMESTAMP_SEMANTICS_COMMAND_SOURCE
    replay_meta = json.loads(
        (tmp_path / "meta" / TELEOP_REPLAY_META_FILENAME).read_text()
    )
    assert replay_meta["export_mode"] == TELEOP_REPLAY_EXPORT_MODE_GATEWAY_REPLAY
    assert (
        replay_meta["action_semantics"]
        == TELEOP_REPLAY_ACTION_SEMANTICS_GATEWAY_DELTA
    )
    assert (
        replay_meta["observation_semantics"]
        == TELEOP_REPLAY_OBSERVATION_SEMANTICS_GATEWAY_STATE
    )
    assert (
        replay_meta["timestamp_semantics"]
        == TELEOP_REPLAY_TIMESTAMP_SEMANTICS_COMMAND_SOURCE
    )
    assert (
        replay_meta["fps_semantics"]
        == TELEOP_REPLAY_FPS_SEMANTICS_NOMINAL_IRREGULAR
    )
    data_table = pq.read_table(
        tmp_path
        / "data"
        / TELEOP_REPLAY_PARQUET_CHUNK_NAME
        / TELEOP_REPLAY_PARQUET_FILE_NAME
    )
    data_row = data_table.to_pylist()[0]
    assert data_row["action"] == [TEST_DELTA_RAD]
    assert data_row["observation.state"] == [TEST_EXPECTED_POSITION_RAD]
    assert data_row["timestamp"] == TEST_GATEWAY_EXPORT_TIMESTAMP_SEC


def test_export_teleop_replay_service_requires_mjlab_gate(tmp_path) -> None:
    with pytest.raises(ValueError) as exc_info:
        export_teleop_replay_lerobot(_recording(), output_dir=tmp_path)

    assert TELEOP_REPLAY_MJLAB_EXPORT_GATE_REQUIRED in str(exc_info.value)


def test_export_teleop_kinematic_writes_joint_target_lerobot_dataset(tmp_path) -> None:
    result = export_teleop_kinematic_lerobot(
        _kinematic_recording(),
        mjlab_export_gate=_mjlab_export_gate(),
        output_dir=tmp_path,
    )

    assert result.success is True
    assert result.replayed_sample_count == 0
    assert result.dataset_path == str(tmp_path)

    replay_meta = json.loads(
        (tmp_path / "meta" / TELEOP_REPLAY_META_FILENAME).read_text()
    )
    assert replay_meta["export_mode"] == TELEOP_REPLAY_EXPORT_MODE_STUDIO_KINEMATIC
    assert (
        replay_meta["action_semantics"]
        == TELEOP_REPLAY_ACTION_SEMANTICS_KINEMATIC_ABSOLUTE
    )
    assert (
        replay_meta["observation_semantics"]
        == TELEOP_REPLAY_OBSERVATION_SEMANTICS_KINEMATIC_PROXY
    )
    assert (
        replay_meta["timestamp_semantics"]
        == TELEOP_REPLAY_TIMESTAMP_SEMANTICS_COMMAND_SOURCE
    )
    assert replay_meta["provenance"]["physics_sources"] == [
        TELEOP_REPLAY_CONTEXT_PHYSICS_SOURCE_NONE
    ]
    assert replay_meta["provenance"]["replay_guarantees"] == [
        TELEOP_REPLAY_CONTEXT_REPLAY_GUARANTEE_KINEMATIC
    ]

    data_table = pq.read_table(
        tmp_path
        / "data"
        / TELEOP_REPLAY_PARQUET_CHUNK_NAME
        / TELEOP_REPLAY_PARQUET_FILE_NAME
    )
    data_row = data_table.to_pylist()[0]
    assert data_row["action"] == [TEST_KINEMATIC_TARGET_RAD]
    assert data_row["observation.state"] == [TEST_KINEMATIC_TARGET_RAD]
    assert data_row["timestamp"] == TEST_KINEMATIC_EXPORT_TIMESTAMP_SEC


def test_export_teleop_kinematic_backfills_first_known_partial_targets(
    tmp_path,
) -> None:
    payload = _kinematic_recording_payload()
    second_sample = deepcopy(payload["samples"][0])
    second_sample["sampleIndex"] = TEST_SAMPLE_INDEX + 1
    second_sample["recordedAtMs"] = TEST_ENDED_AT_MS
    second_sample["metadata"]["sequence"] = TEST_COMMAND_SEQUENCE + 1
    second_sample["metadata"]["source_ts_ms"] = TEST_ENDED_AT_MS
    second_sample["command"]["jointTargets"] = {
        TEST_SECOND_JOINT_NAME: TEST_SECOND_KINEMATIC_TARGET_RAD,
    }
    payload["samples"].append(second_sample)
    payload["sampleCount"] = len(payload["samples"])

    result = export_teleop_kinematic_lerobot(
        TeleopReplayRecording.model_validate(payload),
        mjlab_export_gate=_mjlab_export_gate(),
        output_dir=tmp_path,
    )

    assert result.success is True

    data_table = pq.read_table(
        tmp_path
        / "data"
        / TELEOP_REPLAY_PARQUET_CHUNK_NAME
        / TELEOP_REPLAY_PARQUET_FILE_NAME
    )
    first_row, second_row = data_table.to_pylist()
    assert first_row["action"] == [
        TEST_KINEMATIC_TARGET_RAD,
        TEST_SECOND_KINEMATIC_TARGET_RAD,
    ]
    assert second_row["action"] == [
        TEST_KINEMATIC_TARGET_RAD,
        TEST_SECOND_KINEMATIC_TARGET_RAD,
    ]


def test_teleop_kinematic_export_api_rejects_non_kinematic_provenance() -> None:
    payload = _two_sample_kinematic_recording_payload()
    sample = payload["samples"][0]
    assert isinstance(sample, dict)
    context = sample["context"]
    assert isinstance(context, dict)
    context["physicsSource"] = TELEOP_REPLAY_CONTEXT_PHYSICS_SOURCE_GATEWAY_PROXY
    req = TeleopReplayExportRequest.model_validate(
        {"recording": payload, "robotModel": TEST_MJLAB_ROBOT_MODEL}
    )

    with pytest.raises(HTTPException) as exc_info:
        export_teleop_kinematic_recording_to_lerobot(req)

    assert exc_info.value.status_code == 422
    assert "studio_kinematic/none/kinematic provenance" in str(exc_info.value.detail)


def test_teleop_kinematic_export_api_returns_mjlab_gate_result() -> None:
    result = export_teleop_kinematic_recording_to_lerobot(
        TeleopReplayExportRequest.model_validate(
            {
                "recording": _two_sample_kinematic_recording_payload(),
                "robotModel": TEST_MJLAB_ROBOT_MODEL,
            }
        )
    )

    assert result.success is True
    assert result.mjlab_validation is not None
    assert result.mjlab_validation["success"] is True
    assert result.mjlab_validation["recordingId"] == TEST_RECORDING_ID


def test_teleop_kinematic_export_api_rejects_mjlab_motion_failures() -> None:
    req = TeleopReplayExportRequest.model_validate(
        {
            "recording": _two_sample_kinematic_recording_payload(
                second_target_rad=TEST_MJLAB_REJECTED_TARGET_RAD,
            ),
            "robotModel": TEST_MJLAB_ROBOT_MODEL,
        }
    )

    with pytest.raises(HTTPException) as exc_info:
        export_teleop_kinematic_recording_to_lerobot(req)

    assert exc_info.value.status_code == 422
    assert TELEOP_REPLAY_MJLAB_EXPORT_REJECTION_PREFIX in str(exc_info.value.detail)


def test_teleop_kinematic_export_api_rejects_missing_self_collision_check() -> None:
    req = TeleopReplayExportRequest.model_validate(
        {"recording": _two_sample_kinematic_recording_payload()}
    )

    with pytest.raises(HTTPException) as exc_info:
        export_teleop_kinematic_recording_to_lerobot(req)

    assert exc_info.value.status_code == 422
    assert TELEOP_REPLAY_MJLAB_EXPORT_SELF_COLLISION_UNCHECKED in str(
        exc_info.value.detail
    )


def test_teleop_replay_export_api_rejects_output_dir_outside_replay_root() -> None:
    req = TeleopReplayExportRequest.model_validate(
        {
            "recording": _recording_payload(),
            "outputDir": "/etc/urdf-studio-teleop-replay-test",
        }
    )

    with pytest.raises(HTTPException) as exc_info:
        export_teleop_replay_recording_to_lerobot(req)

    assert exc_info.value.status_code == 422
    assert str(TELEOP_REPLAY_OUTPUT_ROOT) in str(exc_info.value.detail)
