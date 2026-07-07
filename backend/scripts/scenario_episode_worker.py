"""Run one scenario episode on one simulator backend and write rollout artifacts.

Usage:
    python -m backend.scripts.scenario_episode_worker \
        --scenario scenarios/carton_sorting_0001 --sim mujoco \
        --episode-manifest manifest.json --out out/episodes/0

Artifacts written to --out: trace.ndjson, decisions.ndjson (world-rollout
record formats, sha256 digests in the report), report.json.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from backend.models.scenario import EpisodeManifest
from backend.services.scenario_loader import ScenarioLoadError, load_scenario
from backend.services.scenario_runtime.episode_runner import run_episode

SCENARIO_WORKER_BACKENDS = ("mujoco", "genesis")


def _build_backend(sim: str, scenario, scenario_path: str):
    if sim == "mujoco":
        from backend.services.sim_backends.mujoco_backend import build_mujoco_backend

        return build_mujoco_backend(scenario, scenario_path)
    if sim == "genesis":
        from backend.services.sim_backends.genesis_backend import build_genesis_backend

        return build_genesis_backend(scenario, scenario_path)
    raise ValueError(f"Unsupported simulator backend: {sim}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", required=True)
    parser.add_argument("--sim", required=True, choices=SCENARIO_WORKER_BACKENDS)
    parser.add_argument("--episode-manifest", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    output_dir = Path(args.out)
    try:
        scenario = load_scenario(args.scenario)
        manifest = EpisodeManifest.model_validate_json(
            Path(args.episode_manifest).read_text(encoding="utf-8")
        )
        backend = _build_backend(args.sim, scenario, args.scenario)
        result = run_episode(
            scenario=scenario,
            manifest=manifest,
            backend=backend,
            output_dir=output_dir,
        )
    except (ScenarioLoadError, ValueError) as exc:
        print(f"scenario episode worker failed: {exc}", file=sys.stderr)
        return 1

    report_path = output_dir / "report.json"
    report_path.write_text(json.dumps(result.to_report(), indent=2), encoding="utf-8")
    print(
        f"episode {result.episode_index} [{result.backend_id}] "
        f"success={result.success} stop_reason={result.stop_reason} "
        f"steps={result.steps} sim_time_s={result.sim_time_s:.2f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
