from __future__ import annotations

import json
import subprocess
import sys


def test_wsp_loop_gate_runs_real_cli_pipeline(tmp_path) -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "backend.scripts.wsp_loop_gate",
            "--iterations",
            "1",
            "--out-dir",
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
    summary = json.loads(result.stdout)
    assert summary["ok"] is True
    assert summary["iterations"] == 1
    assert len(summary["iteration_results"]) == 1
    metrics = summary["iteration_results"][0]["metrics"]
    assert metrics["sample_count"] >= 4
    assert metrics["executable_count"] >= 1
    assert metrics["rejected_count"] >= 1
    assert metrics["observed_trace_id"] == "observed-pallet-push-001"
    assert metrics["mujoco_max_position_error_m"] <= 1e-6
    assert metrics["baseline_mean_absolute_error"] >= 0.0
