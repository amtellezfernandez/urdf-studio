from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.services.world_model_baseline import DEFAULT_BASELINE_SEED, DEFAULT_TRAIN_FRACTION
from backend.services.world_model_dataset import load_world_model_dataset_jsonl
from backend.services.wsp_graph_baseline import (
    train_wsp_graph_baseline,
    write_wsp_graph_baseline_artifacts,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train a small WSP entity-graph baseline for model-lift evaluation."
    )
    parser.add_argument("input", nargs="?", default="", help="Replay-labeled WSP JSONL dataset.")
    parser.add_argument("--train", default="", help="Optional train JSONL path.")
    parser.add_argument("--eval", default="", help="Optional eval JSONL path.")
    parser.add_argument("--dataset-id", default="", help="Optional dataset id for the report.")
    parser.add_argument("--out", default="", help="Optional output report JSON path.")
    parser.add_argument("--model-out", default="", help="Optional output model artifact JSON path.")
    parser.add_argument("--train-fraction", type=float, default=DEFAULT_TRAIN_FRACTION)
    parser.add_argument("--seed", type=int, default=DEFAULT_BASELINE_SEED)
    parser.add_argument("--epochs", type=int, default=250)
    parser.add_argument("--learning-rate", type=float, default=0.005)
    parser.add_argument("--hidden-dim", type=int, default=64)
    parser.add_argument("--max-entities", type=int, default=8)
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--min-auroc", type=float, default=0.0)
    parser.add_argument("--max-unsafe-fn-rate", type=float, default=1.0)
    parser.add_argument("--max-position-mae-m", type=float, default=None)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    if args.train:
        train_samples = load_world_model_dataset_jsonl(Path(args.train))
        eval_samples = load_world_model_dataset_jsonl(Path(args.eval)) if args.eval else None
    elif args.input:
        train_samples = load_world_model_dataset_jsonl(Path(args.input))
        eval_samples = None
    else:
        raise SystemExit("Provide either a positional dataset or --train JSONL path.")

    report, model = train_wsp_graph_baseline(
        train_samples,
        eval_samples=eval_samples,
        dataset_id=args.dataset_id or None,
        train_fraction=args.train_fraction,
        seed=args.seed,
        epochs=args.epochs,
        learning_rate=args.learning_rate,
        hidden_dim=args.hidden_dim,
        max_entities=args.max_entities,
        threshold=args.threshold,
    )
    metrics = report["metrics"]
    threshold_errors: list[str] = []
    if metrics["invalid_action"]["auroc"] < args.min_auroc:
        threshold_errors.append(
            f"invalid-action AUROC {metrics['invalid_action']['auroc']:.6g} below threshold {args.min_auroc:.6g}"
        )
    if metrics["invalid_action"]["unsafe_false_negative_rate"] > args.max_unsafe_fn_rate:
        threshold_errors.append(
            "unsafe false-negative rate "
            f"{metrics['invalid_action']['unsafe_false_negative_rate']:.6g} above threshold "
            f"{args.max_unsafe_fn_rate:.6g}"
        )
    if (
        args.max_position_mae_m is not None
        and metrics["next_state"]["position_mean_absolute_error_m"] > args.max_position_mae_m
    ):
        threshold_errors.append(
            "position MAE "
            f"{metrics['next_state']['position_mean_absolute_error_m']:.6g}m above threshold "
            f"{args.max_position_mae_m:.6g}m"
        )
    report["errors"].extend(threshold_errors)
    report["success"] = report["success"] and not threshold_errors
    write_wsp_graph_baseline_artifacts(
        report,
        model,
        report_path=Path(args.out) if args.out else None,
        model_path=Path(args.model_out) if args.model_out else None,
    )
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
