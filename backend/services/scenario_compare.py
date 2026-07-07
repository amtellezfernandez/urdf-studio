from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

SCENARIO_COMPARISON_SCHEMA = "scenario_comparison_report.v1"


def build_comparison_report(
    *,
    scenario_id: str,
    per_sim_reports: dict[str, list[dict[str, Any] | None]],
    per_sim_errors: dict[str, list[str]],
) -> dict[str, Any]:
    """Aggregate per-sim episode reports into the cross-simulator comparison.

    ``per_sim_reports[sim][episode]`` is an episode report dict (or None when
    that episode failed to run). Divergence metrics compare each simulator
    pair on episodes both completed.
    """
    backends = sorted(per_sim_reports)
    summary = {
        backend: _summarize_backend(reports)
        for backend, reports in per_sim_reports.items()
    }
    divergence = {}
    for index, backend_a in enumerate(backends):
        for backend_b in backends[index + 1:]:
            divergence[f"{backend_a}_vs_{backend_b}"] = _pair_divergence(
                per_sim_reports[backend_a], per_sim_reports[backend_b]
            )
    return {
        "schema": SCENARIO_COMPARISON_SCHEMA,
        "scenario_id": scenario_id,
        "backends": backends,
        "summary": summary,
        "divergence": divergence,
        "errors": {backend: errors for backend, errors in per_sim_errors.items() if errors},
    }


def _summarize_backend(reports: list[dict[str, Any] | None]) -> dict[str, Any]:
    completed = [report for report in reports if report is not None]
    successes = [report for report in completed if report.get("success")]
    times = [report.get("sim_time_s", 0.0) for report in successes]
    return {
        "episodes": len(reports),
        "completed": len(completed),
        "success_count": len(successes),
        "success_rate": (len(successes) / len(completed)) if completed else 0.0,
        "mean_time_to_success_s": (sum(times) / len(times)) if times else None,
        "stop_reasons": _count_values(completed, "stop_reason"),
        "grasp_attach_used": any(report.get("grasp_attach_used") for report in completed),
    }


def _count_values(reports: list[dict[str, Any]], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for report in reports:
        value = str(report.get(key))
        counts[value] = counts.get(value, 0) + 1
    return counts


def _pair_divergence(
    reports_a: list[dict[str, Any] | None],
    reports_b: list[dict[str, Any] | None],
) -> dict[str, Any]:
    episodes = []
    agreements = 0
    compared = 0
    for episode_index, (report_a, report_b) in enumerate(zip(reports_a, reports_b)):
        if report_a is None or report_b is None:
            continue
        compared += 1
        agree = bool(report_a.get("success")) == bool(report_b.get("success"))
        agreements += int(agree)
        episodes.append(
            {
                "episode_index": episode_index,
                "success_agreement": agree,
                "final_object_pose_delta": _final_pose_deltas(report_a, report_b),
                "final_joint_rmse_rad": _joint_rmse(report_a, report_b),
            }
        )
    return {
        "compared_episodes": compared,
        "success_agreement_rate": (agreements / compared) if compared else None,
        "episodes": episodes,
    }


def _final_pose_deltas(
    report_a: dict[str, Any], report_b: dict[str, Any]
) -> dict[str, dict[str, float]]:
    poses_a = report_a.get("final_object_poses", {})
    poses_b = report_b.get("final_object_poses", {})
    deltas: dict[str, dict[str, float]] = {}
    for object_id in sorted(set(poses_a) & set(poses_b)):
        position_a = poses_a[object_id]["position_xyz"]
        position_b = poses_b[object_id]["position_xyz"]
        position_delta = math.sqrt(
            sum((a - b) ** 2 for a, b in zip(position_a, position_b))
        )
        quat_a = poses_a[object_id]["quat_wxyz"]
        quat_b = poses_b[object_id]["quat_wxyz"]
        # Quaternion distance invariant to sign.
        dot = abs(sum(a * b for a, b in zip(quat_a, quat_b)))
        quat_angle_rad = 2.0 * math.acos(min(1.0, max(-1.0, dot)))
        deltas[object_id] = {
            "position_m": position_delta,
            "rotation_rad": quat_angle_rad,
        }
    return deltas


def _joint_rmse(report_a: dict[str, Any], report_b: dict[str, Any]) -> float | None:
    joints_a = report_a.get("final_joint_positions", {})
    joints_b = report_b.get("final_joint_positions", {})
    shared = sorted(set(joints_a) & set(joints_b))
    if not shared:
        return None
    return math.sqrt(
        sum((joints_a[name] - joints_b[name]) ** 2 for name in shared) / len(shared)
    )


def write_comparison_report(report: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")


def format_comparison_table(report: dict[str, Any]) -> str:
    lines = [f"scenario: {report['scenario_id']}"]
    header = f"{'backend':<10} {'episodes':>8} {'success':>8} {'rate':>6} {'mean_t_s':>9}"
    lines.append(header)
    lines.append("-" * len(header))
    for backend in report["backends"]:
        summary = report["summary"][backend]
        mean_time = summary["mean_time_to_success_s"]
        lines.append(
            f"{backend:<10} {summary['completed']:>8} {summary['success_count']:>8} "
            f"{summary['success_rate']:>6.2f} "
            f"{mean_time:>9.2f}" if mean_time is not None else
            f"{backend:<10} {summary['completed']:>8} {summary['success_count']:>8} "
            f"{summary['success_rate']:>6.2f} {'-':>9}"
        )
    for pair, data in report["divergence"].items():
        rate = data["success_agreement_rate"]
        lines.append(
            f"{pair}: agreement={rate if rate is not None else '-'} "
            f"episodes={data['compared_episodes']}"
        )
        for episode in data["episodes"]:
            for object_id, delta in episode["final_object_pose_delta"].items():
                lines.append(
                    f"  ep{episode['episode_index']} {object_id}: "
                    f"Δpos={delta['position_m']*1000:.1f}mm "
                    f"Δrot={math.degrees(delta['rotation_rad']):.1f}°"
                )
    return "\n".join(lines)
