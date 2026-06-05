from __future__ import annotations

import json
from pathlib import Path
from typing import Any


MODEL_LIFT_SCHEMA_VERSION = "wsp-model-lift-report-v1"


def _safe_divide(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0


def _metric(report: dict[str, Any], path: tuple[str, ...]) -> float:
    value: Any = report
    for key in path:
        value = value[key]
    return float(value)


def compare_raw_vs_wsp_model_lift(
    *,
    raw_report: dict[str, Any],
    wsp_report: dict[str, Any],
    min_auroc_lift: float = 0.0,
    min_unsafe_fn_reduction: float = 0.0,
    require_wsp_position_mae_not_worse: bool = False,
) -> dict[str, Any]:
    raw_auroc = _metric(raw_report, ("metrics", "invalid_action", "auroc"))
    wsp_auroc = _metric(wsp_report, ("metrics", "invalid_action", "auroc"))
    raw_unsafe_fn = _metric(raw_report, ("metrics", "invalid_action", "unsafe_false_negative_rate"))
    wsp_unsafe_fn = _metric(wsp_report, ("metrics", "invalid_action", "unsafe_false_negative_rate"))
    raw_failure_accuracy = _metric(raw_report, ("metrics", "failure_type", "accuracy"))
    wsp_failure_accuracy = _metric(wsp_report, ("metrics", "failure_type", "accuracy"))
    raw_position_mae = _metric(raw_report, ("metrics", "next_state", "position_mean_absolute_error_m"))
    wsp_position_mae = _metric(wsp_report, ("metrics", "next_state", "position_mean_absolute_error_m"))

    auroc_lift = wsp_auroc - raw_auroc
    unsafe_fn_reduction = raw_unsafe_fn - wsp_unsafe_fn
    failure_type_accuracy_lift = wsp_failure_accuracy - raw_failure_accuracy
    position_mae_reduction = raw_position_mae - wsp_position_mae
    errors: list[str] = []
    if auroc_lift < min_auroc_lift:
        errors.append(f"AUROC lift {auroc_lift:.6g} below threshold {min_auroc_lift:.6g}.")
    if unsafe_fn_reduction < min_unsafe_fn_reduction:
        errors.append(
            "unsafe false-negative reduction "
            f"{unsafe_fn_reduction:.6g} below threshold {min_unsafe_fn_reduction:.6g}."
        )
    if require_wsp_position_mae_not_worse and position_mae_reduction < 0:
        errors.append(
            f"WSP position MAE {wsp_position_mae:.6g} is worse than raw {raw_position_mae:.6g}."
        )

    return {
        "ok": not errors,
        "schema_version": MODEL_LIFT_SCHEMA_VERSION,
        "errors": errors,
        "raw_log_baseline": {
            "schema_version": raw_report.get("schema_version"),
            "model_type": raw_report.get("model_type"),
            "sample_count": raw_report.get("sample_count"),
            "eval_sample_count": raw_report.get("eval_sample_count"),
            "metrics": {
                "invalid_action_auroc": raw_auroc,
                "unsafe_false_negative_rate": raw_unsafe_fn,
                "failure_type_accuracy": raw_failure_accuracy,
                "position_mae_m": raw_position_mae,
            },
        },
        "wsp_model": {
            "schema_version": wsp_report.get("schema_version"),
            "model_type": wsp_report.get("model_type"),
            "sample_count": wsp_report.get("sample_count"),
            "eval_sample_count": wsp_report.get("eval_sample_count"),
            "metrics": {
                "invalid_action_auroc": wsp_auroc,
                "unsafe_false_negative_rate": wsp_unsafe_fn,
                "failure_type_accuracy": wsp_failure_accuracy,
                "position_mae_m": wsp_position_mae,
            },
        },
        "relative_improvement": {
            "invalid_action_auroc_lift": auroc_lift,
            "invalid_action_auroc_relative_lift": _safe_divide(auroc_lift, raw_auroc),
            "unsafe_false_negative_rate_reduction": unsafe_fn_reduction,
            "unsafe_false_negative_rate_relative_reduction": _safe_divide(unsafe_fn_reduction, raw_unsafe_fn),
            "failure_type_accuracy_lift": failure_type_accuracy_lift,
            "failure_type_accuracy_relative_lift": _safe_divide(failure_type_accuracy_lift, raw_failure_accuracy),
            "position_mae_reduction_m": position_mae_reduction,
            "position_mae_relative_reduction": _safe_divide(position_mae_reduction, raw_position_mae),
        },
    }


def load_json_report(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_model_lift_report(report: dict[str, Any], *, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
