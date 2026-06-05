from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any, Sequence

from backend.models.physical_state import WorldModelTrainingSample
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


def _flip_replay_label(label: str) -> str:
    if label == "pass":
        return "fail"
    if label == "fail":
        return "pass"
    return label


def _apply_synthetic_label_noise(
    samples: Sequence[WorldModelTrainingSample],
    *,
    noise_rate: float,
    seed: int,
) -> list[WorldModelTrainingSample]:
    if not 0.0 <= noise_rate <= 1.0:
        raise ValueError("stress_noise_rate must be between 0 and 1.")
    stress_samples = [sample.model_copy(deep=True) for sample in samples]
    flip_count = round(len(stress_samples) * noise_rate)
    rng = random.Random(seed)
    flip_indices = set(rng.sample(range(len(stress_samples)), flip_count)) if flip_count else set()
    for index, sample in enumerate(stress_samples):
        sample.metadata["stress_truth_source"] = "synthetic_ambiguity_label_noise"
        sample.metadata["stress_label_noise_rate"] = noise_rate
        if index not in flip_indices:
            continue
        original_label = str(sample.metadata.get("sim_replay_label", "unknown"))
        flipped_label = _flip_replay_label(original_label)
        sample.metadata["stress_label_noise"] = True
        sample.metadata["stress_original_sim_replay_label"] = original_label
        sample.metadata["sim_replay_label"] = flipped_label
        targets = sample.metadata.get("sim_replay", {}).get("targets", {})
        if isinstance(targets, dict):
            for result in targets.values():
                if isinstance(result, dict) and result.get("label") in {"pass", "fail"}:
                    result["stress_original_label"] = result["label"]
                    result["label"] = _flip_replay_label(str(result["label"]))
    return stress_samples


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
    stress_noise_rate: float = 0.0,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)

    corpus_path = output_dir / "wsp_failure_corpus.jsonl"
    corpus_manifest_path = output_dir / "wsp_failure_corpus_manifest.json"
    corpus_summary_path = output_dir / "wsp_failure_corpus_summary.json"
    labeled_path = output_dir / "wsp_failure_corpus_labeled.jsonl"
    labeled_manifest_path = output_dir / "wsp_failure_corpus_labeled_manifest.json"
    replay_summary_path = output_dir / "wsp_replay_summary.json"
    audit_benchmark_path = output_dir / "wsp_audit_benchmark.json"
    stress_labeled_path = output_dir / "wsp_stress_labeled_corpus.jsonl"
    stress_audit_benchmark_path = output_dir / "wsp_stress_audit_benchmark.json"
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

    stress_audit_benchmark = None
    if stress_noise_rate > 0:
        stress_samples = _apply_synthetic_label_noise(
            labeled_samples,
            noise_rate=stress_noise_rate,
            seed=seed + 2000,
        )
        write_world_model_dataset_jsonl(
            stress_samples,
            output_path=stress_labeled_path,
            dataset_id="wsp-failure-corpus-demo-stress-label-noise",
            metadata={
                "mode": "synthetic_ambiguity_label_noise",
                "stress_noise_rate": stress_noise_rate,
            },
        )
        stress_audit_benchmark = benchmark_audit_against_replay(stress_samples)
        _write_json(
            stress_audit_benchmark_path,
            {
                "ok": True,
                "mode": "synthetic_ambiguity_label_noise",
                "purpose": (
                    "This is not simulator truth. It deliberately perturbs replay labels to "
                    "show how perfect deterministic verification metrics degrade under ambiguous field labels."
                ),
                "stress_noise_rate": stress_noise_rate,
                "benchmark": stress_audit_benchmark,
            },
        )

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
        "validation_mode": "phase_1_deterministic_verification",
        "claim": (
            "WSP is an operational robotics data/eval compiler: it standardizes robot rollouts, "
            "runs deterministic executability checks against simulator-labeled transitions, "
            "trains baseline models, and blocks unsafe policy regressions in CI."
        ),
        "evidence_scope": (
            "These metrics verify the closed-loop compiler, adapter, schema, replay-label, model-training, "
            "and CI data flow on a deterministic synthetic corpus. They are not a production robustness claim."
        ),
        "limitations": [
            "The 1.000 audit precision/recall values are expected in this deterministic verification corpus.",
            "The learned model can exploit clean generator boundaries; the AUROC is a pipeline smoke result, not a real-world model benchmark.",
            "Noisy contact, solver ambiguity, calibration drift, missing telemetry, and multi-vendor log gaps still need real-data evaluation.",
        ],
        "next_milestone": (
            "Ingest noisy partner telemetry from ROS2/MCAP, MuJoCo/Genesis logs, and LeRobot-style episodes, "
            "then rerun the same WSP audit/model/CI loop against real ambiguous factory data."
        ),
        "stage_script": {
            "safe_claim": (
                "We have a working deterministic verification slice for robotics data/eval infrastructure."
            ),
            "do_not_claim": [
                "Do not claim production real-world precision/recall from this synthetic corpus.",
                "Do not claim this is a complete world model.",
                "Do not claim perfect contact physics generalization.",
            ],
            "pivot": (
                "The perfect numbers prove data-flow integrity; the product value is that the same pipeline "
                "can now accept messy logs and become a real evaluation gate."
            ),
        },
        "terminal_replay": [
            (
                "1. Deterministic verification: generated "
                f"{corpus_summary['sample_count']} WSP transitions with "
                f"{corpus_summary['rejected_count']} fixed-failure rollouts."
            ),
            (
                "2. Attached MuJoCo/Genesis export-oracle labels with agreement rate "
                f"{replay_summary['audit_replay_agreement_rate']:.3f} to check schema/data-flow integrity."
            ),
            (
                "3. Fixed-failure audit precision="
                f"{audit_benchmark['invalid_detection']['precision']:.3f}, recall="
                f"{audit_benchmark['invalid_detection']['recall']:.3f}; this is not a real-world robustness score."
            ),
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
    if stress_audit_benchmark is not None:
        summary["stress_test"] = {
            "mode": "synthetic_ambiguity_label_noise",
            "purpose": (
                "Optional presentation guardrail: shows that the perfect deterministic metrics are not "
                "being pitched as real-world performance."
            ),
            "stress_noise_rate": stress_noise_rate,
            "audit_precision": stress_audit_benchmark["invalid_detection"]["precision"],
            "audit_recall": stress_audit_benchmark["invalid_detection"]["recall"],
            "unsafe_false_negative_rate": stress_audit_benchmark["invalid_detection"]["false_negative_rate"],
        }
        summary["artifacts"]["stress_labeled_corpus"] = str(stress_labeled_path)
        summary["artifacts"]["stress_audit_benchmark"] = str(stress_audit_benchmark_path)
    _write_json(summary_path, summary)
    return summary
