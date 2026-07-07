"""In-repo world-rollout runner implementing the WorldRolloutService CLI contract.

Invoked by backend/services/world_rollouts.py as:
    <executable> --campaign <job_dir>/campaign.json --out <job_dir>/out

Point URDF_WORLD_ROLLOUT_CLI at tools/world_rollout_cli.sh (an executable
wrapper that execs this module) to make scenario episodes the rollout runner:
the job's campaign selects a scenario via rollout_params, episodes run on the
requested simulator backend, and the trace/decision NDJSON artifacts are
digest-signed exactly as the service verifies them.

Campaign rollout_params contract:
    {"scenario": "scenarios/carton_sorting_0001",   # required (repo-relative or absolute)
     "sim": "mujoco",                                # optional, default mujoco
     "episodes": 1}                                  # optional, overrides evaluation.episodes
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

WORLD_ROLLOUT_TRACE_FILENAME = "trace.ndjson"
WORLD_ROLLOUT_DECISIONS_FILENAME = "decisions.ndjson"


def _fail(message: str) -> int:
    print(f"world rollout cli failed: {message}", file=sys.stderr)
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--campaign", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    from backend.models.world_rollouts import (
        WorldRolloutArtifactRef,
        WorldRolloutCampaignManifest,
    )
    from backend.models.scenario import ScenarioDocument
    from backend.services.scenario_loader import (
        ScenarioLoadError,
        load_scenario,
        load_scenario_world,
        resolve_scenario_asset_path,
    )
    from backend.services.scenario_runtime.randomization import sample_episode_manifests
    from backend.services.world_rollout_params import (
        WORLD_ROLLOUT_INPUT_WORLD_PACKAGE_FILENAME,
        WORLD_ROLLOUT_OUTPUT_CAMPAIGN_FILENAME,
    )

    campaign_path = Path(args.campaign).resolve()
    output_dir = Path(args.out).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        campaign = WorldRolloutCampaignManifest.model_validate_json(
            campaign_path.read_text(encoding="utf-8")
        )
    except (OSError, ValueError) as exc:
        return _fail(f"invalid campaign manifest: {exc}")

    rollout_params = campaign.rollout_params or {}
    scenario_ref = rollout_params.get("scenario")
    if not isinstance(scenario_ref, str) or not scenario_ref.strip():
        return _fail("campaign rollout_params.scenario is required")
    sim = str(rollout_params.get("sim", "mujoco"))
    scenario_source = Path(scenario_ref)
    if not scenario_source.is_absolute():
        scenario_source = REPO_ROOT / scenario_source
    if scenario_source.is_file():
        scenario_source = scenario_source.parent
    if not scenario_source.is_dir():
        return _fail(f"scenario directory not found: {scenario_source}")

    # The campaign's world package is authoritative: stage a scenario copy whose
    # world.package file is replaced by the job's world_package.json.
    staged_scenario_dir = output_dir / "scenario"
    if staged_scenario_dir.exists():
        shutil.rmtree(staged_scenario_dir)
    shutil.copytree(scenario_source, staged_scenario_dir)
    try:
        scenario = load_scenario(staged_scenario_dir)
        world_package_path = campaign_path.parent / WORLD_ROLLOUT_INPUT_WORLD_PACKAGE_FILENAME
        if world_package_path.is_file():
            staged_world_path = resolve_scenario_asset_path(
                staged_scenario_dir, scenario.world.package
            )
            staged_world_path.write_bytes(world_package_path.read_bytes())
        episodes_override = rollout_params.get("episodes")
        if isinstance(episodes_override, int) and episodes_override >= 1:
            scenario = scenario.model_copy(
                update={
                    "evaluation": scenario.evaluation.model_copy(
                        update={"episodes": episodes_override}
                    )
                }
            )
        world = load_scenario_world(staged_scenario_dir, scenario)
        manifests = sample_episode_manifests(scenario, world)
    except ScenarioLoadError as exc:
        return _fail(str(exc))

    episode_reports = []
    for manifest in manifests:
        episode_dir = output_dir / "episodes" / str(manifest.episode_index)
        result = _run_episode(scenario, staged_scenario_dir, sim, manifest, episode_dir)
        if result is None:
            return _fail(f"episode {manifest.episode_index} failed on {sim}")
        episode_reports.append(result)

    trace_digest, trace_count = _merge_ndjson(
        [output_dir / "episodes" / str(m.episode_index) / "trace.ndjson" for m in manifests],
        output_dir / WORLD_ROLLOUT_TRACE_FILENAME,
    )
    decisions_digest, decision_count = _merge_ndjson(
        [output_dir / "episodes" / str(m.episode_index) / "decisions.ndjson" for m in manifests],
        output_dir / WORLD_ROLLOUT_DECISIONS_FILENAME,
    )

    output_campaign = campaign.model_copy(
        update={
            "rollout_params": {
                **rollout_params,
                "results": {
                    "backend_id": sim,
                    "episodes": len(episode_reports),
                    "success_count": sum(1 for r in episode_reports if r.get("success")),
                    "stop_reasons": [r.get("stop_reason") for r in episode_reports],
                },
            },
            "artifacts": [
                *campaign.artifacts,
                WorldRolloutArtifactRef(
                    kind="trace_ndjson",
                    uri=WORLD_ROLLOUT_TRACE_FILENAME,
                    digest_sha256=trace_digest,
                    metadata={"record_count": trace_count},
                ),
                WorldRolloutArtifactRef(
                    kind="decisions_ndjson",
                    uri=WORLD_ROLLOUT_DECISIONS_FILENAME,
                    digest_sha256=decisions_digest,
                    metadata={"record_count": decision_count},
                ),
            ],
        }
    )
    output_manifest_path = output_dir / WORLD_ROLLOUT_OUTPUT_CAMPAIGN_FILENAME
    output_manifest_path.write_text(
        output_campaign.model_dump_json(indent=2), encoding="utf-8"
    )
    print(
        f"world rollout complete: {len(episode_reports)} episode(s) on {sim}, "
        f"{trace_count} trace records, {decision_count} decisions"
    )
    return 0


def _run_episode(scenario, scenario_dir, sim, manifest, episode_dir) -> dict | None:
    from backend.scripts.scenario_episode_worker import _build_backend
    from backend.services.scenario_policies import build_scenario_policy
    from backend.services.scenario_runtime.episode_runner import run_episode

    try:
        backend = _build_backend(sim, scenario, scenario_dir)
        policy = build_scenario_policy(scenario, scenario_dir)
        result = run_episode(
            scenario=scenario,
            manifest=manifest,
            backend=backend,
            output_dir=episode_dir,
            policy=policy,
        )
    except Exception as exc:  # noqa: BLE001 — episode failures become job failures
        print(f"episode {manifest.episode_index} error: {exc}", file=sys.stderr)
        return None
    report = result.to_report()
    (episode_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def _merge_ndjson(sources: list[Path], target: Path) -> tuple[str, int]:
    """Concatenate per-episode NDJSON files, tagging records with episode_index."""
    digest = hashlib.sha256()
    count = 0
    with target.open("wb") as handle:
        for episode_index, source in enumerate(sources):
            if not source.is_file():
                continue
            for line in source.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                record = json.loads(line)
                metadata = record.get("metadata") or {}
                metadata["episode_index"] = episode_index
                record["metadata"] = metadata
                data = json.dumps(record, separators=(",", ":")).encode("utf-8") + b"\n"
                handle.write(data)
                digest.update(data)
                count += 1
    return digest.hexdigest(), count


if __name__ == "__main__":
    raise SystemExit(main())
