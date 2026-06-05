from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.models.physical_state import ActionToken, PhysicalCompilerOutput, PhysicalStateFrame
from backend.services.physical_rollout_baseline import rollout_action


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a deterministic physical-state rollout baseline.")
    parser.add_argument("input", help="Path to compiled physical-state output or a PhysicalStateFrame JSON file.")
    parser.add_argument("--action-json", required=True, help="ActionToken JSON object.")
    parser.add_argument("--steps", type=int, default=3)
    parser.add_argument("--step-ms", type=int, default=100)
    parser.add_argument("--out", default="", help="Optional output path. Defaults to stdout.")
    return parser.parse_args()


def _load_frame(path: Path) -> PhysicalStateFrame:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and "frame" in payload and "tokens" in payload:
        return PhysicalCompilerOutput.model_validate(payload).frame
    return PhysicalStateFrame.model_validate(payload)


def main() -> int:
    args = _parse_args()
    frame = _load_frame(Path(args.input))
    action = ActionToken.model_validate_json(args.action_json)
    trace = rollout_action(frame, action, step_count=args.steps, step_ms=args.step_ms)
    output = trace.model_dump_json(indent=2)
    if args.out:
        Path(args.out).write_text(output + "\n", encoding="utf-8")
    else:
        print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
