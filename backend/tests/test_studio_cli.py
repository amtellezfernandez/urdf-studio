"""Unified urdf-studio CLI: dispatch, doctor, and the repro cycle."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.cli import _compare_outcomes, main as cli_main

REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIO_DIR = REPO_ROOT / "scenarios" / "carton_sorting_0001"


def test_doctor_reports_runtime_health(capsys) -> None:
    exit_code = cli_main(["doctor"])

    output = capsys.readouterr().out
    assert "mujoco" in output
    assert "OpenUSD interchange" in output
    assert exit_code in (0, 1)


def test_scenario_validate_dispatches(capsys) -> None:
    exit_code = cli_main(["scenario", "validate", str(SCENARIO_DIR)])

    assert exit_code == 0
    assert "OK: carton_sorting_0001" in capsys.readouterr().out


def test_world_usd_export_dispatches(tmp_path: Path) -> None:
    pytest.importorskip("pxr")
    world_package = SCENARIO_DIR / "carton-sorting.world-package.json"

    exit_code = cli_main(["world", "usd-export", str(world_package), str(tmp_path / "carton.usda")])

    assert exit_code == 0
    assert (tmp_path / "carton.usda").is_file()


def test_scenario_run_then_repro_verifies_outcomes(tmp_path: Path) -> None:
    pytest.importorskip("mujoco")
    run_dir = tmp_path / "run"
    repro_dir = tmp_path / "repro"

    run_code = cli_main(
        ["scenario", "run", str(SCENARIO_DIR), "--sim", "mujoco", "--out", str(run_dir)]
    )
    assert run_code == 0
    run_manifest = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    assert run_manifest["schema"] == "scenario_run.v1"
    assert run_manifest["sims"] == ["mujoco"]
    assert (run_dir / "scenario" / "scenario.yaml").is_file()  # frozen copy
    episode_report = json.loads(
        (run_dir / "mujoco" / "episode-0" / "report.json").read_text(encoding="utf-8")
    )
    assert episode_report["environment"]["packages"].get("mujoco")

    repro_code = cli_main(["scenario", "repro", str(run_dir), "--out", str(repro_dir)])

    assert repro_code == 0
    repro_comparison = json.loads((repro_dir / "comparison.json").read_text(encoding="utf-8"))
    original_comparison = json.loads((run_dir / "comparison.json").read_text(encoding="utf-8"))
    assert repro_comparison["summary"] == original_comparison["summary"]


def test_repro_rejects_non_run_directories(tmp_path: Path, capsys) -> None:
    exit_code = cli_main(["scenario", "repro", str(tmp_path), "--out", str(tmp_path / "x")])

    assert exit_code == 1
    assert "missing run.json" in capsys.readouterr().err


def test_compare_outcomes_flags_divergence() -> None:
    original = {
        "backends": ["mujoco"],
        "summary": {
            "mujoco": {"completed": 1, "success_count": 1, "stop_reasons": {"success": 1}}
        },
    }
    diverged = {
        "summary": {
            "mujoco": {"completed": 1, "success_count": 0, "stop_reasons": {"timeout": 1}}
        }
    }

    mismatches = _compare_outcomes(original, diverged)

    assert any("success_count" in line for line in mismatches)
    assert _compare_outcomes(original, original) == []
