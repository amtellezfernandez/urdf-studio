from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.services.world_model_dataset import load_world_model_dataset_jsonl
from backend.services.wsp_audit_benchmark import benchmark_audit_against_replay


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark WSP audit labels against simulator replay labels.")
    parser.add_argument("dataset", help="Replay-labeled WSP JSONL dataset.")
    parser.add_argument("--out", required=True, help="Output benchmark report JSON path.")
    parser.add_argument("--min-precision", type=float, default=0.0)
    parser.add_argument("--min-recall", type=float, default=0.0)
    parser.add_argument("--max-false-reject-rate", type=float, default=1.0)
    parser.add_argument("--max-runtime-ms", type=float, default=None)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    samples = load_world_model_dataset_jsonl(Path(args.dataset))
    report = benchmark_audit_against_replay(samples)
    errors: list[str] = []
    invalid_detection = report["invalid_detection"]
    runtime = report["runtime"]
    if invalid_detection["precision"] < args.min_precision:
        errors.append(
            f"precision {invalid_detection['precision']:.6g} below threshold {args.min_precision:.6g}"
        )
    if invalid_detection["recall"] < args.min_recall:
        errors.append(f"recall {invalid_detection['recall']:.6g} below threshold {args.min_recall:.6g}")
    if invalid_detection["false_reject_rate"] > args.max_false_reject_rate:
        errors.append(
            "false reject rate "
            f"{invalid_detection['false_reject_rate']:.6g} above threshold "
            f"{args.max_false_reject_rate:.6g}"
        )
    if args.max_runtime_ms is not None and runtime["mean_ms_per_transition"] > args.max_runtime_ms:
        errors.append(
            f"runtime {runtime['mean_ms_per_transition']:.6g}ms above threshold {args.max_runtime_ms:.6g}ms"
        )
    output = {
        "ok": not errors,
        "dataset_path": args.dataset,
        "errors": errors,
        "benchmark": report,
    }
    output_path = Path(args.out)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0 if output["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
