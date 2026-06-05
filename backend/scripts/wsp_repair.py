from __future__ import annotations

import argparse
from pathlib import Path

from backend.models.physical_state import PhysicalRolloutTrace
from backend.services.correction_planner import build_repair_plan
from backend.services.executability_audit import audit_physical_rollout_trace


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate corrective branches for a failed WSP rollout.")
    parser.add_argument("input", help="Path to a PhysicalRolloutTrace JSON file.")
    parser.add_argument("--out", default="", help="Optional output path. Defaults to stdout.")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    trace = PhysicalRolloutTrace.model_validate_json(Path(args.input).read_text(encoding="utf-8"))
    report = audit_physical_rollout_trace(trace)
    repair_plan = build_repair_plan(trace, report=report)
    output = repair_plan.model_dump_json(indent=2)
    if args.out:
        Path(args.out).write_text(output + "\n", encoding="utf-8")
    else:
        print(output)
    return 0 if repair_plan.branches or report.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
