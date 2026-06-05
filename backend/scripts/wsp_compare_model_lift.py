from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.services.wsp_model_lift import (
    compare_raw_vs_wsp_model_lift,
    load_json_report,
    write_model_lift_report,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare raw-log and WSP learned model reports.")
    parser.add_argument("--raw-report", required=True, help="Raw-log baseline report JSON path.")
    parser.add_argument("--wsp-report", required=True, help="WSP learned model report JSON path.")
    parser.add_argument("--out", required=True, help="Output model-lift report JSON path.")
    parser.add_argument("--min-auroc-lift", type=float, default=0.0)
    parser.add_argument("--min-unsafe-fn-reduction", type=float, default=0.0)
    parser.add_argument("--require-wsp-position-mae-not-worse", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    report = compare_raw_vs_wsp_model_lift(
        raw_report=load_json_report(Path(args.raw_report)),
        wsp_report=load_json_report(Path(args.wsp_report)),
        min_auroc_lift=args.min_auroc_lift,
        min_unsafe_fn_reduction=args.min_unsafe_fn_reduction,
        require_wsp_position_mae_not_worse=args.require_wsp_position_mae_not_worse,
    )
    write_model_lift_report(report, output_path=Path(args.out))
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
