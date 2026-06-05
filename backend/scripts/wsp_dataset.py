from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.models.physical_state import PhysicalRolloutTrace, RepairPlan
from backend.services.correction_planner import rollout_correction_branch
from backend.services.world_model_dataset import (
    build_world_model_training_samples,
    write_world_model_dataset_jsonl,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export WSP rollout transitions as world-model training samples.")
    parser.add_argument("input", help="Path to a PhysicalRolloutTrace JSON file.")
    parser.add_argument("--repair-plan", default="", help="Optional RepairPlan JSON file.")
    parser.add_argument("--branch", default="", help="Optional repair branch id to include as corrected samples.")
    parser.add_argument("--out", required=True, help="Output JSONL path for WorldModelTrainingSample rows.")
    parser.add_argument("--manifest-out", default="", help="Optional dataset manifest JSON path.")
    parser.add_argument("--dataset-id", default="", help="Stable dataset id. Defaults to trace_id:wsp-world-model-samples.")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    trace = PhysicalRolloutTrace.model_validate_json(Path(args.input).read_text(encoding="utf-8"))
    dataset_id = args.dataset_id or f"{trace.trace_id}:wsp-world-model-samples"
    samples = build_world_model_training_samples(
        trace,
        metadata={"split": "source_rollout"},
    )

    branch_id = args.branch or None
    if args.repair_plan:
        repair_plan = RepairPlan.model_validate_json(Path(args.repair_plan).read_text(encoding="utf-8"))
        if branch_id is None and repair_plan.branches:
            branch_id = repair_plan.branches[0].branch_id
        branch = next((candidate for candidate in repair_plan.branches if candidate.branch_id == branch_id), None)
        if branch is None:
            print(json.dumps({"success": False, "error": f"Repair branch not found: {branch_id}"}, indent=2))
            return 1
        repaired_trace = rollout_correction_branch(trace, branch)
        samples.extend(
            build_world_model_training_samples(
                repaired_trace,
                correction_branch_id=branch.branch_id,
                metadata={"split": "corrected_rollout"},
            )
        )

    manifest = write_world_model_dataset_jsonl(
        samples,
        output_path=Path(args.out),
        dataset_id=dataset_id,
        manifest_path=Path(args.manifest_out) if args.manifest_out else None,
    )
    print(manifest.model_dump_json(indent=2))
    return 0 if manifest.sample_count > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
