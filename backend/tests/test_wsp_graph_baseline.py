from __future__ import annotations

import json
import subprocess
import sys

from backend.services.world_model_dataset import write_world_model_dataset_jsonl
from backend.services.wsp_failure_corpus import generate_wsp_failure_corpus_samples
from backend.services.wsp_graph_baseline import (
    WSP_GRAPH_BASELINE_SCHEMA_VERSION,
    train_wsp_graph_baseline,
)
from backend.services.wsp_replay_label import replay_label_samples


def _labeled_samples():
    samples = generate_wsp_failure_corpus_samples(
        count=96,
        failure_modes="collision,contact,joint,battery,reachability",
        valid_ratio=0.25,
        seed=31,
    )
    return replay_label_samples(samples, targets="mujoco,genesis")


def test_wsp_graph_baseline_trains_and_reports_eval_metrics() -> None:
    report, model = train_wsp_graph_baseline(
        _labeled_samples(),
        dataset_id="graph-baseline-smoke",
        epochs=20,
        hidden_dim=24,
        seed=11,
    )

    assert report["success"] is True
    assert report["schema_version"] == WSP_GRAPH_BASELINE_SCHEMA_VERSION
    assert model["schema_version"] == WSP_GRAPH_BASELINE_SCHEMA_VERSION
    assert report["sample_count"] == 96
    assert 0.0 <= report["metrics"]["invalid_action"]["auroc"] <= 1.0
    assert report["metrics"]["next_state"]["position_mean_absolute_error_m"] >= 0.0
    assert report["metrics"]["failure_type"]["evaluated_count"] > 0
    assert report["metrics"]["training"]["final_loss"] is not None


def test_train_wsp_model_cli_writes_report_and_model(tmp_path) -> None:
    dataset_path = tmp_path / "labeled.jsonl"
    report_path = tmp_path / "wsp-report.json"
    model_path = tmp_path / "wsp-model.json"
    write_world_model_dataset_jsonl(
        _labeled_samples(),
        output_path=dataset_path,
        dataset_id="graph-baseline-cli",
    )

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "backend.scripts.wsp_train_wsp_model",
            str(dataset_path),
            "--dataset-id",
            "graph-baseline-cli",
            "--out",
            str(report_path),
            "--model-out",
            str(model_path),
            "--epochs",
            "20",
            "--hidden-dim",
            "24",
            "--min-auroc",
            "0.0",
            "--max-unsafe-fn-rate",
            "1.0",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
    report = json.loads(report_path.read_text(encoding="utf-8"))
    model = json.loads(model_path.read_text(encoding="utf-8"))
    assert report["success"] is True
    assert model["model_type"] == "entity_graph_action_conditioned_baseline"
