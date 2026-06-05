from __future__ import annotations

import json
import subprocess
import sys

from backend.services.wsp_ci_report import CI_REPORT_SCHEMA_VERSION, build_wsp_ci_report


def _policy_report(*, ok: bool, recommendation: str, invalid_rate_increase: float):
    return {
        "ok": ok,
        "schema_version": "wsp-policy-regression-eval-v1",
        "recommendation": recommendation,
        "errors": ["invalid rollout rate increased"] if not ok else [],
        "baseline": {"invalid_rate": 0.04},
        "candidate": {"invalid_rate": 0.04 + invalid_rate_increase},
        "regression": {
            "invalid_rate_increase": invalid_rate_increase,
            "invalid_count_delta": 4,
            "new_failure_case_count": 0,
            "new_failure_modes": {},
            "failure_type_deltas": {"contact_instability": 4},
        },
    }


def test_ci_report_blocks_policy_eval_failures() -> None:
    report = build_wsp_ci_report(
        policy_report=_policy_report(ok=False, recommendation="block", invalid_rate_increase=0.08),
    )

    assert report["schema_version"] == CI_REPORT_SCHEMA_VERSION
    assert report["status"] == "BLOCK"
    assert report["ok"] is False
    assert report["annotations"][0]["level"] == "error"


def test_ci_report_warns_reviewable_metric_changes() -> None:
    report = build_wsp_ci_report(
        policy_report=_policy_report(ok=True, recommendation="review", invalid_rate_increase=0.01),
        warn_invalid_rate_increase=0.0,
    )

    assert report["status"] == "WARN"
    assert report["ok"] is True
    assert report["annotations"][0]["level"] == "warning"


def test_ci_report_cli_returns_nonzero_for_block(tmp_path) -> None:
    policy_path = tmp_path / "policy.json"
    output_path = tmp_path / "ci.json"
    policy_path.write_text(
        json.dumps(_policy_report(ok=False, recommendation="block", invalid_rate_increase=0.08)),
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "backend.scripts.wsp_ci_report",
            "--policy-report",
            str(policy_path),
            "--out",
            str(output_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 1
    report = json.loads(output_path.read_text(encoding="utf-8"))
    assert report["status"] == "BLOCK"
