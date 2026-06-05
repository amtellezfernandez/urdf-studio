from __future__ import annotations

from backend.models.physical_state import ActionToken, PhysicalEntity, PhysicalStateFrame
from backend.services.executability_audit import audit_physical_rollout_trace, audit_physical_state_frame
from backend.services.physical_rollout_baseline import rollout_action


def _frame_with_boxes(*, overlap: bool) -> PhysicalStateFrame:
    return PhysicalStateFrame(
        frame_id="audit-smoke",
        t_ms=0,
        frame_convention="studio-y-up",
        entities=[
            PhysicalEntity(
                entity_id="box-a",
                entity_type="object",
                geometry_type="box",
                position_xyz=[0.0, 0.0, 0.0],
                size_xyz=[0.4, 0.4, 0.4],
            ),
            PhysicalEntity(
                entity_id="box-b",
                entity_type="object",
                geometry_type="box",
                position_xyz=[0.1 if overlap else 1.0, 0.0, 0.0],
                size_xyz=[0.4, 0.4, 0.4],
            ),
        ],
    )


def test_audit_rejects_unexplained_collision_overlap() -> None:
    report = audit_physical_state_frame(_frame_with_boxes(overlap=True))

    assert report.success is False
    assert report.decision == "reject"
    assert report.reject_count >= 1
    assert report.correction_branches


def test_audit_allows_clear_static_frame() -> None:
    report = audit_physical_state_frame(_frame_with_boxes(overlap=False))

    assert report.success is True
    assert report.decision == "allow"
    assert report.reject_count == 0


def test_rollout_audit_rejects_missing_action_reference() -> None:
    frame = _frame_with_boxes(overlap=False)
    action = ActionToken(
        action_id="bad-push",
        action_type="push",
        actor_id="missing-robot",
        object_id="box-b",
        params={"delta_xyz": [0.1, 0.0, 0.0]},
    )
    trace = rollout_action(frame, action)

    report = audit_physical_rollout_trace(trace)

    assert report.success is False
    assert report.decision == "reject"
    assert any("missing-robot" in (check.subject_ref or "") for check in report.checks)
