from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.services.robot_reality_log import (
    compile_robot_reality_log_file,
    compile_robot_reality_log_payload,
)


def _sample_payload() -> dict[str, object]:
    return {
        "trace_id": "reality-1",
        "source": "robot.log",
        "frames": [
            {
                "t_ms": 0,
                "entities": [
                    {
                        "id": "robot-1",
                        "type": "robot",
                        "geometry": "box",
                        "position_xyz": [0.0, 0.1, 0.2],
                        "quat_wxyz": [1.0, 0.0, 0.0, 0.0],
                        "size_xyz": [0.3, 0.2, 0.1],
                        "velocity_xyz": [0.0, 0.0, 0.0],
                        "confidence": 0.8,
                    }
                ],
                "action": {
                    "id": "action-1",
                    "type": "navigate",
                    "actor": "robot-1",
                    "confidence": 0.4,
                },
            },
            {
                "t_ms": 100,
                "entities": [
                    {
                        "entity_id": "robot-1",
                        "entity_type": "robot",
                        "geometry_type": "box",
                        "position": [0.1, 0.1, 0.2],
                        "confidence": 1.2,
                    }
                ],
            },
        ],
    }


def test_compile_robot_reality_log_payload_normalizes_entities_and_actions() -> None:
    trace = compile_robot_reality_log_payload(_sample_payload())

    assert trace.trace_id == "reality-1"
    assert len(trace.frames) == 2
    assert len(trace.actions) == 1
    assert trace.frames[0].entities[0].entity_id == "robot-1"
    assert trace.frames[0].entities[0].confidence == 0.8
    assert trace.frames[1].entities[0].confidence == 1.0
    assert trace.actions[0].action_type == "navigate"
    assert trace.actions[0].confidence == 0.4


def test_compile_robot_reality_log_file_accepts_jsonl_frames(tmp_path: Path) -> None:
    path = tmp_path / "robot-reality.jsonl"
    payload = _sample_payload()
    frames = payload["frames"]
    assert isinstance(frames, list)
    path.write_text(
        "\n".join(json.dumps(frame) for frame in frames),
        encoding="utf-8",
    )

    trace = compile_robot_reality_log_file(path)

    assert trace.trace_id == "robot-reality"
    assert trace.metadata["source_refs"] == [str(path)]
    assert len(trace.frames) == 2


def test_compile_robot_reality_log_file_rejects_empty_input(tmp_path: Path) -> None:
    path = tmp_path / "empty.jsonl"
    path.write_text(" \n", encoding="utf-8")

    with pytest.raises(ValueError, match="Robot reality log is empty"):
        compile_robot_reality_log_file(path)


def test_compile_robot_reality_log_file_rejects_invalid_jsonl_line(tmp_path: Path) -> None:
    path = tmp_path / "robot-reality.jsonl"
    path.write_text('{"t_ms":0,"entities":[]}\n{"t_ms":\n', encoding="utf-8")

    with pytest.raises(ValueError, match=r"Invalid robot reality log JSONL line 2"):
        compile_robot_reality_log_file(path)


def test_compile_robot_reality_log_file_rejects_invalid_encoding(tmp_path: Path) -> None:
    path = tmp_path / "robot-reality.json"
    path.write_bytes(b"\xff\xfe\x00")

    with pytest.raises(ValueError, match=r"Failed to read robot reality log:"):
        compile_robot_reality_log_file(path)
