from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal


CI_REPORT_SCHEMA_VERSION = "wsp-ci-report-v1"
CiStatus = Literal["PASS", "WARN", "BLOCK"]


def build_wsp_ci_report(
    *,
    policy_report: dict[str, Any],
    warn_invalid_rate_increase: float = 0.0,
    warn_new_failure_cases: int = 0,
) -> dict[str, Any]:
    regression = policy_report.get("regression", {})
    invalid_rate_increase = float(regression.get("invalid_rate_increase", 0.0))
    new_failure_case_count = int(regression.get("new_failure_case_count", 0))
    annotations: list[dict[str, Any]] = []
    status: CiStatus = "PASS"
    if not policy_report.get("ok", False) or policy_report.get("recommendation") == "block":
        status = "BLOCK"
        for error in policy_report.get("errors", []):
            annotations.append({"level": "error", "message": str(error)})
    elif (
        invalid_rate_increase > warn_invalid_rate_increase
        or new_failure_case_count > warn_new_failure_cases
        or policy_report.get("recommendation") == "review"
    ):
        status = "WARN"
        annotations.append(
            {
                "level": "warning",
                "message": (
                    "Policy candidate changed WSP executability metrics; review before merge."
                ),
                "metrics": {
                    "invalid_rate_increase": invalid_rate_increase,
                    "new_failure_case_count": new_failure_case_count,
                },
            }
        )
    baseline = policy_report.get("baseline", {})
    candidate = policy_report.get("candidate", {})
    summary = (
        f"{status}: invalid rollout rate "
        f"{float(baseline.get('invalid_rate', 0.0)):.3f} -> "
        f"{float(candidate.get('invalid_rate', 0.0)):.3f}; "
        f"delta={invalid_rate_increase:.3f}."
    )
    return {
        "schema_version": CI_REPORT_SCHEMA_VERSION,
        "status": status,
        "ok": status != "BLOCK",
        "summary": summary,
        "annotations": annotations,
        "policy_report_schema_version": policy_report.get("schema_version"),
        "policy_recommendation": policy_report.get("recommendation"),
        "metrics": {
            "baseline_invalid_rate": float(baseline.get("invalid_rate", 0.0)),
            "candidate_invalid_rate": float(candidate.get("invalid_rate", 0.0)),
            "invalid_rate_increase": invalid_rate_increase,
            "invalid_count_delta": int(regression.get("invalid_count_delta", 0)),
            "new_failure_case_count": new_failure_case_count,
            "new_failure_modes": regression.get("new_failure_modes", {}),
            "failure_type_deltas": regression.get("failure_type_deltas", {}),
        },
    }


def load_policy_report(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_wsp_ci_report(report: dict[str, Any], *, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
