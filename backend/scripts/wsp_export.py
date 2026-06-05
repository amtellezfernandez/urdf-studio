from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.models.physical_state import PhysicalRolloutTrace, RepairPlan
from backend.services.correction_planner import rollout_correction_branch
from backend.services.simulator_export import (
    export_rollout_trace_to_genesis_scene,
    export_rollout_trace_to_mujoco_mjcf,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export an executable WSP rollout or repair branch to a simulator.")
    parser.add_argument("input", help="Path to a PhysicalRolloutTrace JSON file.")
    parser.add_argument("--repair-plan", default="", help="Optional RepairPlan JSON file.")
    parser.add_argument("--branch", default="", help="Branch id to apply before export.")
    parser.add_argument("--target", choices=["mujoco", "genesis"], default="mujoco")
    parser.add_argument("--out", required=True, help="Output simulator-state path.")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    trace = PhysicalRolloutTrace.model_validate_json(Path(args.input).read_text(encoding="utf-8"))
    branch_id = args.branch or None
    if args.repair_plan:
        repair_plan = RepairPlan.model_validate_json(Path(args.repair_plan).read_text(encoding="utf-8"))
        if branch_id is None:
            if not repair_plan.branches:
                print(json.dumps({"success": False, "error": "Repair plan contains no branches."}, indent=2))
                return 1
            branch_id = repair_plan.branches[0].branch_id
        branch = next((candidate for candidate in repair_plan.branches if candidate.branch_id == branch_id), None)
        if branch is None:
            print(json.dumps({"success": False, "error": f"Repair branch not found: {branch_id}"}, indent=2))
            return 1
        trace = rollout_correction_branch(trace, branch)

    if args.target == "genesis":
        _scene, status = export_rollout_trace_to_genesis_scene(
            trace,
            output_path=Path(args.out),
            branch_id=branch_id,
        )
    else:
        _mjcf, status = export_rollout_trace_to_mujoco_mjcf(
            trace,
            output_path=Path(args.out),
            branch_id=branch_id,
        )
    print(status.model_dump_json(indent=2))
    return 0 if status.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
