"""Tests for backend/services/wsp_paper_eval.py.

All tests use minimal in-memory traces — no HuggingFace network calls.
"""
from __future__ import annotations

import pytest

from backend.models.physical_state import (
    ActionToken,
    PhysicalEntity,
    PhysicalRolloutTrace,
    PhysicalStateFrame,
)
from backend.services.wsp_corruption_suite import build_eval_corpus
from backend.services.wsp_paper_eval import (
    EvalReport,
    MethodMetrics,
    format_eval_table,
    run_paper_eval,
)


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

class TestRunPaperEval:

    def test_run_paper_eval_produces_all_methods(self):
        """5 clean traces × 10 corruptions = corpus of 55 entries; all 5 methods present."""
        clean_traces = [_minimal_trace(f"t{i}") for i in range(5)]
        corpus = build_eval_corpus(clean_traces, n_clean_copies=1, seed=42)

        report = run_paper_eval(corpus)

        assert isinstance(report, EvalReport)
        expected_methods = {
            "schema_check",
            "range_check",
            "kinematic_check",
            "wsp_audit",
            "learned_zscore",
        }
        assert set(report.methods.keys()) == expected_methods, (
            f"Missing methods: {expected_methods - set(report.methods.keys())}"
        )

    def test_run_paper_eval_counts_correct(self):
        """n_clean and n_corrupted should match corpus composition."""
        clean_traces = [_minimal_trace(f"t{i}") for i in range(2)]
        corpus = build_eval_corpus(clean_traces, n_clean_copies=1, seed=0)

        report = run_paper_eval(corpus)

        assert report.n_clean == 2
        assert report.n_corrupted == 20
        assert len(report.corruption_types) == 10

    def test_run_paper_eval_metrics_in_range(self):
        """All metric values should be in [0, 1] or reasonable ranges."""
        clean_traces = [_minimal_trace(f"t{i}") for i in range(3)]
        corpus = build_eval_corpus(clean_traces, n_clean_copies=1, seed=1)

        report = run_paper_eval(corpus)

        for mname, m in report.methods.items():
            assert 0.0 <= m.precision <= 1.0, f"{mname}: precision out of range"
            assert 0.0 <= m.recall <= 1.0, f"{mname}: recall out of range"
            assert 0.0 <= m.auroc <= 1.0, f"{mname}: auroc out of range"
            assert 0.0 <= m.false_block_rate <= 1.0, f"{mname}: fbr out of range"
            assert m.mean_runtime_ms >= 0.0, f"{mname}: negative runtime"
            assert m.n_evaluated > 0

    def test_run_paper_eval_with_explicit_zscore_stats(self):
        """Passing pre-fitted zscore_stats should produce the same report."""
        from backend.services.wsp_eval_baselines import fit_zscore_stats

        clean_traces = [_minimal_trace(f"t{i}") for i in range(3)]
        corpus = build_eval_corpus(clean_traces, n_clean_copies=1, seed=2)
        stats = fit_zscore_stats(clean_traces)

        report = run_paper_eval(corpus, zscore_stats=stats)
        assert "learned_zscore" in report.methods

    def test_run_paper_eval_per_corruption_has_all_types(self):
        """per_corruption dict should contain entries for each corruption type."""
        from backend.services.wsp_corruption_suite import ALL_CORRUPTIONS

        clean_traces = [_minimal_trace(f"t{i}") for i in range(2)]
        corpus = build_eval_corpus(clean_traces, n_clean_copies=1, seed=3)

        report = run_paper_eval(corpus)

        assert set(report.per_corruption.keys()) == set(ALL_CORRUPTIONS), (
            f"per_corruption missing types: {set(ALL_CORRUPTIONS) - set(report.per_corruption.keys())}"
        )

    def test_run_paper_eval_per_corruption_recall_in_range(self):
        """All per-corruption recall values should be in [0, 1]."""
        clean_traces = [_minimal_trace(f"t{i}") for i in range(2)]
        corpus = build_eval_corpus(clean_traces, n_clean_copies=1, seed=4)

        report = run_paper_eval(corpus)

        for ctype, method_recalls in report.per_corruption.items():
            for mname, recall in method_recalls.items():
                assert 0.0 <= recall <= 1.0, (
                    f"per_corruption[{ctype!r}][{mname!r}] = {recall} out of [0,1]"
                )


class TestFormatEvalTable:

    def _build_small_report(self) -> EvalReport:
        clean_traces = [_minimal_trace(f"t{i}") for i in range(3)]
        corpus = build_eval_corpus(clean_traces, n_clean_copies=1, seed=5)
        return run_paper_eval(corpus)

    def test_format_eval_table_has_all_columns(self):
        report = self._build_small_report()
        table = format_eval_table(report)
        assert "Precision" in table
        assert "Recall" in table
        assert "AUROC" in table
        assert "FBR" in table

    def test_format_eval_table_has_all_methods(self):
        report = self._build_small_report()
        table = format_eval_table(report)
        for method in ["schema_check", "range_check", "kinematic_check", "wsp_audit", "learned_zscore"]:
            assert method in table, f"Method {method!r} not found in table"

    def test_format_eval_table_returns_string(self):
        report = self._build_small_report()
        table = format_eval_table(report)
        assert isinstance(table, str)
        assert len(table) > 100

    def test_format_eval_table_has_corpus_summary(self):
        report = self._build_small_report()
        table = format_eval_table(report)
        # Should contain corpus size info
        assert "clean" in table.lower() or "corrupted" in table.lower()
