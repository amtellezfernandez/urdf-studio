from __future__ import annotations

from backend.models.physical_state import ActionToken, PhysicalEntity, PhysicalStateFrame
from backend.services.correction_planner import build_repair_plan, rollout_correction_branch
from backend.services.executability_audit import audit_physical_rollout_trace, audit_physical_state_frame
from backend.services.physical_rollout_baseline import rollout_action
from backend.services.simulator_export import export_rollout_trace_to_mujoco_mjcf


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


def _pallet_push_frame() -> PhysicalStateFrame:
    return PhysicalStateFrame(
        frame_id="pallet-push",
        t_ms=0,
        frame_convention="studio-y-up",
        entities=[
            PhysicalEntity(
                entity_id="robot-1",
                entity_type="robot",
                geometry_type="box",
                position_xyz=[0.0, 0.0, 0.1],
                size_xyz=[0.2, 0.2, 0.2],
                battery=0.8,
            ),
            PhysicalEntity(
                entity_id="pallet-7",
                entity_type="pallet",
                geometry_type="box",
                position_xyz=[1.0, 0.0, 0.1],
                size_xyz=[0.4, 0.4, 0.2],
                mass_kg=120.0,
                friction=0.31,
            ),
            PhysicalEntity(
                entity_id="dock-d2",
                entity_type="dock",
                geometry_type="box",
                position_xyz=[2.0, 0.0, 0.1],
                size_xyz=[0.4, 0.4, 0.2],
                movable=False,
                metadata={"dock_status": "free"},
            ),
        ],
    )


def test_contact_stability_failure_generates_repair_plan_and_exportable_branch(tmp_path) -> None:
    action = ActionToken(
        action_id="push-pallet-to-dock",
        action_type="push",
        actor_id="robot-1",
        object_id="pallet-7",
        destination_id="dock-d2",
        duration_ms=1000,
        params={"delta_xyz": [0.5, 0.0, 0.0], "max_force_n": 120.0, "battery_cost": 0.1},
    )
    trace = rollout_action(_pallet_push_frame(), action, step_count=2, step_ms=500)

    report = audit_physical_rollout_trace(trace)
    repair_plan = build_repair_plan(trace, report=report)
    repaired_trace = rollout_correction_branch(
        trace,
        next(branch for branch in repair_plan.branches if branch.branch_id == "stop_and_replan"),
    )
    repaired_report = audit_physical_rollout_trace(repaired_trace)
    original_mjcf, original_export = export_rollout_trace_to_mujoco_mjcf(trace, output_path=tmp_path / "bad.xml")
    repaired_mjcf, repaired_export = export_rollout_trace_to_mujoco_mjcf(
        repaired_trace,
        output_path=tmp_path / "repaired.xml",
        branch_id="stop_and_replan",
    )

    assert report.success is False
    assert report.decision == "reject"
    assert any("contact_stability" in check.check_id for check in report.checks)
    assert repair_plan.original_score == report.score
    assert repair_plan.branches
    assert repaired_report.success is True
    assert repaired_report.score > report.score
    assert original_mjcf == ""
    assert original_export.success is False
    assert repaired_export.success is True
    assert repaired_export.branch_id == "stop_and_replan"
    assert "<mujoco" in repaired_mjcf
    assert (tmp_path / "repaired.xml").exists()
