from __future__ import annotations

import json
import subprocess
import sys

from backend.services.world_model_dataset import validate_world_model_dataset_samples
from backend.services.wsp_trace_adapters import build_trace_adapter_dataset, compile_trace_adapter_payload


def _sim_payload(source: str):
    return {
        "trace_id": f"{source}-push-001",
        "source": source,
        "bodies": [
            {"id": "robot_1", "entity_type": "robot", "size_xyz": [0.2, 0.2, 0.2], "battery": 0.9},
            {"id": "pallet_1", "entity_type": "pallet", "size_xyz": [0.35, 0.35, 0.2], "mass_kg": 30.0, "friction": 0.25},
        ],
        "steps": [
            {
                "t_ms": 0,
                "poses": {"robot_1": [0.0, 0.0, 0.1], "pallet_1": [1.0, 0.0, 0.1]},
                "action": {
                    "id": "push_0",
                    "type": "push",
                    "actor": "robot_1",
                    "object": "pallet_1",
                    "params": {"delta_xyz": [0.1, 0.0, 0.0], "max_force_n": 200},
                },
            },
            {
                "t_ms": 500,
                "poses": {"robot_1": [0.025, 0.0, 0.1], "pallet_1": [1.1, 0.0, 0.1]},
            },
        ],
    }


def test_mujoco_and_genesis_adapters_emit_wsp_samples() -> None:
    for source in ("mujoco", "genesis"):
        trace = compile_trace_adapter_payload(_sim_payload(source), source=source)  # type: ignore[arg-type]
        samples = build_trace_adapter_dataset(trace)
        readiness = validate_world_model_dataset_samples(samples)

        assert trace.trace_id == f"{source}-push-001"
        assert trace.metadata["source_kind"] == source
        assert len(trace.frames) == 2
        assert len(samples) == 1
        assert readiness.ready is True
        assert samples[0].metadata["split"] == f"{source}_trace_adapter"


def test_ros_adapter_accepts_topic_message_exports() -> None:
    payload = {
        "trace_id": "ros-push-001",
        "source": "ros2-mcap-json",
        "messages": [
            {
                "topic": "/wsp/entities",
                "timestamp_ms": 0,
                "payload": {
                    "entities": [
                        {"id": "robot_1", "entity_type": "robot", "position_xyz": [0.0, 0.0, 0.1], "size_xyz": [0.2, 0.2, 0.2]},
                        {"id": "box_1", "entity_type": "object", "position_xyz": [0.8, 0.0, 0.1], "size_xyz": [0.2, 0.2, 0.2]},
                    ]
                },
            },
            {
                "topic": "/wsp/action",
                "timestamp_ms": 0,
                "payload": {"action": {"id": "move_box", "type": "move_object", "object": "box_1", "params": {"delta_xyz": [0.1, 0.0, 0.0]}}},
            },
            {
                "topic": "/tf",
                "timestamp_ms": 500,
                "payload": {
                    "transforms": [
                        {"child_frame_id": "robot_1", "translation": [0.02, 0.0, 0.1]},
                        {"child_frame_id": "box_1", "translation": [0.9, 0.0, 0.1]},
                    ]
                },
            },
        ],
    }

    trace = compile_trace_adapter_payload(payload, source="ros")
    samples = build_trace_adapter_dataset(trace)

    assert trace.metadata["source_kind"] == "ros"
    assert len(trace.frames) == 2
    assert len(samples) == 1
    assert validate_world_model_dataset_samples(samples).ready is True


def test_lerobot_adapter_accepts_episode_frames() -> None:
    payload = {
        "episode_id": "lerobot-pick-001",
        "source": "lerobot",
        "frames": [
            {
                "timestamp_ms": 0,
                "observation": {
                    "state": [0.0, 0.0, 0.1],
                    "objects": [
                        {"id": "cube_1", "entity_type": "object", "position": [0.5, 0.0, 0.1], "size": [0.05, 0.05, 0.05]},
                    ],
                },
                "action": [0.05, 0.0, 0.0],
            },
            {
                "timestamp_ms": 100,
                "observation": {
                    "state": [0.05, 0.0, 0.1],
                    "objects": [
                        {"id": "cube_1", "entity_type": "object", "position": [0.55, 0.0, 0.1], "size": [0.05, 0.05, 0.05]},
                    ],
                },
            },
        ],
    }

    trace = compile_trace_adapter_payload(payload, source="lerobot")
    samples = build_trace_adapter_dataset(trace)

    assert trace.trace_id == "lerobot-pick-001"
    assert trace.metadata["source_kind"] == "lerobot"
    assert len(samples) == 1
    assert samples[0].action.action_type == "translate"


def test_trace_adapter_cli_writes_trace_and_dataset(tmp_path) -> None:
    input_path = tmp_path / "mujoco.json"
    trace_path = tmp_path / "trace.json"
    dataset_path = tmp_path / "samples.jsonl"
    manifest_path = tmp_path / "manifest.json"
    input_path.write_text(json.dumps(_sim_payload("mujoco")), encoding="utf-8")

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "backend.scripts.wsp_ingest_trace_adapter",
            str(input_path),
            "--source",
            "mujoco",
            "--trace-out",
            str(trace_path),
            "--dataset-out",
            str(dataset_path),
            "--manifest-out",
            str(manifest_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
    summary = json.loads(result.stdout)
    assert summary["success"] is True
    assert summary["source_kind"] == "mujoco"
    assert trace_path.exists()
    assert dataset_path.exists()
    assert manifest_path.exists()
