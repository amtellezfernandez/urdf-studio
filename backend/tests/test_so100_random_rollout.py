from __future__ import annotations

import math

import pytest

from backend.services.executability_audit import audit_physical_rollout_trace
from backend.services.so100_random_rollout import (
    ALL_SCENARIOS,
    DEFAULT_FRAME_COUNT,
    JOINT_LOWER,
    JOINT_NAMES,
    JOINT_UPPER,
    REST_POSE,
    SCENARIO_COLLISION,
    SCENARIO_CONTACT_INSTABILITY,
    SCENARIO_JOINT_LIMIT,
    SCENARIO_VALID,
    fk_end_effector,
    generate_so100_rollout_batch,
    generate_so100_rollout_trace,
    summarize_rollout_batch,
)
import random


# ── FK sanity ─────────────────────────────────────────────────────────────

def test_fk_rest_pose_is_in_front_of_robot() -> None:
    # SO-100 reaches in the −Y direction at pan=0; pan sweeps the X axis.
    x, y, z = fk_end_effector(REST_POSE)
    assert y < 0, "rest pose pan=0 should place gripper along −Y axis"
    assert abs(y) > 0.05, "gripper should be meaningfully in front of base"
    assert z > 0.0, "gripper should be above the table"


def test_fk_pan_sweeps_horizontally() -> None:
    # Rotating pan around Z sweeps the X axis (arm naturally faces −Y at pan=0).
    q_left  = REST_POSE[:]; q_left[0]  = -0.6
    q_right = REST_POSE[:]; q_right[0] =  0.6
    xl, yl, _ = fk_end_effector(q_left)
    xr, yr, _ = fk_end_effector(q_right)
    assert xl < 0, "negative pan should move gripper to negative X"
    assert xr > 0, "positive pan should move gripper to positive X"
    assert math.isclose(abs(xl), xr, rel_tol=0.05), "sweep should be symmetric"


def test_fk_lift_changes_height() -> None:
    # In the lift range [2.5, 3.0] with neutral elbow, z increases with lift.
    q_low  = [0.0, 2.5, 0.0, 0.0, 0.0, 0.0]
    q_high = [0.0, 3.0, 0.0, 0.0, 0.0, 0.0]
    _, _, z_low  = fk_end_effector(q_low)
    _, _, z_high = fk_end_effector(q_high)
    assert z_high > z_low, "higher lift angle (2.5→3.0) should raise gripper"


# ── trajectory generation ─────────────────────────────────────────────────

def test_trajectory_respects_joint_limits_in_valid_scenario() -> None:
    rng = random.Random(1)
    from backend.services.so100_random_rollout import generate_joint_trajectory
    traj = generate_joint_trajectory(DEFAULT_FRAME_COUNT, rng=rng)
    for frame_q in traj:
        for i, angle in enumerate(frame_q):
            assert JOINT_LOWER[i] <= angle <= JOINT_UPPER[i], (
                f"Joint {JOINT_NAMES[i]} = {angle} violates limits [{JOINT_LOWER[i]}, {JOINT_UPPER[i]}]"
            )


def test_trajectory_injects_joint_violation() -> None:
    rng = random.Random(1)
    from backend.services.so100_random_rollout import generate_joint_trajectory
    traj = generate_joint_trajectory(DEFAULT_FRAME_COUNT, rng=rng, inject_joint_violation_at=10)
    pan_at_10 = traj[10][0]
    assert pan_at_10 > JOINT_UPPER[0], "injected pan should exceed upper limit"


# ── per-scenario trace structure ──────────────────────────────────────────

def test_valid_trace_has_correct_structure() -> None:
    trace = generate_so100_rollout_trace(
        trace_id="test-valid",
        scenario=SCENARIO_VALID,
        frame_count=10,
        rng=random.Random(0),
    )
    assert len(trace.frames) == 10
    for frame in trace.frames:
        entity_ids = {e.entity_id for e in frame.entities}
        assert "so100_arm"   in entity_ids
        assert "target_box"  in entity_ids
        assert "work_surface" in entity_ids


def test_valid_trace_box_moves_on_contact() -> None:
    trace = generate_so100_rollout_trace(
        trace_id="test-dynamic",
        scenario=SCENARIO_VALID,
        frame_count=DEFAULT_FRAME_COUNT,
        rng=random.Random(99),
    )
    box_positions = [
        next(e.position_xyz for e in f.entities if e.entity_id == "target_box")
        for f in trace.frames
    ]
    # Box should change position if any contact occurred
    contact_frames = [f for f in trace.frames if f.metadata.get("contact")]
    if contact_frames:
        first_pos = box_positions[0]
        last_pos  = box_positions[-1]
        moved = any(abs(last_pos[i] - first_pos[i]) > 1e-6 for i in range(2))
        assert moved, "box must move after gripper contact"


def test_joint_limit_trace_has_violation_constraint() -> None:
    trace = generate_so100_rollout_trace(
        trace_id="test-jlim",
        scenario=SCENARIO_JOINT_LIMIT,
        frame_count=DEFAULT_FRAME_COUNT,
        rng=random.Random(0),
    )
    violation_frame = trace.frames[DEFAULT_FRAME_COUNT // 2]
    assert any(c.constraint_type == "joint_limit" for c in violation_frame.constraints)


def test_contact_instability_trace_has_heavy_box() -> None:
    trace = generate_so100_rollout_trace(
        trace_id="test-ci",
        scenario=SCENARIO_CONTACT_INSTABILITY,
        frame_count=DEFAULT_FRAME_COUNT,
        rng=random.Random(0),
    )
    box_entity = next(e for e in trace.frames[0].entities if e.entity_id == "target_box")
    assert box_entity.mass_kg is not None
    assert box_entity.mass_kg > 10.0, "contact instability scenario needs a heavy box"


# ── WSP audit integration ─────────────────────────────────────────────────

def test_joint_limit_scenario_blocks() -> None:
    trace = generate_so100_rollout_trace(
        trace_id="test-jlim-audit",
        scenario=SCENARIO_JOINT_LIMIT,
        frame_count=DEFAULT_FRAME_COUNT,
        rng=random.Random(0),
    )
    report = audit_physical_rollout_trace(trace)
    assert report.decision in {"reject", "stop"}, (
        f"Joint limit violation should block; got {report.decision}"
    )
    failed_checks = [c.check_id for c in report.checks if not c.passed]
    assert any("joint_limit" in cid for cid in failed_checks)


def test_contact_instability_blocks_when_push_action_present() -> None:
    trace = generate_so100_rollout_trace(
        trace_id="test-ci-audit",
        scenario=SCENARIO_CONTACT_INSTABILITY,
        frame_count=DEFAULT_FRAME_COUNT,
        rng=random.Random(0),
    )
    if not trace.actions:
        pytest.skip("no contact occurred in this rollout — skip audit assertion")
    report = audit_physical_rollout_trace(trace)
    assert report.decision in {"reject", "stop", "warn"}, (
        f"Heavy box push should warn or block; got {report.decision}"
    )


def test_valid_scenario_does_not_block() -> None:
    # Contact with the box is expected → may produce "warn"; must never produce "reject"/"stop"
    for seed in range(5):
        trace = generate_so100_rollout_trace(
            trace_id=f"test-valid-audit-{seed}",
            scenario=SCENARIO_VALID,
            frame_count=DEFAULT_FRAME_COUNT,
            rng=random.Random(seed),
        )
        report = audit_physical_rollout_trace(trace)
        assert report.decision in {"allow", "warn"}, (
            f"Valid rollout (seed={seed}) must not block; got {report.decision}"
        )


def test_collision_scenario_blocks() -> None:
    blocked_any = False
    for seed in range(5):
        trace = generate_so100_rollout_trace(
            trace_id=f"test-collision-{seed}",
            scenario=SCENARIO_COLLISION,
            frame_count=DEFAULT_FRAME_COUNT,
            rng=random.Random(seed),
        )
        report = audit_physical_rollout_trace(trace)
        if report.decision in {"reject", "stop"}:
            blocked_any = True
            break
    assert blocked_any, "at least one collision rollout should be blocked by the WSP audit"


# ── batch generation ──────────────────────────────────────────────────────

def test_batch_contains_all_scenarios() -> None:
    traces = generate_so100_rollout_batch(40, seed=1)
    scenarios = {str(t.metadata.get("scenario")) for t in traces}
    assert set(ALL_SCENARIOS) == scenarios, "batch should sample all four scenario types"


def test_batch_summary_counts_match() -> None:
    traces = generate_so100_rollout_batch(20, seed=2)
    summary = summarize_rollout_batch(traces)
    assert summary["total_traces"] == 20
    assert summary["total_frames"] == 20 * DEFAULT_FRAME_COUNT
    assert sum(summary["scenario_counts"].values()) == 20
