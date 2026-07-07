"""Physics-stepping replay oracle for WSP transitions (formerly a NotImplementedError stub)."""

from __future__ import annotations

import pytest

pytest.importorskip("mujoco")

from backend.models.physical_state import (
    ActionToken,
    PhysicalEntity,
    PhysicalStateFrame,
    PhysicalTokenSequence,
    WorldModelTrainingSample,
)
from backend.services.wsp_replay_label import replay_label_samples_with_stepping


def _frame(frame_id: str, t_ms: int, *, box_position: list[float]) -> PhysicalStateFrame:
    return PhysicalStateFrame(
        frame_id=frame_id,
        t_ms=t_ms,
        frame_convention="ros-rep-103",
        entities=[
            PhysicalEntity(
                entity_id="box_1",
                entity_type="object",
                geometry_type="box",
                position_xyz=box_position,
                size_xyz=[0.1, 0.1, 0.1],
                mass_kg=0.5,
                movable=True,
            ),
            PhysicalEntity(
                entity_id="table_1",
                entity_type="object",
                geometry_type="box",
                position_xyz=[0.0, 0.0, 0.35],
                size_xyz=[1.0, 1.0, 0.7],
                movable=False,
            ),
        ],
    )


def _tokens(frame: PhysicalStateFrame) -> PhysicalTokenSequence:
    return PhysicalTokenSequence(
        frame_id=frame.frame_id,
        metadata={"frame_snapshot": frame.model_dump()},
    )


def _sample(*, next_box_position: list[float], executable: bool) -> WorldModelTrainingSample:
    frame_before = _frame("f0", 0, box_position=[0.0, 0.0, 0.75])
    frame_after = _frame("f1", 100, box_position=next_box_position)
    return WorldModelTrainingSample(
        sample_id=f"stepping-{'valid' if executable else 'invalid'}",
        trace_id="stepping-trace",
        step_index=0,
        state_frame_id=frame_before.frame_id,
        next_state_frame_id=frame_after.frame_id,
        action=ActionToken(action_id="a0", action_type="noop"),
        state_tokens=_tokens(frame_before),
        next_state_tokens=_tokens(frame_after),
        executable=executable,
        executability_decision="allow" if executable else "reject",
        executability_score=1.0 if executable else 0.0,
        violation_count=0 if executable else 1,
    )


def test_physically_consistent_transition_passes() -> None:
    # Box resting on the table stays put over 100 ms.
    sample = _sample(next_box_position=[0.0, 0.0, 0.75], executable=True)

    labeled = replay_label_samples_with_stepping([sample])[0]

    assert labeled.metadata["sim_replay_label"] == "pass"
    replay = labeled.metadata["sim_replay"]
    assert replay["mode"] == "stepping"
    assert replay["audit_replay_agree"] is True
    assert replay["targets"]["mujoco"]["entities_compared"] == 1
    assert replay["targets"]["mujoco"]["max_position_error_m"] < 0.05


def test_teleport_transition_fails() -> None:
    # Claimed next state teleports the box a meter sideways in 100 ms.
    sample = _sample(next_box_position=[1.0, 0.0, 0.75], executable=False)

    labeled = replay_label_samples_with_stepping([sample])[0]

    assert labeled.metadata["sim_replay_label"] == "fail"
    assert labeled.metadata["sim_replay"]["audit_replay_agree"] is True
    assert labeled.metadata["sim_replay"]["targets"]["mujoco"]["max_position_error_m"] > 0.5


def test_sample_without_snapshots_fails_gracefully() -> None:
    sample = _sample(next_box_position=[0.0, 0.0, 0.75], executable=True)
    sample = sample.model_copy(
        deep=True,
        update={
            "state_tokens": sample.state_tokens.model_copy(update={"metadata": {}}),
        },
    )

    labeled = replay_label_samples_with_stepping([sample])[0]

    assert labeled.metadata["sim_replay_label"] == "fail"
    assert "error" in labeled.metadata["sim_replay"]["targets"]["mujoco"]
