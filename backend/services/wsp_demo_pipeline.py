from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend.models.physical_state import ActionToken
from backend.services.correction_planner import build_repair_plan, rollout_correction_branch
from backend.services.executability_audit import audit_physical_rollout_trace
from backend.services.physical_rollout_baseline import rollout_action
from backend.services.physical_state_compiler import compile_physical_state_payload
from backend.services.simulator_export import (
    export_rollout_trace_to_genesis_scene,
    export_rollout_trace_to_mujoco_mjcf,
)
from backend.services.world_model_dataset import (
    build_world_model_training_samples,
    validate_world_model_dataset_samples,
    write_world_model_dataset_jsonl,
)


DEFAULT_WSP_DEMO_SCENE_PATH = Path("web/public/world-layouts/hkhack-pallet-dock.world-package.json")
DEFAULT_WSP_DEMO_BRANCH_ID = "stop_and_replan"
DEFAULT_WSP_DEMO_STEP_COUNT = 2
DEFAULT_WSP_DEMO_STEP_MS = 500


def build_default_wsp_demo_action() -> ActionToken:
    return ActionToken(
        action_id="push-pallet-to-dock",
        action_type="push",
        actor_id="robot_1",
        object_id="pallet_7",
        destination_id="dock_d2",
        duration_ms=1000,
        params={
            "delta_xyz": [0.5, 0.0, 0.0],
            "max_force_n": 120.0,
            "battery_cost": 0.1,
        },
    )


def run_wsp_demo_pipeline(
    *,
    scene_path: Path = DEFAULT_WSP_DEMO_SCENE_PATH,
    output_dir: Path,
    action: ActionToken | None = None,
    branch_id: str = DEFAULT_WSP_DEMO_BRANCH_ID,
    step_count: int = DEFAULT_WSP_DEMO_STEP_COUNT,
    step_ms: int = DEFAULT_WSP_DEMO_STEP_MS,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    selected_action = action or build_default_wsp_demo_action()

    compiled = compile_physical_state_payload(scene_path.read_text(encoding="utf-8"))
    rollout = rollout_action(compiled.frame, selected_action, step_count=step_count, step_ms=step_ms)
    audit_report = audit_physical_rollout_trace(rollout)
    repair_plan = build_repair_plan(rollout, report=audit_report)

    branch = next((candidate for candidate in repair_plan.branches if candidate.branch_id == branch_id), None)
    if branch is None and repair_plan.branches:
        branch = repair_plan.branches[0]
    repaired_trace = rollout_correction_branch(rollout, branch) if branch is not None else rollout

    corrected_mjcf_path = output_dir / "corrected_state.mjcf.xml"
    _mjcf, mujoco_export_status = export_rollout_trace_to_mujoco_mjcf(
        repaired_trace,
        output_path=corrected_mjcf_path,
        branch_id=branch.branch_id if branch is not None else None,
    )
    corrected_genesis_path = output_dir / "corrected_state.genesis-scene.json"
    _genesis_scene, genesis_export_status = export_rollout_trace_to_genesis_scene(
        repaired_trace,
        output_path=corrected_genesis_path,
        branch_id=branch.branch_id if branch is not None else None,
    )
    simulator_exports = {
        "mujoco": mujoco_export_status.model_dump(mode="json"),
        "genesis": genesis_export_status.model_dump(mode="json"),
    }
    world_model_samples = [
        *build_world_model_training_samples(
            rollout,
            metadata={"split": "original_rejected_rollout"},
        ),
        *build_world_model_training_samples(
            repaired_trace,
            correction_branch_id=branch.branch_id if branch is not None else None,
            simulator_exports=simulator_exports,
            metadata={"split": "corrected_executable_rollout"},
        ),
    ]

    compiled_path = output_dir / "compiled_tokens.json"
    rollout_path = output_dir / "predicted_trace.json"
    audit_path = output_dir / "executability_report.json"
    repair_path = output_dir / "correction_branches.json"
    mujoco_export_status_path = output_dir / "export_status.mujoco.json"
    genesis_export_status_path = output_dir / "export_status.genesis.json"
    world_model_samples_path = output_dir / "world_model_samples.jsonl"
    world_model_manifest_path = output_dir / "world_model_dataset_manifest.json"
    world_model_readiness_path = output_dir / "world_model_dataset_readiness.json"
    summary_path = output_dir / "summary.json"

    compiled_path.write_text(compiled.model_dump_json(indent=2) + "\n", encoding="utf-8")
    rollout_path.write_text(rollout.model_dump_json(indent=2) + "\n", encoding="utf-8")
    audit_path.write_text(audit_report.model_dump_json(indent=2) + "\n", encoding="utf-8")
    repair_path.write_text(repair_plan.model_dump_json(indent=2) + "\n", encoding="utf-8")
    mujoco_export_status_path.write_text(mujoco_export_status.model_dump_json(indent=2) + "\n", encoding="utf-8")
    genesis_export_status_path.write_text(genesis_export_status.model_dump_json(indent=2) + "\n", encoding="utf-8")
    world_model_manifest = write_world_model_dataset_jsonl(
        world_model_samples,
        output_path=world_model_samples_path,
        dataset_id=f"{compiled.frame.frame_id}:wsp-world-model-samples",
        manifest_path=world_model_manifest_path,
        metadata={
            "claim": "compiler_layer_between_robot_reality_and_trainable_world_models",
            "source_scene_path": str(scene_path),
        },
    )
    world_model_readiness = validate_world_model_dataset_samples(
        world_model_samples,
        dataset_id=world_model_manifest.dataset_id,
        require_executable_and_rejected=True,
        require_simulator_exports=False,
    )
    world_model_readiness_path.write_text(world_model_readiness.model_dump_json(indent=2) + "\n", encoding="utf-8")

    summary = {
        "ok": (
            audit_report.success is False
            and len(repair_plan.branches) > 0
            and mujoco_export_status.success
            and genesis_export_status.success
            and world_model_manifest.sample_count > 0
            and world_model_manifest.executable_count > 0
            and world_model_manifest.rejected_count > 0
            and world_model_readiness.ready
        ),
        "claim": (
            "WSP-0.1 demonstrates scene -> physical-state tokens -> action rollout -> "
            "executability audit -> repair branches -> MuJoCo and Genesis export -> "
            "world-model training samples."
        ),
        "scene_path": str(scene_path),
        "artifacts": {
            "compiled_tokens": str(compiled_path),
            "predicted_trace": str(rollout_path),
            "executability_report": str(audit_path),
            "correction_branches": str(repair_path),
            "mujoco_export_status": str(mujoco_export_status_path),
            "genesis_export_status": str(genesis_export_status_path),
            "corrected_mjcf": str(corrected_mjcf_path),
            "corrected_genesis_scene": str(corrected_genesis_path),
            "world_model_samples": str(world_model_samples_path),
            "world_model_dataset_manifest": str(world_model_manifest_path),
            "world_model_dataset_readiness": str(world_model_readiness_path),
        },
        "compile": {
            "entity_count": len(compiled.frame.entities),
            "text_token_count": len(compiled.tokens.text_tokens),
            "feature_row_count": len(compiled.tokens.continuous_features),
            "constraint_count": len(compiled.frame.constraints),
        },
        "rollout": {
            "trace_id": rollout.trace_id,
            "frame_count": len(rollout.frames),
            "action_count": len(rollout.actions),
            "step_count": step_count,
            "step_ms": step_ms,
        },
        "audit": {
            "success": audit_report.success,
            "decision": audit_report.decision,
            "score": audit_report.score,
            "check_count": audit_report.check_count,
            "reject_count": audit_report.reject_count,
            "warn_count": audit_report.warn_count,
        },
        "repair": {
            "branch_count": len(repair_plan.branches),
            "selected_branch_id": branch.branch_id if branch is not None else None,
            "branches": [
                {
                    "branch_id": candidate.branch_id,
                    "expected_score": candidate.expected_executability_score,
                    "risk_score": candidate.risk_score,
                    "training_value": candidate.training_value,
                }
                for candidate in repair_plan.branches
            ],
        },
        "export": {
            "success": mujoco_export_status.success and genesis_export_status.success,
            "target": "mujoco+genesis",
            "smoke_passed": mujoco_export_status.smoke_passed and genesis_export_status.smoke_passed,
            "mujoco": {
                "success": mujoco_export_status.success,
                "target": mujoco_export_status.target,
                "smoke_passed": mujoco_export_status.smoke_passed,
                "error": mujoco_export_status.error,
                "metrics": mujoco_export_status.metrics,
            },
            "genesis": {
                "success": genesis_export_status.success,
                "target": genesis_export_status.target,
                "smoke_passed": genesis_export_status.smoke_passed,
                "error": genesis_export_status.error,
                "metrics": genesis_export_status.metrics,
            },
        },
        "dataset": {
            "dataset_id": world_model_manifest.dataset_id,
            "sample_count": world_model_manifest.sample_count,
            "executable_count": world_model_manifest.executable_count,
            "rejected_count": world_model_manifest.rejected_count,
            "source_trace_ids": world_model_manifest.source_trace_ids,
            "schema_version": world_model_manifest.schema_version,
            "sample_schema_version": world_model_manifest.sample_schema_version,
            "feature_schema": world_model_manifest.feature_schema,
            "readiness": world_model_readiness.model_dump(mode="json"),
        },
    }
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return summary
