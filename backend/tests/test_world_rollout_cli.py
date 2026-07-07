"""End-to-end: WorldRolloutService drives the in-repo scenario rollout CLI."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

pytest.importorskip("mujoco")

from backend.models.world_rollouts import (
    WorldRolloutCheckerProfile,
    WorldRolloutJobCreateRequest,
    WorldRolloutJobStatus,
)
from backend.services.world_rollouts import WorldRolloutCliConfig, WorldRolloutService
from backend.services.world_scene_package_compat import read_world_scene_registry_envelope

REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIO_DIR = REPO_ROOT / "scenarios" / "carton_sorting_0001"
CLI_WRAPPER = REPO_ROOT / "tools" / "world_rollout_cli.sh"

TEST_TIMEOUT_SECONDS = 600
TEST_MAX_OUTPUT_CHARS = 20000


def _carton_world_envelope():
    payload = json.loads(
        (SCENARIO_DIR / "carton-sorting.world-package.json").read_text(encoding="utf-8")
    )
    return read_world_scene_registry_envelope(payload)


def _checker_profile() -> WorldRolloutCheckerProfile:
    return WorldRolloutCheckerProfile(
        profile_id="scenario-success-checkers",
        target_id="carton_gantry",
        params={},
        modules=[
            {
                "module_id": "scenario-checker",
                "tier": "tier3",
                "role": "success_conditions",
                "latency_budget_ms": 100,
            }
        ],
    )


def test_world_rollout_service_completes_via_scenario_cli(tmp_path: Path) -> None:
    service = WorldRolloutService(
        cli_config=WorldRolloutCliConfig(
            executable_path=str(CLI_WRAPPER),
            workspace_root=tmp_path,
            timeout_seconds=TEST_TIMEOUT_SECONDS,
            max_output_chars=TEST_MAX_OUTPUT_CHARS,
        ),
        start_workers=False,
    )
    job = service.create_job(
        WorldRolloutJobCreateRequest(
            world_package=_carton_world_envelope(),
            checker_profile=_checker_profile(),
            rollout_params={
                "scenario": str(SCENARIO_DIR),
                "sim": "mujoco",
                "episodes": 1,
            },
        )
    )

    service._run_job(job.job_id)
    completed = service.get_job(job.job_id)

    assert completed.status == WorldRolloutJobStatus.COMPLETED
    assert completed.trace_record_count > 0
    assert completed.decision_count >= 1
    assert completed.reject_count == 0
    assert completed.stop_count == 0
    results = completed.campaign.rollout_params.get("results", {})
    assert results.get("success_count") == 1
    assert results.get("backend_id") == "mujoco"
    # Output artifacts exist where the campaign says, with verified digests
    # (the service's import path already digest-checked them).
    output_dir = tmp_path / job.job_id / "out"
    assert (output_dir / "trace.ndjson").is_file()
    assert (output_dir / "decisions.ndjson").is_file()
    first_trace = json.loads(
        (output_dir / "trace.ndjson").read_text(encoding="utf-8").splitlines()[0]
    )
    assert first_trace["metadata"]["episode_index"] == 0
