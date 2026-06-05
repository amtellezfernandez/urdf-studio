from __future__ import annotations

import pytest

from backend.models.physical_state import ActionToken
from backend.services.physical_rollout_baseline import rollout_action
from backend.services.physical_state_compiler import compile_physical_state_payload
from backend.services.physical_state_tokens import build_physical_token_sequence, decode_physical_token_sequence


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
                    "collision": False,
                },
            ],
            "scenario_time_ms": 0,
            "scenario_duration_ms": 0,
        }
    }


def test_compile_static_layout_to_physical_state_tokens() -> None:
    compiled = compile_physical_state_payload(_static_layout_payload())
    compiled_again = compile_physical_state_payload(_static_layout_payload())

    assert compiled.frame.frame_id == "hkhack-physical-state-smoke:0"
    assert [entity.entity_id for entity in compiled.frame.entities] == ["robot-proxy", "pallet-7"]
    assert compiled.tokens.text_tokens[0] == "<TIME_000000>"
    assert compiled.tokens.text_tokens == compiled_again.tokens.text_tokens
    assert compiled.tokens.entity_type_ids == [2, 2]
    assert compiled.tokens.entity_ids == ["robot-proxy", "pallet-7"]
    assert compiled.tokens.metadata["entity_count"] == 2
    assert compiled.tokens.constraint_mask["collision"] is False
    assert compiled.frame.entities[1].metadata["collision"] is False
    assert [entity.entity_id for entity in decode_physical_token_sequence(compiled.tokens).entities] == [
        "robot-proxy",
        "pallet-7",
    ]


def test_action_tokenization_emits_human_and_tensor_ready_views() -> None:
    compiled = compile_physical_state_payload(_static_layout_payload())
    action = ActionToken(
        action_id="push-pallet",
        action_type="push",
        actor_id="robot-proxy",
        object_id="pallet-7",
        destination_id="dock-d2",
        params={"max_force_n": 120},
    )

    tokens = build_physical_token_sequence(compiled.frame, action)

    assert tokens.action_ids == [3]
    assert tokens.metadata["action_snapshot"]["action_type"] == "push"
    assert tokens.text_tokens[-1] == (
        "<ACTION id=push-pallet type=push actor=robot-proxy object=pallet-7 target= destination=dock-d2>"
    )


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


def test_rollout_reserve_dock_changes_dock_status_without_moving_objects() -> None:
    compiled = compile_physical_state_payload(
        {
            "world_layout": {
                "name": "dock-smoke",
                "objects": [
                    {
                        "id": "robot-1",
                        "name": "Robot 1",
                        "type": "cube",
                        "entity_type": "robot",
                        "position_xyz": [0.0, 0.0, 0.1],
                        "rotation_rpy_rad": [0.0, 0.0, 0.0],
                        "size_xyz": [0.2, 0.2, 0.2],
                    },
                    {
                        "id": "dock-d2",
                        "name": "Dock D2",
                        "type": "cube",
                        "entity_type": "dock",
                        "position_xyz": [1.0, 0.0, 0.1],
                        "rotation_rpy_rad": [0.0, 0.0, 0.0],
                        "size_xyz": [0.4, 0.4, 0.2],
                    },
                ],
                "scenario_time_ms": 0,
                "scenario_duration_ms": 0,
            }
        }
    )
    action = ActionToken(
        action_id="reserve-dock",
        action_type="reserve_dock",
        actor_id="robot-1",
        destination_id="dock-d2",
    )

    trace = rollout_action(compiled.frame, action, step_count=1)
    dock = next(entity for entity in trace.frames[-1].entities if entity.entity_id == "dock-d2")

    assert dock.position_xyz == pytest.approx([1.0, 0.0, 0.1])
    assert dock.metadata["dock_status"] == "reserved"
    assert dock.metadata["reserved_by"] == "robot-1"
