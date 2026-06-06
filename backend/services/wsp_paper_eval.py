"""WSP Paper Evaluation Harness.

Runs all 5 detection methods against a corpus of clean + corrupted traces.
Computes the full metrics table: precision, recall, AUROC, FBR.

No sklearn — AUROC computed via trapezoidal integration with numpy only.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from backend.models.physical_state import PhysicalRolloutTrace
from backend.services.wsp_corruption_suite import CorruptedTrace
from backend.services.wsp_eval_baselines import (
    ZscoreStats,
    fit_zscore_stats,
    kinematic_check_score,
    learned_zscore_score,
    range_check_score,
    schema_check_score,
    wsp_audit_score,
)


# ── Result dataclasses ────────────────────────────────────────────────────────

@dataclass
class MethodMetrics:
    method: str
    precision: float
    recall: float
    auroc: float
    false_block_rate: float
    mean_runtime_ms: float
    n_evaluated: int


@dataclass
class EvalReport:
    n_clean: int
    n_corrupted: int
    corruption_types: list[str]
    methods: dict[str, MethodMetrics]           # method_name → MethodMetrics
    per_corruption: dict[str, dict[str, float]]  # corruption → method → recall
    metadata: dict[str, Any] = field(default_factory=dict)


# ── AUROC (numpy trapezoidal, no sklearn) ─────────────────────────────────────

def _auroc_numpy(y_true: list[int], scores: list[float]) -> float:
    """Compute AUROC via trapezoidal integration. Returns 0.5 if undefined."""
    y = np.asarray(y_true, dtype=np.int32)
    s = np.asarray(scores, dtype=np.float64)

    pos_count = int(y.sum())
    neg_count = int((1 - y).sum())
    if pos_count == 0 or neg_count == 0:
        return 0.5

    # Sort by descending score
    order = np.argsort(-s)
    y_sorted = y[order]

    tprs = np.concatenate([[0.0], np.cumsum(y_sorted) / pos_count])
    fprs = np.concatenate([[0.0], np.cumsum(1 - y_sorted) / neg_count])

    # Trapezoidal rule
    auroc = float(np.trapezoid(tprs, fprs))
    return auroc


# ── Precision / recall at threshold 0.5 ──────────────────────────────────────

def _precision_recall(
    y_true: list[int],
    scores: list[float],
    threshold: float = 0.5,
) -> tuple[float, float]:
    tp = sum(1 for y, s in zip(y_true, scores) if y == 1 and s >= threshold)
    fp = sum(1 for y, s in zip(y_true, scores) if y == 0 and s >= threshold)
    fn = sum(1 for y, s in zip(y_true, scores) if y == 1 and s < threshold)

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    return precision, recall


def _false_block_rate(
    y_true: list[int],
    scores: list[float],
    threshold: float = 0.5,
) -> float:
    """Fraction of clean traces scored >= threshold."""
    clean_scores = [s for y, s in zip(y_true, scores) if y == 0]
    if not clean_scores:
        return 0.0
    return sum(1 for s in clean_scores if s >= threshold) / len(clean_scores)


# ── Evaluator ─────────────────────────────────────────────────────────────────

_METHOD_NAMES = [
    "schema_check",
    "range_check",
    "kinematic_check",
    "wsp_audit",
    "learned_zscore",
]


def run_paper_eval(
    corrupted_corpus: list[CorruptedTrace],
    *,
    clean_traces: list[PhysicalRolloutTrace] | None = None,
    zscore_stats: ZscoreStats | None = None,
) -> EvalReport:
    """Run all 5 detection methods against the corpus.

    Args:
        corrupted_corpus: List of CorruptedTrace (clean + corrupted).
        clean_traces: Optional clean traces for fitting ZscoreStats.
            If None, extracts clean entries from corpus.
        zscore_stats: Pre-fitted ZscoreStats. If None, fits from clean_traces.

    Returns:
        EvalReport with per-method metrics and per-corruption recall.
    """
    # Fit zscore stats if needed
    if zscore_stats is None:
        if clean_traces is None:
            clean_traces = [ct.trace for ct in corrupted_corpus if not ct.is_corrupted]
        if clean_traces:
            zscore_stats = fit_zscore_stats(clean_traces)
        else:
            # Fallback: use default stats so the method doesn't crash
            zscore_stats = ZscoreStats(
                mean_ee_vel=0.0, std_ee_vel=1.0,
                mean_max_vel=0.0, std_max_vel=1.0,
                mean_traj_len=0.0, std_traj_len=1.0,
            )

    # Ground-truth labels
    y_true: list[int] = [1 if ct.is_corrupted else 0 for ct in corrupted_corpus]

    n_clean = sum(1 for y in y_true if y == 0)
    n_corrupted = sum(1 for y in y_true if y == 1)

    # Collect unique corruption types (excluding "none")
    corruption_types_seen: list[str] = []
    seen_set: set[str] = set()
    for ct in corrupted_corpus:
        if ct.corruption != "none" and ct.corruption not in seen_set:
            corruption_types_seen.append(ct.corruption)
            seen_set.add(ct.corruption)

    # Score every trace with every method
    method_scores: dict[str, list[float]] = {m: [] for m in _METHOD_NAMES}
    method_runtimes: dict[str, list[float]] = {m: [] for m in _METHOD_NAMES}

    for ct in corrupted_corpus:
        trace = ct.trace

        s, ms = schema_check_score(trace)
        method_scores["schema_check"].append(s)
        method_runtimes["schema_check"].append(ms)

        s, ms = range_check_score(trace)
        method_scores["range_check"].append(s)
        method_runtimes["range_check"].append(ms)

        s, ms = kinematic_check_score(trace)
        method_scores["kinematic_check"].append(s)
        method_runtimes["kinematic_check"].append(ms)

        s, ms = wsp_audit_score(trace)
        method_scores["wsp_audit"].append(s)
        method_runtimes["wsp_audit"].append(ms)

        s, ms = learned_zscore_score(trace, zscore_stats)
        method_scores["learned_zscore"].append(s)
        method_runtimes["learned_zscore"].append(ms)

    # Build per-method metrics
    methods: dict[str, MethodMetrics] = {}
    for mname in _METHOD_NAMES:
        scores = method_scores[mname]
        runtimes = method_runtimes[mname]
        precision, recall = _precision_recall(y_true, scores)
        auroc = _auroc_numpy(y_true, scores)
        fbr = _false_block_rate(y_true, scores)
        methods[mname] = MethodMetrics(
            method=mname,
            precision=precision,
            recall=recall,
            auroc=auroc,
            false_block_rate=fbr,
            mean_runtime_ms=float(np.mean(runtimes)) if runtimes else 0.0,
            n_evaluated=len(corrupted_corpus),
        )

    # Build per-corruption recall for each method
    per_corruption: dict[str, dict[str, float]] = {}
    for ctype in corruption_types_seen:
        # Find indices of this corruption type
        indices = [i for i, ct in enumerate(corrupted_corpus) if ct.corruption == ctype]
        per_corruption[ctype] = {}
        for mname in _METHOD_NAMES:
            scores_for_type = [method_scores[mname][i] for i in indices]
            # Recall = fraction of corrupted traces of this type detected (score >= 0.5)
            if scores_for_type:
                per_corruption[ctype][mname] = sum(
                    1 for s in scores_for_type if s >= 0.5
                ) / len(scores_for_type)
            else:
                per_corruption[ctype][mname] = 0.0

    return EvalReport(
        n_clean=n_clean,
        n_corrupted=n_corrupted,
        corruption_types=corruption_types_seen,
        methods=methods,
        per_corruption=per_corruption,
        metadata={
            "corpus_size": len(corrupted_corpus),
            "n_methods": len(_METHOD_NAMES),
        },
    )


# ── ASCII table formatter ──────────────────────────────────────────────────────

def format_eval_table(report: EvalReport) -> str:
    """Return a human-readable ASCII metrics table."""
    header = (
        f"{'Method':<24}{'Precision':>10}{'Recall':>8}{'AUROC':>8}"
        f"{'FBR':>8}{'ms/ep':>8}"
    )
    separator = "-" * len(header)
    lines = [header, separator]

    for mname in _METHOD_NAMES:
        m = report.methods.get(mname)
        if m is None:
            continue
        lines.append(
            f"{m.method:<24}{m.precision:>10.2f}{m.recall:>8.2f}{m.auroc:>8.2f}"
            f"{m.false_block_rate:>8.2f}{m.mean_runtime_ms:>8.1f}"
        )

    lines.append(separator)
    lines.append(
        f"Corpus: {report.n_clean} clean, {report.n_corrupted} corrupted  "
        f"({len(report.corruption_types)} corruption types)"
    )
    return "\n".join(lines)
