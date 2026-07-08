"""Self-contained HTML comparison report generation."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

pytest.importorskip("mujoco")

from backend.scripts.scenario_run import main as scenario_run_main
from backend.services.scenario_report_html import (
    ScenarioReportError,
    build_run_report_html,
    write_run_report_html,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIO_DIR = REPO_ROOT / "scenarios" / "carton_sorting_0001"


def _run(tmp_path: Path) -> Path:
    run_dir = tmp_path / "run"
    assert scenario_run_main([str(SCENARIO_DIR), "--sim", "mujoco", "--out", str(run_dir)]) == 0
    return run_dir


def _embedded_data(html: str) -> dict:
    match = re.search(
        r'<script id="report-data" type="application/json">(.*?)</script>', html, re.S
    )
    assert match is not None
    return json.loads(match.group(1))


def test_scenario_run_auto_emits_self_contained_report(tmp_path: Path) -> None:
    run_dir = _run(tmp_path)

    report_path = run_dir / "report.html"
    assert report_path.is_file()
    html = report_path.read_text(encoding="utf-8")
    # Self-contained: no external network references.
    assert "http://" not in html and "https://" not in html
    assert "<canvas" in html


def test_report_embeds_trajectories_and_summary(tmp_path: Path) -> None:
    run_dir = _run(tmp_path)

    data = _embedded_data(build_run_report_html(run_dir))

    assert data["schema"] == "scenario_report_html.v1"
    assert "mujoco" in data["backends"]
    assert data["movable_ids"] == ["carton_1"]
    # static scene present as outlines
    assert any(obj["fixed"] for obj in data["scene_objects"])
    episode = data["episodes"][0]
    trajectory = episode["backends"]["mujoco"]["trajectory"]
    assert len(trajectory["t_ms"]) > 1
    carton_frames = trajectory["objects"]["carton_1"]
    # carton actually moves toward the bin over the episode
    assert carton_frames[0][:3] != carton_frames[-1][:3]
    assert data["summary"]["mujoco"]["success_count"] == 1
    assert data["environment"]["packages"].get("mujoco")


def test_report_downsamples_long_trajectories(tmp_path: Path) -> None:
    run_dir = _run(tmp_path)

    data = _embedded_data(build_run_report_html(run_dir))

    for episode in data["episodes"]:
        for backend in data["backends"]:
            trajectory = episode["backends"][backend]["trajectory"]
            assert len(trajectory["t_ms"]) <= 241  # capped near _MAX_TRAJECTORY_SAMPLES


def test_report_write_helper_defaults_into_run_dir(tmp_path: Path) -> None:
    run_dir = _run(tmp_path)
    (run_dir / "report.html").unlink()

    output = write_run_report_html(run_dir)

    assert output == run_dir / "report.html"
    assert output.is_file()


def test_report_rejects_non_run_directory(tmp_path: Path) -> None:
    with pytest.raises(ScenarioReportError, match="missing run.json"):
        build_run_report_html(tmp_path)
