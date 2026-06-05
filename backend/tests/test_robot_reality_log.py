from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.services.robot_reality_log import compile_robot_reality_log_file, compile_robot_reality_log_payload
from backend.services.world_model_dataset import build_world_model_training_samples


FIXTURE_PATH = Path("backend/fixtures/wsp/observed-pallet-push.robot-log.json")


def _robot_log_payload() -> dict:
    return {
        "trace_id": "observed-pallet-push-001",
        "source": "warehouse-cell-log",
        "frame_convention": "studio-y-up",
        "frames": [
            {
                "time_ms": 0,
                "entities": [
                    {
                        "id": "robot_1",
                        "type": "robot",
                        "geometry": "box",
                        "pose": {"x": 0.0, "y": 0.0, "z": 0.1},
                        "size": [0.2, 0.2, 0.2],
                        "battery": 0.82,
                    },
                    {
                        "id": "pallet_7",
                        "type": "pallet",
                        "geometry": "box",
                        "pose": [1.0, 0.0, 0.1],
                        "size": [0.4, 0.4, 0.2],
                        "mass_kg": 120.0,
                        "friction": 0.31,
                    },
                ],
                "action": {
                    "id": "observed_push",
                    "type": "push",
                    "actor": "robot_1",
                    "object": "pallet_7",
                    "params": {"delta_xyz": [0.2, 0.0, 0.0], "max_force_n": 120.0},
                    "duration_ms": 500,
                },
            },
            {
                "time_ms": 500,
                "entities": [
                    {
                        "id": "robot_1",
                        "type": "robot",
                        "geometry": "box",
                        "position_xyz": [0.05, 0.0, 0.1],
                        "size_xyz": [0.2, 0.2, 0.2],
                        "velocity": [0.05, 0.0, 0.0],
                        "battery": 0.80,
                    },
                    {
                        "id": "pallet_7",
                        "type": "pallet",
                        "geometry": "box",
                        "position_xyz": [1.2, 0.0, 0.1],
                        "size_xyz": [0.4, 0.4, 0.2],
                        "velocity": [0.2, 0.0, 0.0],
                        "mass_kg": 120.0,
                        "friction": 0.31,
                    },
                ],
            },
        ],
    }


def test_robot_reality_log_compiles_to_wsp_trace_and_training_sample() -> None:
    trace = compile_robot_reality_log_payload(_robot_log_payload())
    samples = build_world_model_training_samples(trace)

    assert trace.trace_id == "observed-pallet-push-001"
    assert trace.metadata["source_kind"] == "robot_reality_log"
    assert trace.frames[0].t_ms == 0
    assert trace.frames[1].t_ms == 500
    assert trace.actions[0].action_type == "push"
    assert trace.actions[0].actor_id == "robot_1"
    assert trace.frames[1].entities[1].position_xyz == pytest.approx([1.2, 0.0, 0.1])
    assert len(samples) == 1
    assert samples[0].schema_version == "wsp-world-model-sample-v1"
    assert samples[0].task == "action_conditioned_next_state"
    assert samples[0].state_tokens.action_ids == [3]
    assert samples[0].next_state_tokens.entity_ids == ["robot_1", "pallet_7"]


def test_robot_reality_log_accepts_json_string_payload() -> None:
    trace = compile_robot_reality_log_payload(json.dumps(_robot_log_payload()))

    assert trace.frames[0].frame_id == "observed-pallet-push-001:0"
    assert trace.frames[1].frame_id == "observed-pallet-push-001:500"


def test_robot_reality_log_fixture_compiles_to_trainable_samples() -> None:
    trace = compile_robot_reality_log_file(FIXTURE_PATH)
    samples = build_world_model_training_samples(trace)

    assert trace.trace_id == "observed-pallet-push-001"
    assert len(samples) == 1
    assert samples[0].trace_id == "observed-pallet-push-001"
    assert samples[0].state_tokens.metadata["schema_version"] == "wsp-physical-token-sequence-v1"
    assert samples[0].next_state_tokens.metadata["entity_feature_dim"] == 18
