from __future__ import annotations

import pytest

from backend.models.physical_state import ActionToken
from backend.services.physical_rollout_baseline import rollout_action
from backend.services.physical_state_compiler import compile_physical_state_payload


def _static_layout_payload() -> dict:
    return {
        "world_layout": {
            "name": "hkhack-physical-state-smoke",
            "objects": [
                {
                    "id": "robot-proxy",
                    "name": "Robot proxy",
                    "type": "cube",
                    "position_xyz": [0.0, 0.0, 0.1],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.2, 0.2, 0.2],
                    "color": "#3b82f6",
                },
                {
                    "id": "pallet-7",
                    "name": "Pallet 7",
                    "type": "cube",
                    "position_xyz": [1.0, 0.0, 0.1],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.3, 0.3, 0.2],
                    "color": "#ef4444",
                },
            ],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        }
    }


def test_compile_static_layout_to_physical_state_tokens() -> None:
    compiled = compile_physical_state_payload(_static_layout_payload())

    assert compiled.frame.frame_id == "hkhack-physical-state-smoke:0"
    assert [entity.entity_id for entity in compiled.frame.entities] == ["robot-proxy", "pallet-7"]
    assert compiled.tokens.text_tokens[0] == "<TIME_000000>"
    assert compiled.tokens.entity_type_ids == [2, 2]
    assert compiled.tokens.metadata["entity_count"] == 2
    assert compiled.tokens.constraint_mask["collision"] is False


def test_rollout_push_action_moves_target_object_deterministically() -> None:
    compiled = compile_physical_state_payload(_static_layout_payload())
    action = ActionToken(
        action_id="push-pallet",
        action_type="push",
        actor_id="robot-proxy",
        object_id="pallet-7",
        params={"delta_xyz": [0.3, 0.0, 0.0]},
    )

    trace = rollout_action(compiled.frame, action, step_count=3, step_ms=50)
    final_pallet = next(entity for entity in trace.frames[-1].entities if entity.entity_id == "pallet-7")
    final_robot = next(entity for entity in trace.frames[-1].entities if entity.entity_id == "robot-proxy")

    assert trace.frames[-1].t_ms == 150
    assert final_pallet.position_xyz == pytest.approx([1.3, 0.0, 0.1])
    assert final_robot.position_xyz == pytest.approx([0.075, 0.0, 0.1])
