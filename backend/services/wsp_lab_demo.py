from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend.services.world_model_dataset import write_world_model_dataset_jsonl
from backend.services.wsp_audit_benchmark import benchmark_audit_against_replay
from backend.services.wsp_ci_report import build_wsp_ci_report, write_wsp_ci_report
from backend.services.wsp_failure_corpus import (
    generate_wsp_failure_corpus_samples,
    summarize_wsp_failure_corpus,
)
from backend.services.wsp_graph_baseline import train_wsp_graph_baseline, write_wsp_graph_baseline_artifacts
from backend.services.wsp_model_lift import compare_raw_vs_wsp_model_lift, write_model_lift_report
from backend.services.wsp_policy_eval import evaluate_policy_regression, write_policy_eval_report
from backend.services.wsp_raw_baseline import train_raw_log_baseline, write_raw_log_baseline_artifacts
from backend.services.wsp_replay_label import replay_label_samples, summarize_replay_labeled_samples


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def run_wsp_lab_demo(
    *,
    output_dir: Path,
    count: int = 1000,
    policy_count: int = 120,
    failure_modes: str = "collision,contact,joint,battery,reachability",
    seed: int = 41,
    epochs: int = 250,
    min_auroc_lift: float = 0.1,
    min_unsafe_fn_reduction: float = 0.2,
    require_wsp_position_mae_not_worse: bool = True,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)

    corpus_path = output_dir / "wsp_failure_corpus.jsonl"
    corpus_manifest_path = output_dir / "wsp_failure_corpus_manifest.json"
    corpus_summary_path = output_dir / "wsp_failure_corpus_summary.json"
    labeled_path = output_dir / "wsp_failure_corpus_labeled.jsonl"
    labeled_manifest_path = output_dir / "wsp_failure_corpus_labeled_manifest.json"
    replay_summary_path = output_dir / "wsp_replay_summary.json"
    audit_benchmark_path = output_dir / "wsp_audit_benchmark.json"
    raw_report_path = output_dir / "raw_log_baseline_report.json"
    raw_model_path = output_dir / "raw_log_baseline_model.json"
    wsp_report_path = output_dir / "wsp_graph_baseline_report.json"
    wsp_model_path = output_dir / "wsp_graph_baseline_model.json"
    model_lift_path = output_dir / "wsp_model_lift_report.json"
    policy_baseline_path = output_dir / "policy_v16.jsonl"
    policy_candidate_path = output_dir / "policy_v17.jsonl"
    policy_eval_path = output_dir / "policy_regression_eval.json"
    ci_report_path = output_dir / "wsp_ci_report.json"
    summary_path = output_dir / "lab_demo_summary.json"

    corpus_samples = generate_wsp_failure_corpus_samples(
        count=count,
        failure_modes=failure_modes,
        valid_ratio=0.25,
        seed=seed,
    )
    corpus_summary = summarize_wsp_failure_corpus(corpus_samples)
    write_world_model_dataset_jsonl(
        corpus_samples,
        output_path=corpus_path,
        dataset_id="wsp-failure-corpus-demo",
        manifest_path=corpus_manifest_path,
    )
    _write_json(corpus_summary_path, corpus_summary)

    labeled_samples = replay_label_samples(corpus_samples, targets="mujoco,genesis")
    replay_summary = summarize_replay_labeled_samples(labeled_samples)
    write_world_model_dataset_jsonl(
        labeled_samples,
        output_path=labeled_path,
        dataset_id="wsp-failure-corpus-demo-labeled",
        manifest_path=labeled_manifest_path,
        metadata={"sim_replay_targets": ["mujoco", "genesis"]},
    )
    _write_json(replay_summary_path, replay_summary)

    audit_benchmark = benchmark_audit_against_replay(labeled_samples)
    audit_report = {
        "ok": (
            audit_benchmark["invalid_detection"]["precision"] >= 0.9
            and audit_benchmark["invalid_detection"]["recall"] >= 0.8
            and audit_benchmark["invalid_detection"]["false_reject_rate"] <= 0.15
            and audit_benchmark["runtime"]["mean_ms_per_transition"] < 100
        ),
        "benchmark": audit_benchmark,
    }
    _write_json(audit_benchmark_path, audit_report)

    raw_report, raw_model = train_raw_log_baseline(
        labeled_samples,
        dataset_id="wsp-failure-corpus-demo",
    )
    write_raw_log_baseline_artifacts(raw_report, raw_model, report_path=raw_report_path, model_path=raw_model_path)

    wsp_report, wsp_model = train_wsp_graph_baseline(
        labeled_samples,
        dataset_id="wsp-failure-corpus-demo",
        epochs=epochs,
    )
    write_wsp_graph_baseline_artifacts(wsp_report, wsp_model, report_path=wsp_report_path, model_path=wsp_model_path)

    model_lift = compare_raw_vs_wsp_model_lift(
        raw_report=raw_report,
        wsp_report=wsp_report,
        min_auroc_lift=min_auroc_lift,
        min_unsafe_fn_reduction=min_unsafe_fn_reduction,
        require_wsp_position_mae_not_worse=require_wsp_position_mae_not_worse,
    )
    write_model_lift_report(model_lift, output_path=model_lift_path)

    policy_baseline = replay_label_samples(
        generate_wsp_failure_corpus_samples(
            count=policy_count,
            failure_modes=failure_modes,
            valid_ratio=0.9,
            seed=seed + 1000,
        ),
        targets="mujoco,genesis",
    )
    policy_candidate = replay_label_samples(
        generate_wsp_failure_corpus_samples(
            count=policy_count,
            failure_modes=failure_modes,
            valid_ratio=0.5,
            seed=seed + 1001,
        ),
        targets="mujoco,genesis",
    )
    write_world_model_dataset_jsonl(
        policy_baseline,
        output_path=policy_baseline_path,
        dataset_id="policy-v16-demo",
    )
    write_world_model_dataset_jsonl(
        policy_candidate,
        output_path=policy_candidate_path,
        dataset_id="policy-v17-demo",
    )
    policy_eval = evaluate_policy_regression(
        baseline_samples=policy_baseline,
        candidate_samples=policy_candidate,
        max_invalid_rate_increase=0.02,
    )
    write_policy_eval_report(policy_eval, output_path=policy_eval_path)
    ci_report = build_wsp_ci_report(policy_report=policy_eval)
    write_wsp_ci_report(ci_report, output_path=ci_report_path)

    summary = {
        "success": (
            audit_report["ok"]
            and raw_report["success"]
            and wsp_report["success"]
            and model_lift["ok"]
            and ci_report["status"] == "BLOCK"
        ),
        "claim": (
            "WSP is robotics data/eval infrastructure: it standardizes robot rollouts, "
            "validates physical executability against simulator replay, improves invalid-action "
            "prediction over raw logs, and blocks unsafe model regressions in CI."
        ),
        "terminal_replay": [
            f"1. Generated {corpus_summary['sample_count']} WSP transitions with {corpus_summary['rejected_count']} rejected rollouts.",
            f"2. Attached MuJoCo/Genesis replay labels with agreement rate {replay_summary['audit_replay_agreement_rate']:.3f}.",
            f"3. Audit benchmark precision={audit_benchmark['invalid_detection']['precision']:.3f}, recall={audit_benchmark['invalid_detection']['recall']:.3f}.",
            (
                "4. Model lift: raw AUROC "
                f"{model_lift['raw_log_baseline']['metrics']['invalid_action_auroc']:.3f} -> "
                f"WSP AUROC {model_lift['wsp_model']['metrics']['invalid_action_auroc']:.3f}; "
                "unsafe FN "
                f"{model_lift['raw_log_baseline']['metrics']['unsafe_false_negative_rate']:.3f} -> "
                f"{model_lift['wsp_model']['metrics']['unsafe_false_negative_rate']:.3f}."
            ),
            (
                "5. Policy regression: invalid rollout rate "
                f"{policy_eval['baseline']['invalid_rate']:.3f} -> {policy_eval['candidate']['invalid_rate']:.3f}; "
                f"CI status {ci_report['status']}."
            ),
        ],
        "artifacts": {
            "corpus": str(corpus_path),
            "labeled_corpus": str(labeled_path),
            "audit_benchmark": str(audit_benchmark_path),
            "raw_report": str(raw_report_path),
            "wsp_report": str(wsp_report_path),
            "model_lift": str(model_lift_path),
            "policy_eval": str(policy_eval_path),
            "ci_report": str(ci_report_path),
            "summary": str(summary_path),
        },
        "metrics": {
            "audit": audit_benchmark,
            "model_lift": model_lift["relative_improvement"],
            "policy_regression": policy_eval["regression"],
            "ci_status": ci_report["status"],
        },
    }
    _write_json(summary_path, summary)
    return summary
