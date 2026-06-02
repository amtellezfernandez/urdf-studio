from __future__ import annotations

import hashlib
from datetime import datetime, timezone

import pytest

from backend.models.world_rollouts import (
    WorldRolloutArtifactRef,
    WorldRolloutCheckerProfile,
    WorldRolloutImportRequest,
    WorldRolloutJobCreateRequest,
    WorldRolloutJobStatus,
)
from backend.models.world_scene_package import (
    WorldInterfaceSpec,
    WorldRuntimeTarget,
    WorldScenePackageManifest,
    WorldSnapshot,
)
from backend.services.world_rollouts import (
    WorldRolloutCliConfig,
    WorldRolloutError,
    WorldRolloutService,
)
from backend.services.world_rollout_params import (
    WORLD_ROLLOUT_CHECKER_PROFILE_ARTIFACT_KIND,
    WORLD_ROLLOUT_DECISIONS_ARTIFACT_KIND,
    WORLD_ROLLOUT_INPUT_CAMPAIGN_FILENAME,
    WORLD_ROLLOUT_INPUT_CHECKER_PROFILE_FILENAME,
    WORLD_ROLLOUT_INPUT_WORLD_PACKAGE_FILENAME,
    WORLD_ROLLOUT_OUTPUT_CAMPAIGN_FILENAME,
    WORLD_ROLLOUT_OUTPUT_DIRNAME,
    WORLD_ROLLOUT_TRACE_ARTIFACT_KIND,
    WORLD_ROLLOUT_WORLD_PACKAGE_ARTIFACT_KIND,
)


TEST_WORLD_JOINT_VALUE_RAD = 0.1
TEST_WORLD_TIMESTEP_MS = 50
TEST_TRACE_TIME_MS = 100
TEST_TRACE_X_M = 1.2
TEST_DECISION_LATENCY_MS = 4.5
TEST_CLEARANCE_MARGIN_M = -0.02
TEST_EXECUTABLE_MODE = 0o755
TEST_MAX_OUTPUT_CHARS = 1000
TEST_TIMEOUT_SECONDS = 1
TEST_OVERSIZED_FILE_LIMIT_BYTES = 1
TEST_MAX_WORKERS = 1
TEST_MAX_QUEUED_JOBS = 0


def _build_world_package() -> WorldScenePackageManifest:
    return WorldScenePackageManifest(
        package_id="demo-world",
        version="1.0.0",
        title="Demo World",
        created_at=datetime.now(timezone.utc),
        runtime_targets=[WorldRuntimeTarget(name="worldd", mode="native")],
        interface=WorldInterfaceSpec(
            observation_modalities=["state"],
            action_semantics="generic_action",
            timestep_ms=TEST_WORLD_TIMESTEP_MS,
            frame_convention="world",
        ),
        world_snapshot=WorldSnapshot(
            urdf_xml="<robot name='demo'/>",
            joint_positions={"joint": TEST_WORLD_JOINT_VALUE_RAD},
            cameras=[],
            objects=[],
        ),
    )


def _build_profile() -> WorldRolloutCheckerProfile:
    return WorldRolloutCheckerProfile(
        profile_id="checker-profile",
        target_id="demo-robot",
        params={
            "footprint": {"shape": "circle", "radius_m": 0.4},
            "limits": {"max_speed_mps": 1.0},
        },
        modules=[
            {
                "module_id": "tier1-stop",
                "tier": "tier1",
                "role": "hardware_stop",
                "latency_budget_ms": 5,
                "params": {"fails_closed": True},
            },
            {
                "module_id": "tier3-spatial",
                "tier": "tier3",
                "role": "spatial_reasoner",
                "trigger": "last_meter_or_uncertain_scene",
                "latency_budget_ms": 250,
                "params": {"semantic_outputs": ["drop_zone_coordinates"]},
            },
        ],
    )


def _build_service(tmp_path) -> WorldRolloutService:
    return WorldRolloutService(
        cli_config=WorldRolloutCliConfig(
            executable_path=None,
            workspace_root=tmp_path,
            timeout_seconds=TEST_TIMEOUT_SECONDS,
            max_output_chars=TEST_MAX_OUTPUT_CHARS,
        ),
        start_workers=False,
    )


def _digest_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _digest_file(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _artifact_digest(job, kind: str) -> str:
    artifact = next((candidate for candidate in job.campaign.artifacts if candidate.kind == kind), None)
    assert artifact is not None
    assert artifact.digest_sha256 is not None
    return artifact.digest_sha256


def _build_cli_script(tmp_path) -> str:
    script_path = tmp_path / "rollout_cli.py"
    script_path.write_text(
        f"""#!/usr/bin/env python3
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--campaign", required=True)
parser.add_argument("--out", required=True)
args = parser.parse_args()
campaign_path = Path(args.campaign)
job_dir = campaign_path.parent
assert (job_dir / {WORLD_ROLLOUT_INPUT_WORLD_PACKAGE_FILENAME!r}).exists()
assert (job_dir / {WORLD_ROLLOUT_INPUT_CHECKER_PROFILE_FILENAME!r}).exists()
campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
out_dir = Path(args.out)
out_dir.mkdir(parents=True, exist_ok=True)
trace_ndjson = '{{"t_ms":{TEST_TRACE_TIME_MS},"stream":"state"}}\\n'
decisions_ndjson = '{{"decision":"stop","rule_id":"hardware_stop"}}\\n'
(out_dir / "trace.ndjson").write_text(trace_ndjson, encoding="utf-8")
(out_dir / "decisions.ndjson").write_text(decisions_ndjson, encoding="utf-8")
campaign["artifacts"] = campaign.get("artifacts", []) + [
    {{
        "kind": {WORLD_ROLLOUT_TRACE_ARTIFACT_KIND!r},
        "uri": "trace.ndjson",
        "digest_sha256": hashlib.sha256(trace_ndjson.encode("utf-8")).hexdigest(),
        "metadata": {{}},
    }},
    {{
        "kind": {WORLD_ROLLOUT_DECISIONS_ARTIFACT_KIND!r},
        "uri": "decisions.ndjson",
        "digest_sha256": hashlib.sha256(decisions_ndjson.encode("utf-8")).hexdigest(),
        "metadata": {{}},
    }},
]
(out_dir / {WORLD_ROLLOUT_OUTPUT_CAMPAIGN_FILENAME!r}).write_text(
    json.dumps(campaign),
    encoding="utf-8",
)
""",
        encoding="utf-8",
    )
    script_path.chmod(TEST_EXECUTABLE_MODE)
    return str(script_path)


def test_import_results_preserves_user_configured_profile_and_counts_decisions(tmp_path) -> None:
    service = _build_service(tmp_path)
    job = service.create_job(
        WorldRolloutJobCreateRequest(
            world_package=_build_world_package(),
            checker_profile=_build_profile(),
            rollout_params={"domain": "user-defined-domain"},
        )
    )
    trace_ndjson = (
        '{"t_ms":100,"stream":"base_pose","module_id":"tier3-spatial","tier":"tier3",'
        '"state":{"x_m":1.2,"y_m":0.0},'
        '"semantic_outputs":{"drop_zone_coordinates":[1.2,0.0,0.1]}}\n'
    )
    decisions_ndjson = (
        '{"t_ms":100,"module_id":"tier1-stop","tier":"tier1",'
        '"decision":"stop","rule_id":"hardware_stop",'
        '"metrics":{"latency_ms":4.5,"margin_m":-0.02}}\n'
        '{"t_ms":100,"module_id":"tier3-spatial","tier":"tier3",'
        '"decision":"escalate","rule_id":"uncertain_scene",'
        '"confidence":0.42,'
        '"semantic_outputs":{"reason":"porch shape unknown"}}\n'
    )

    imported = service.import_results(
        WorldRolloutImportRequest(
            campaign=job.campaign,
            trace_ndjson=trace_ndjson,
            decisions_ndjson=decisions_ndjson,
        )
    )

    assert imported.campaign.checker_profile.params["footprint"]["shape"] == "circle"
    assert imported.campaign.checker_profile.modules[0].role == "hardware_stop"
    assert imported.campaign.rollout_params["domain"] == "user-defined-domain"
    assert imported.trace_record_count == 1
    assert imported.trace_records[0].t_ms == TEST_TRACE_TIME_MS
    assert imported.trace_records[0].state["x_m"] == TEST_TRACE_X_M
    assert imported.trace_records[0].semantic_outputs["drop_zone_coordinates"] == [1.2, 0.0, 0.1]
    assert imported.decision_count == 2
    assert imported.reject_count == 0
    assert imported.warn_count == 0
    assert imported.stop_count == 1
    assert imported.escalation_count == 1
    assert imported.decisions[0].metrics["latency_ms"] == TEST_DECISION_LATENCY_MS
    assert imported.decisions[0].metrics["margin_m"] == TEST_CLEARANCE_MARGIN_M
    assert imported.decisions[1].semantic_outputs["reason"] == "porch shape unknown"


def test_cli_job_writes_self_contained_sidecars_and_verifies_output_artifacts(tmp_path) -> None:
    service = WorldRolloutService(
        cli_config=WorldRolloutCliConfig(
            executable_path=_build_cli_script(tmp_path),
            workspace_root=tmp_path,
            timeout_seconds=TEST_TIMEOUT_SECONDS,
            max_output_chars=TEST_MAX_OUTPUT_CHARS,
        ),
        start_workers=False,
    )
    job = service.create_job(
        WorldRolloutJobCreateRequest(
            world_package=_build_world_package(),
            checker_profile=_build_profile(),
        )
    )

    service._run_job(job.job_id)
    completed = service.get_job(job.job_id)
    job_dir = tmp_path / job.job_id
    world_package_path = job_dir / WORLD_ROLLOUT_INPUT_WORLD_PACKAGE_FILENAME
    checker_profile_path = job_dir / WORLD_ROLLOUT_INPUT_CHECKER_PROFILE_FILENAME

    assert completed.status == WorldRolloutJobStatus.COMPLETED
    assert (job_dir / WORLD_ROLLOUT_INPUT_CAMPAIGN_FILENAME).exists()
    assert completed.output_manifest_path == str(
        job_dir / WORLD_ROLLOUT_OUTPUT_DIRNAME / WORLD_ROLLOUT_OUTPUT_CAMPAIGN_FILENAME
    )
    assert _artifact_digest(completed, WORLD_ROLLOUT_WORLD_PACKAGE_ARTIFACT_KIND) == _digest_file(
        world_package_path
    )
    assert completed.campaign.world_package.digest_sha256 == _digest_file(world_package_path)
    assert _artifact_digest(completed, WORLD_ROLLOUT_CHECKER_PROFILE_ARTIFACT_KIND) == _digest_file(
        checker_profile_path
    )
    assert completed.trace_record_count == 1
    assert completed.decision_count == 1
    assert completed.stop_count == 1


def test_import_results_rejects_artifact_digest_mismatch(tmp_path) -> None:
    service = _build_service(tmp_path)
    job = service.create_job(
        WorldRolloutJobCreateRequest(
            world_package=_build_world_package(),
            checker_profile=_build_profile(),
        )
    )
    decisions_ndjson = '{"decision":"stop","rule_id":"hardware_stop"}\n'
    campaign = job.campaign.model_copy(
        update={
            "artifacts": [
                *job.campaign.artifacts,
                WorldRolloutArtifactRef(
                    kind=WORLD_ROLLOUT_DECISIONS_ARTIFACT_KIND,
                    uri="decisions.ndjson",
                    digest_sha256=_digest_text("different decisions"),
                ),
            ]
        },
    )

    with pytest.raises(WorldRolloutError, match="digest mismatch"):
        service.import_results(
            WorldRolloutImportRequest(
                campaign=campaign,
                decisions_ndjson=decisions_ndjson,
            )
        )


def test_output_artifact_read_rejects_oversized_file_before_parsing(tmp_path) -> None:
    service = _build_service(tmp_path)
    oversized_path = tmp_path / "oversized.ndjson"
    oversized_path.write_text("{}", encoding="utf-8")

    with pytest.raises(WorldRolloutError, match="exceeds size limit"):
        service._read_text_file(
            oversized_path,
            max_bytes=TEST_OVERSIZED_FILE_LIMIT_BYTES,
            label=oversized_path.name,
        )


def test_create_job_rejects_when_worker_capacity_is_full(tmp_path) -> None:
    service = WorldRolloutService(
        cli_config=WorldRolloutCliConfig(
            executable_path=None,
            workspace_root=tmp_path,
            timeout_seconds=TEST_TIMEOUT_SECONDS,
            max_output_chars=TEST_MAX_OUTPUT_CHARS,
            max_workers=TEST_MAX_WORKERS,
            max_queued_jobs=TEST_MAX_QUEUED_JOBS,
        ),
        start_workers=True,
    )
    with service._lock:
        service._running_job_ids.add("active-job")

    with pytest.raises(WorldRolloutError, match="queue is full"):
        service.create_job(
            WorldRolloutJobCreateRequest(
                world_package=_build_world_package(),
                checker_profile=_build_profile(),
            )
        )


def test_import_results_rejects_invalid_decision(tmp_path) -> None:
    service = _build_service(tmp_path)
    job = service.create_job(
        WorldRolloutJobCreateRequest(
            world_package=_build_world_package(),
            checker_profile=_build_profile(),
        )
    )

    with pytest.raises(WorldRolloutError):
        service.import_results(
            WorldRolloutImportRequest(
                campaign=job.campaign,
                decisions_ndjson='{"decision":"maybe","rule_id":"unknown"}\n',
            )
        )


def test_job_fails_when_cli_is_not_configured(tmp_path) -> None:
    service = _build_service(tmp_path)
    job = service.create_job(
        WorldRolloutJobCreateRequest(
            world_package=_build_world_package(),
            checker_profile=_build_profile(),
        )
    )

    service._run_job(job.job_id)
    completed = service.get_job(job.job_id)

    assert completed.status == WorldRolloutJobStatus.FAILED
    assert completed.error == "URDF_WORLD_ROLLOUT_CLI is not configured."
