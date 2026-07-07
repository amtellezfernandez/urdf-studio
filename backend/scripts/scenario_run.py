"""Run a scenario across one or more simulator backends and compare results.

Usage:
    python -m backend.scripts.scenario_run scenarios/carton_sorting_0001 \
        --sim mujoco --sim genesis --out reports/scenario-runs/carton

Each (simulator, episode) runs in its own worker subprocess
(backend.scripts.scenario_episode_worker) for crash isolation; a per-sim
python override (STUDIO_<SIM>_PYTHON) is honored so simulators with
conflicting dependencies can run from their own environments. Episode
initial conditions are sampled once and shared across simulators.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from backend.services.scenario_compare import (
    build_comparison_report,
    format_comparison_table,
    write_comparison_report,
)
from backend.services.scenario_loader import (
    ScenarioLoadError,
    load_scenario,
    load_scenario_world,
)
from backend.services.scenario_runtime.randomization import sample_episode_manifests

SCENARIO_RUN_BACKENDS = ("mujoco", "genesis")
_WORKER_TIMEOUT_S = 1800


def _worker_python(sim: str) -> str:
    override = os.environ.get(f"STUDIO_{sim.upper()}_PYTHON", "").strip()
    return override or sys.executable


def _run_worker(
    *,
    sim: str,
    scenario_path: Path,
    manifest_path: Path,
    out_dir: Path,
) -> tuple[dict | None, str | None]:
    command = [
        _worker_python(sim),
        "-m",
        "backend.scripts.scenario_episode_worker",
        "--scenario",
        str(scenario_path),
        "--sim",
        sim,
        "--episode-manifest",
        str(manifest_path),
        "--out",
        str(out_dir),
    ]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=_WORKER_TIMEOUT_S,
            cwd=str(Path(__file__).resolve().parents[2]),
        )
    except subprocess.TimeoutExpired:
        return None, f"{sim} worker timed out after {_WORKER_TIMEOUT_S}s"
    report_path = out_dir / "report.json"
    if completed.returncode != 0 or not report_path.is_file():
        tail = "\n".join(completed.stderr.strip().splitlines()[-5:])
        return None, f"{sim} worker exited {completed.returncode}: {tail}"
    return json.loads(report_path.read_text(encoding="utf-8")), None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenario", help="Path to a scenario.yaml file or its directory")
    parser.add_argument(
        "--sim",
        action="append",
        choices=SCENARIO_RUN_BACKENDS,
        required=True,
        help="Simulator backend (repeat for cross-sim comparison)",
    )
    parser.add_argument("--out", required=True, help="Output directory for run artifacts")
    parser.add_argument("--episodes", type=int, default=None, help="Override evaluation.episodes")
    args = parser.parse_args(argv)

    scenario_path = Path(args.scenario).resolve()
    out_root = Path(args.out)
    try:
        scenario = load_scenario(scenario_path)
        world = load_scenario_world(scenario_path, scenario)
        if args.episodes is not None:
            scenario = scenario.model_copy(
                update={
                    "evaluation": scenario.evaluation.model_copy(
                        update={"episodes": args.episodes}
                    )
                }
            )
        manifests = sample_episode_manifests(scenario, world)
    except ScenarioLoadError as exc:
        print(f"scenario run failed: {exc}", file=sys.stderr)
        return 1

    manifest_dir = out_root / "manifests"
    manifest_dir.mkdir(parents=True, exist_ok=True)
    manifest_paths: list[Path] = []
    for manifest in manifests:
        manifest_path = manifest_dir / f"episode-{manifest.episode_index}.json"
        manifest_path.write_text(manifest.model_dump_json(indent=2), encoding="utf-8")
        manifest_paths.append(manifest_path)

    sims = list(dict.fromkeys(args.sim))
    per_sim_reports: dict[str, list[dict | None]] = {sim: [] for sim in sims}
    per_sim_errors: dict[str, list[str]] = {sim: [] for sim in sims}
    for sim in sims:
        for manifest, manifest_path in zip(manifests, manifest_paths):
            episode_dir = out_root / sim / f"episode-{manifest.episode_index}"
            report, error = _run_worker(
                sim=sim,
                scenario_path=scenario_path,
                manifest_path=manifest_path,
                out_dir=episode_dir,
            )
            per_sim_reports[sim].append(report)
            if error:
                per_sim_errors[sim].append(error)
                print(f"[scenario-run] {error}", file=sys.stderr)
            else:
                print(
                    f"[scenario-run] {sim} episode {manifest.episode_index}: "
                    f"success={report['success']} stop_reason={report['stop_reason']} "
                    f"sim_time_s={report['sim_time_s']:.2f}"
                )

    comparison = build_comparison_report(
        scenario_id=scenario.scenario_id,
        per_sim_reports=per_sim_reports,
        per_sim_errors=per_sim_errors,
    )
    comparison_path = out_root / "comparison.json"
    write_comparison_report(comparison, comparison_path)
    print()
    print(format_comparison_table(comparison))
    print(f"\ncomparison report: {comparison_path}")
    any_completed = any(
        report is not None for reports in per_sim_reports.values() for report in reports
    )
    return 0 if any_completed else 1


if __name__ == "__main__":
    raise SystemExit(main())
