from __future__ import annotations

from backend.models.physical_state import ActionToken, PhysicalEntity, PhysicalStateFrame
from backend.services.physical_rollout_baseline import rollout_action


def _frame() -> PhysicalStateFrame:
    return PhysicalStateFrame(
        frame_id="baseline:0",
        t_ms=0,
        entities=[
            PhysicalEntity(
                entity_id="robot-1",
                entity_type="robot",
                geometry_type="box",
                position_xyz=[1.0, 2.0, 3.0],
                size_xyz=[0.2, 0.2, 0.2],
                velocity_xyz=[0.1, 0.0, 0.0],
            )
        ],
    )


def test_rollout_action_keeps_noop_actions_stationary() -> None:
    trace = rollout_action(
        _frame(),
        ActionToken(action_id="wait", action_type="wait"),
        step_count=2,
        step_ms=50,
    )

    assert [frame.t_ms for frame in trace.frames] == [0, 50, 100]
    assert [frame.entities[0].position_xyz for frame in trace.frames] == [
        [1.0, 2.0, 3.0],
        [1.0, 2.0, 3.0],
        [1.0, 2.0, 3.0],
    ]
