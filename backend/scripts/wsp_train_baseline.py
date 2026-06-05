from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.services.world_model_baseline import (
    DEFAULT_BASELINE_SEED,
    DEFAULT_TRAIN_FRACTION,
    train_world_model_transition_baseline,
    write_world_model_baseline_artifacts,
)
from backend.services.world_model_dataset import load_world_model_dataset_jsonl


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Train and evaluate a tiny action-conditioned transition baseline on WSP JSONL samples. "
            "This is a trainability smoke test, not a production world model."
        )
    )
    parser.add_argument("input", help="Path to world_model_samples.jsonl.")
    parser.add_argument("--dataset-id", default="", help="Optional dataset id for the baseline report.")
    parser.add_argument("--out", default="", help="Optional output baseline report JSON path.")
    parser.add_argument("--model-out", default="", help="Optional output learned baseline model JSON path.")
    parser.add_argument("--train-fraction", type=float, default=DEFAULT_TRAIN_FRACTION)
    parser.add_argument("--seed", type=int, default=DEFAULT_BASELINE_SEED)
    parser.add_argument("--min-samples", type=int, default=1)
    parser.add_argument(
        "--require-balanced-labels",
        action="store_true",
        help="Require at least one executable and one rejected transition sample.",
    )
    parser.add_argument(
        "--max-mae",
        type=float,
        default=None,
        help="Optional maximum mean absolute error across all token features.",
    )
    parser.add_argument(
        "--max-position-mae-m",
        type=float,
        default=None,
        help="Optional maximum mean absolute error for xyz position features.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    samples = load_world_model_dataset_jsonl(Path(args.input))
    report, model = train_world_model_transition_baseline(
        samples,
        dataset_id=args.dataset_id or None,
        train_fraction=args.train_fraction,
        seed=args.seed,
        min_samples=args.min_samples,
        require_executable_and_rejected=args.require_balanced_labels,
        max_mean_absolute_error=args.max_mae,
        max_position_mean_absolute_error_m=args.max_position_mae_m,
    )
    write_world_model_baseline_artifacts(
        report,
        model,
        report_path=Path(args.out) if args.out else None,
        model_path=Path(args.model_out) if args.model_out else None,
    )
    print(json.dumps(report.model_dump(mode="json"), indent=2, sort_keys=True))
    return 0 if report.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
