from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.models.physical_state import ActionToken
from backend.services.wsp_demo_pipeline import (
    DEFAULT_WSP_DEMO_BRANCH_ID,
    DEFAULT_WSP_DEMO_SCENE_PATH,
    DEFAULT_WSP_DEMO_STEP_COUNT,
    DEFAULT_WSP_DEMO_STEP_MS,
    run_wsp_demo_pipeline,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the full WSP-0.1 demo pipeline.")
    parser.add_argument("--scene", default=str(DEFAULT_WSP_DEMO_SCENE_PATH), help="World package/layout input path.")
    parser.add_argument("--out-dir", default="/tmp/wsp-demo", help="Directory for generated artifacts.")
    parser.add_argument("--action-json", default="", help="Optional ActionToken JSON object.")
    parser.add_argument("--branch", default=DEFAULT_WSP_DEMO_BRANCH_ID, help="Repair branch id to export.")
    parser.add_argument("--steps", type=int, default=DEFAULT_WSP_DEMO_STEP_COUNT)
    parser.add_argument("--step-ms", type=int, default=DEFAULT_WSP_DEMO_STEP_MS)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    action = ActionToken.model_validate_json(args.action_json) if args.action_json else None
    summary = run_wsp_demo_pipeline(
        scene_path=Path(args.scene),
        output_dir=Path(args.out_dir),
        action=action,
        branch_id=args.branch,
        step_count=args.steps,
        step_ms=args.step_ms,
    )
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
