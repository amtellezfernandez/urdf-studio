from __future__ import annotations

from xml.etree import ElementTree as ET

import pytest

from backend.models.physical_state import ActionToken, ConstraintToken, PhysicalEntity, PhysicalStateFrame
import backend.services.simulator_export as simulator_export_module
from backend.services.correction_planner import build_repair_plan, rollout_correction_branch
from backend.services.executability_audit import audit_physical_rollout_trace, audit_physical_state_frame
from backend.services.physical_rollout_baseline import rollout_action
from backend.services.simulator_export import (
    export_rollout_trace_to_genesis_scene,
    export_rollout_trace_to_mujoco_mjcf,
)


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


def test_audit_rejects_declared_joint_limit_violation() -> None:
    frame = PhysicalStateFrame(
        frame_id="joint-limit-smoke",
        t_ms=0,
        entities=[
            PhysicalEntity(
                entity_id="robot-1",
                entity_type="robot",
                geometry_type="box",
                position_xyz=[0.0, 0.0, 0.1],
                size_xyz=[0.2, 0.2, 0.2],
            )
        ],
        constraints=[
            ConstraintToken(
                constraint_id="joint-limit-1",
                constraint_type="joint_limit",
                subject_id="robot-1",
                target_entity_ids=["robot-1"],
                params={"joint_name": "shoulder_pan", "position": 2.4, "lower": -1.57, "upper": 1.57},
            )
        ],
    )

    report = audit_physical_state_frame(frame)

    assert report.success is False
    assert any(check.check_id == "joint_limit" for check in report.checks)


def test_audit_rejects_declared_reachability_violation() -> None:
    frame = PhysicalStateFrame(
        frame_id="reachability-smoke",
        t_ms=0,
        entities=[
            PhysicalEntity(
                entity_id="robot-1",
                entity_type="robot",
                geometry_type="box",
                position_xyz=[0.0, 0.0, 0.1],
                size_xyz=[0.2, 0.2, 0.2],
            ),
            PhysicalEntity(
                entity_id="dock-1",
                entity_type="dock",
                geometry_type="box",
                position_xyz=[2.0, 0.0, 0.1],
                size_xyz=[0.2, 0.2, 0.2],
            ),
        ],
        constraints=[
            ConstraintToken(
                constraint_id="reachability-1",
                constraint_type="reachability",
                subject_id="robot-1",
                target_entity_ids=["dock-1"],
                params={"max_distance_m": 0.5},
            )
        ],
    )

    report = audit_physical_state_frame(frame)

    assert report.success is False
    assert any(check.check_id == "reachability" for check in report.checks)


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


def _wait_trace():
    return rollout_action(
        _pallet_push_frame(),
        ActionToken(action_id="wait", action_type="wait", params={"duration_ms": 0}),
        step_count=1,
        step_ms=1,
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


def test_mujoco_export_converts_studio_y_up_frame_to_simulator_z_up() -> None:
    frame = PhysicalStateFrame(
        frame_id="frame-map-smoke",
        t_ms=0,
        frame_convention="studio-y-up",
        entities=[
            PhysicalEntity(
                entity_id="rotated-box",
                entity_type="object",
                geometry_type="box",
                position_xyz=[0.25, 0.15, -0.2],
                size_xyz=[0.4, 0.2, 0.3],
                metadata={"color": "#ef4444"},
            ),
            PhysicalEntity(
                entity_id="hidden-box",
                entity_type="object",
                geometry_type="box",
                position_xyz=[1.0, 1.0, 1.0],
                size_xyz=[0.2, 0.2, 0.2],
                metadata={"is_hidden": True},
            ),
        ],
    )

    mjcf, export_status = export_rollout_trace_to_mujoco_mjcf(
        rollout_action(
            frame,
            ActionToken(action_id="wait", action_type="wait", params={"duration_ms": 0}),
            step_count=1,
            step_ms=1,
        )
    )

    root = ET.fromstring(mjcf)
    geom = root.find(".//geom[@name='rotated-box']")
    assert geom is not None
    assert [float(value) for value in geom.attrib["pos"].split()] == pytest.approx([0.25, 0.2, 0.15])
    assert [float(value) for value in geom.attrib["size"].split()] == pytest.approx([0.2, 0.15, 0.1])
    assert [float(value) for value in geom.attrib["rgba"].split()] == pytest.approx([239 / 255, 68 / 255, 68 / 255, 1.0])
    assert root.find(".//geom[@name='hidden-box']") is None
    assert export_status.success is True
    assert export_status.metrics["source_frame_convention"] == "studio-y-up"
    assert export_status.metrics["mujoco_frame_map"] == "studio-y-up-to-z-up"
    assert export_status.metrics["skipped_hidden_count"] == 1
    assert export_status.metrics["mujoco_max_position_error_m"] <= 1e-6
    assert export_status.metrics["mujoco_max_size_error_m"] <= 1e-6
    assert export_status.metrics["mujoco_collision_mismatch_count"] == 0


def test_mujoco_export_records_expected_smoke_errors(monkeypatch) -> None:
    def _raise_smoke_error(*_args, **_kwargs):
        raise RuntimeError("mujoco smoke crashed")

    monkeypatch.setattr(
        simulator_export_module,
        "check_mujoco_transfer",
        _raise_smoke_error,
    )

    mjcf, export_status = export_rollout_trace_to_mujoco_mjcf(_wait_trace())

    assert "<mujoco" in mjcf
    assert export_status.success is False
    assert export_status.target == "mujoco"
    assert export_status.error == "mujoco smoke crashed"


def test_mujoco_export_preserves_unexpected_smoke_errors(monkeypatch) -> None:
    def _raise_unexpected_error(*_args, **_kwargs):
        raise KeyError("unexpected mujoco smoke bookkeeping failure")

    monkeypatch.setattr(
        simulator_export_module,
        "check_mujoco_transfer",
        _raise_unexpected_error,
    )

    with pytest.raises(KeyError, match="unexpected mujoco smoke bookkeeping failure"):
        export_rollout_trace_to_mujoco_mjcf(_wait_trace())


def test_genesis_export_uses_same_simulator_frame_and_collision_contract(tmp_path) -> None:
    frame = PhysicalStateFrame(
        frame_id="genesis-frame-map-smoke",
        t_ms=0,
        frame_convention="studio-y-up",
        entities=[
            PhysicalEntity(
                entity_id="lane-a3",
                entity_type="lane",
                geometry_type="box",
                position_xyz=[1.5, 0.6, 0.025],
                size_xyz=[2.2, 0.2, 0.05],
                metadata={"color": "#f59e0b", "collision": False},
            ),
            PhysicalEntity(
                entity_id="hidden-box",
                entity_type="object",
                geometry_type="box",
                position_xyz=[1.0, 1.0, 1.0],
                size_xyz=[0.2, 0.2, 0.2],
                metadata={"is_hidden": True},
            ),
        ],
    )

    scene, export_status = export_rollout_trace_to_genesis_scene(
        rollout_action(
            frame,
            ActionToken(action_id="wait", action_type="wait", params={"duration_ms": 0}),
            step_count=1,
            step_ms=1,
        ),
        output_path=tmp_path / "corrected.genesis-scene.json",
    )

    assert scene["target"] == "genesis"
    assert scene["genesis_frame_map"] == "studio-y-up-to-z-up"
    assert len(scene["entities"]) == 1
    entity = scene["entities"][0]
    assert entity["name"] == "lane-a3"
    assert entity["type"] == "box"
    assert entity["position_xyz"] == pytest.approx([1.5, -0.025, 0.6])
    assert entity["size_xyz"] == pytest.approx([2.2, 0.05, 0.2])
    assert entity["collision"] is False
    assert export_status.success is True
    assert export_status.target == "genesis"
    assert export_status.metrics["source_frame_convention"] == "studio-y-up"
    assert export_status.metrics["genesis_frame_map"] == "studio-y-up-to-z-up"
    assert export_status.metrics["skipped_hidden_count"] == 1
    assert (tmp_path / "corrected.genesis-scene.json").exists()
    if export_status.smoke_passed:
        assert export_status.metrics["genesis_entity_count"] == 1
        assert export_status.metrics["genesis_max_position_error_m"] <= 1e-6
        assert export_status.metrics["genesis_max_size_error_m"] <= 1e-6
        assert export_status.metrics["genesis_collision_mismatch_count"] == 0


def test_genesis_export_records_expected_smoke_errors(monkeypatch) -> None:
    def _raise_smoke_error(*_args, **_kwargs):
        raise RuntimeError("genesis smoke crashed")

    monkeypatch.setattr(
        simulator_export_module,
        "check_genesis_transfer",
        _raise_smoke_error,
    )

    scene, export_status = export_rollout_trace_to_genesis_scene(_wait_trace())

    assert scene["target"] == "genesis"
    assert export_status.success is False
    assert export_status.target == "genesis"
    assert export_status.error == "genesis smoke crashed"


def test_genesis_export_preserves_unexpected_smoke_errors(monkeypatch) -> None:
    def _raise_unexpected_error(*_args, **_kwargs):
        raise KeyError("unexpected genesis smoke bookkeeping failure")

    monkeypatch.setattr(
        simulator_export_module,
        "check_genesis_transfer",
        _raise_unexpected_error,
    )

    with pytest.raises(KeyError, match="unexpected genesis smoke bookkeeping failure"):
        export_rollout_trace_to_genesis_scene(_wait_trace())
