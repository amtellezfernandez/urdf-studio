from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.models.physical_state import PhysicalCompilerOutput, PhysicalRolloutTrace, PhysicalStateFrame
from backend.services.executability_audit import audit_physical_rollout_trace, audit_physical_state_frame


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit whether a physical-state frame or rollout is executable.")
    parser.add_argument("input", help="Path to compiled physical-state output, frame JSON, or rollout trace JSON.")
    parser.add_argument("--collision-margin-m", type=float, default=0.0)
    parser.add_argument("--out", default="", help="Optional output path. Defaults to stdout.")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    if isinstance(payload, dict) and "frames" in payload:
        report = audit_physical_rollout_trace(
            PhysicalRolloutTrace.model_validate(payload),
            collision_margin_m=args.collision_margin_m,
        )
    elif isinstance(payload, dict) and "frame" in payload and "tokens" in payload:
        report = audit_physical_state_frame(
            PhysicalCompilerOutput.model_validate(payload).frame,
            collision_margin_m=args.collision_margin_m,
        )
    else:
        report = audit_physical_state_frame(
            PhysicalStateFrame.model_validate(payload),
            collision_margin_m=args.collision_margin_m,
        )

    output = report.model_dump_json(indent=2)
    if args.out:
        Path(args.out).write_text(output + "\n", encoding="utf-8")
    else:
        print(output)
    return 0 if report.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
