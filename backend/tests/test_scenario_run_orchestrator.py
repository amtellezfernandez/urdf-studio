"""Orchestrator integration: worker subprocesses + comparison report (MuJoCo only)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

pytest.importorskip("mujoco")

from backend.scripts.scenario_run import main as scenario_run_main

REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIO_DIR = REPO_ROOT / "scenarios" / "carton_sorting_0001"


def test_scenario_run_produces_comparison_report(tmp_path: Path) -> None:
    exit_code = scenario_run_main(
        [str(SCENARIO_DIR), "--sim", "mujoco", "--out", str(tmp_path)]
    )

    assert exit_code == 0
    comparison = json.loads((tmp_path / "comparison.json").read_text(encoding="utf-8"))
    assert comparison["schema"] == "scenario_comparison_report.v1"
    assert comparison["backends"] == ["mujoco"]
    summary = comparison["summary"]["mujoco"]
    assert summary["completed"] == 1
    assert summary["success_count"] == 1
    manifest = json.loads(
        (tmp_path / "manifests" / "episode-0.json").read_text(encoding="utf-8")
    )
    assert manifest["scenario_id"] == "carton_sorting_0001"
    episode_report = json.loads(
        (tmp_path / "mujoco" / "episode-0" / "report.json").read_text(encoding="utf-8")
    )
    assert episode_report["success"] is True
    assert (tmp_path / "mujoco" / "episode-0" / "trace.ndjson").is_file()
