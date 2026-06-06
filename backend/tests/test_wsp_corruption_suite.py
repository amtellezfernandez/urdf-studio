"""Tests for backend/services/wsp_corruption_suite.py.

All tests use minimal in-memory traces — no HuggingFace network calls.
"""
from __future__ import annotations

import random

import pytest

from backend.models.physical_state import (
    ActionToken,
    PhysicalEntity,
    PhysicalRolloutTrace,
    PhysicalStateFrame,
)
from backend.services.wsp_corruption_suite import (
    ALL_CORRUPTIONS,
    CORRUPTION_CONTACT,
    CORRUPTION_INTERPENETRATION,
    CORRUPTION_NONE,
    CorruptedTrace,
    apply_corruption,
    build_eval_corpus,
)
from backend.services.wsp_eval_baselines import kinematic_check_score, wsp_audit_score


# ── Minimal trace helper ──────────────────────────────────────────────────────

def _minimal_trace(trace_id: str = "t0") -> PhysicalRolloutTrace:
    robot = PhysicalEntity(
        entity_id="so101",
        entity_type="robot",
        geometry_type="box",
        position_xyz=[0.10, 0.0, 0.05],
        size_xyz=[0.03, 0.03, 0.03],
        metadata={
            "joint_state_deg": [1.0, -90.0, 90.0, 70.0, -50.0, 1.0],
            "joint_names": [
                "shoulder_pan", "shoulder_lift", "elbow_flex",
                "wrist_flex", "wrist_roll", "gripper",
            ],
        },
    )
    table = PhysicalEntity(
        entity_id="work_surface",
        entity_type="surface",
        geometry_type="box",
        position_xyz=[0.0, 0.0, -0.025],
        size_xyz=[1.0, 0.8, 0.05],
        movable=False,
    )
    f0 = PhysicalStateFrame(
        frame_id=f"{trace_id}:f0",
        t_ms=0,
        entities=[robot, table],
    )
    robot2 = robot.model_copy(deep=True)
    robot2.position_xyz = [0.11, 0.0, 0.05]
    f1 = PhysicalStateFrame(
        frame_id=f"{trace_id}:f1",
        t_ms=100,
        entities=[robot2, table],
    )
    action = ActionToken(
        action_id=f"{trace_id}:a0",
        action_type="set_pose",
        actor_id="so101",
        params={
            "joint_targets_deg": [1.0, -90.0, 90.0, 70.0, -50.0, 1.0],
            "joint_names": [
                "shoulder_pan", "shoulder_lift", "elbow_flex",
                "wrist_flex", "wrist_roll", "gripper",
            ],
        },
    )
    return PhysicalRolloutTrace(
        trace_id=trace_id,
        frames=[f0, f1],
        actions=[action],
    )


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestApplyCorruption:

    def test_none_corruption_returns_clean_label(self):
        trace = _minimal_trace()
        rng = random.Random(0)
        result = apply_corruption(trace, CORRUPTION_NONE, rng)
        assert isinstance(result, CorruptedTrace)
        assert result.corruption == CORRUPTION_NONE
        assert result.is_corrupted is False

    def test_none_corruption_deep_copies_trace(self):
        trace = _minimal_trace()
        rng = random.Random(0)
        result = apply_corruption(trace, CORRUPTION_NONE, rng)
        assert result.trace is not trace
        assert result.trace.frames[0] is not trace.frames[0]

    @pytest.mark.parametrize("ctype", ALL_CORRUPTIONS)
    def test_all_corruptions_produce_corrupted_label(self, ctype: str):
        trace = _minimal_trace()
        rng = random.Random(42)
        result = apply_corruption(trace, ctype, rng)
        assert result.is_corrupted is True, f"Corruption {ctype!r} should set is_corrupted=True"
        assert result.corruption == ctype

    @pytest.mark.parametrize("ctype", ALL_CORRUPTIONS)
    def test_all_corruptions_deep_copy(self, ctype: str):
        trace = _minimal_trace()
        rng = random.Random(42)
        result = apply_corruption(trace, ctype, rng)
        assert result.trace is not trace, f"Corruption {ctype!r} must return a deep copy"
        assert result.trace.frames is not trace.frames

    def test_unknown_corruption_raises(self):
        trace = _minimal_trace()
        rng = random.Random(0)
        with pytest.raises(ValueError, match="Unknown corruption type"):
            apply_corruption(trace, "not_a_real_corruption", rng)


class TestBuildEvalCorpus:

    def test_build_eval_corpus_structure_two_traces(self):
        """2 clean traces × (1 clean copy + 10 corruptions) = 22 entries."""
        traces = [_minimal_trace("t0"), _minimal_trace("t1")]
        corpus = build_eval_corpus(traces, n_clean_copies=1)

        assert len(corpus) == 22, f"Expected 22, got {len(corpus)}"

        # Count clean vs corrupted
        clean_count = sum(1 for ct in corpus if not ct.is_corrupted)
        corrupted_count = sum(1 for ct in corpus if ct.is_corrupted)
        assert clean_count == 2, f"Expected 2 clean, got {clean_count}"
        assert corrupted_count == 20, f"Expected 20 corrupted, got {corrupted_count}"

    def test_build_eval_corpus_all_corruptions_present(self):
        traces = [_minimal_trace("t0")]
        corpus = build_eval_corpus(traces, n_clean_copies=1)
        corruption_types = {ct.corruption for ct in corpus if ct.is_corrupted}
        assert set(ALL_CORRUPTIONS) == corruption_types

    def test_build_eval_corpus_custom_corruption_types(self):
        traces = [_minimal_trace()]
        corpus = build_eval_corpus(
            traces,
            corruption_types=["degree_radian_mismatch", "frame_convention_flip"],
            n_clean_copies=1,
        )
        assert len(corpus) == 3  # 1 clean + 2 corrupted

    def test_build_eval_corpus_multiple_clean_copies(self):
        traces = [_minimal_trace()]
        corpus = build_eval_corpus(traces, n_clean_copies=3)
        clean_count = sum(1 for ct in corpus if not ct.is_corrupted)
        assert clean_count == 3

    def test_build_eval_corpus_seed_reproducible(self):
        traces = [_minimal_trace()]
        c1 = build_eval_corpus(traces, seed=7)
        c2 = build_eval_corpus(traces, seed=7)
        # Same seed → same results
        for a, b in zip(c1, c2):
            assert a.corruption == b.corruption
            assert a.is_corrupted == b.is_corrupted


class TestC9InterpenetrationDetectableByWSP:

    def test_corruption_c9_interpenetration_detectable_by_wsp_audit(self):
        """C9 on a trace with robot+table should score 1.0 from wsp_audit_score."""
        trace = _minimal_trace()
        rng = random.Random(42)
        result = apply_corruption(trace, CORRUPTION_INTERPENETRATION, rng)
        assert result.is_corrupted is True

        score, _ = wsp_audit_score(result.trace)
        assert score == 1.0, (
            f"C9 interpenetration should be detected by WSP audit (score=1.0), got {score}"
        )


class TestC8ContactMissedByWSPButCaughtByKinematic:

    def test_corruption_c8_contact_missed_by_wsp_but_caught_by_kinematic(self):
        """C8 should score 0.0 from wsp_audit (C8 not detectable by WSP) but
        1.0 from kinematic_check_score (contacts relation > 20cm apart)."""
        trace = _minimal_trace()
        rng = random.Random(42)
        result = apply_corruption(trace, CORRUPTION_CONTACT, rng)
        assert result.is_corrupted is True

        # WSP audit should NOT catch C8 (contact relation present → overlap allowed)
        # But since there's no overlap (entities not interpenetrating), score may be 0.0
        wsp_score, _ = wsp_audit_score(result.trace)
        # WSP does not detect C8: score should be 0.0 or 0.5 (warn, not reject)
        assert wsp_score < 1.0, (
            f"WSP audit should NOT detect C8 as reject (got score={wsp_score})"
        )

        # Kinematic check SHOULD catch it: contacts relation with entities > 20cm apart
        kinematic_score, _ = kinematic_check_score(result.trace)
        assert kinematic_score == 1.0, (
            f"Kinematic check should detect C8 impossible contact (got {kinematic_score})"
        )
