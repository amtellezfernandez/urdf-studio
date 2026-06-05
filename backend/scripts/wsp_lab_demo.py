from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.services.wsp_lab_demo import run_wsp_lab_demo


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the WSP robotics data/eval lab demo around a policy regression.")
    parser.add_argument("--out-dir", default="/tmp/wsp_lab_demo", help="Output artifact directory.")
    parser.add_argument("--count", type=int, default=1000, help="Failure corpus transition count.")
    parser.add_argument("--policy-count", type=int, default=120, help="Policy baseline/candidate transition count.")
    parser.add_argument(
        "--failure-modes",
        default="collision,contact,joint,battery,reachability",
        help="Comma-separated failure modes.",
    )
    parser.add_argument("--seed", type=int, default=41)
    parser.add_argument("--epochs", type=int, default=250)
    parser.add_argument("--min-auroc-lift", type=float, default=0.1)
    parser.add_argument("--min-unsafe-fn-reduction", type=float, default=0.2)
    parser.add_argument("--allow-position-mae-regression", action="store_true")
    parser.add_argument(
        "--stress-noise-rate",
        type=float,
        default=0.0,
        help=(
            "Optional synthetic ambiguity stress rate. This deliberately perturbs replay labels "
            "to demonstrate that deterministic perfect metrics are not real-world claims."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    summary = run_wsp_lab_demo(
        output_dir=Path(args.out_dir),
        count=args.count,
        policy_count=args.policy_count,
        failure_modes=args.failure_modes,
        seed=args.seed,
        epochs=args.epochs,
        min_auroc_lift=args.min_auroc_lift,
        min_unsafe_fn_reduction=args.min_unsafe_fn_reduction,
        require_wsp_position_mae_not_worse=not args.allow_position_mae_regression,
        stress_noise_rate=args.stress_noise_rate,
    )
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
