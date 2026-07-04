from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.services.world_model_dataset import write_world_model_dataset_jsonl
from backend.services.wsp_failure_corpus import (
    DEFAULT_FAILURE_CORPUS_SEED,
    DEFAULT_VALID_RATIO,
    generate_wsp_failure_corpus_samples,
    normalize_failure_modes,
    summarize_wsp_failure_corpus,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a synthetic WSP failure corpus JSONL.")
    parser.add_argument("--count", type=int, required=True, help="Number of transition samples to generate.")
    parser.add_argument(
        "--failure-modes",
        default="",
        help="Comma-separated failure modes. Aliases include collision, contact, joint, battery, reachability.",
    )
    parser.add_argument("--valid-ratio", type=float, default=DEFAULT_VALID_RATIO)
    parser.add_argument("--seed", type=int, default=DEFAULT_FAILURE_CORPUS_SEED)
    parser.add_argument("--out", required=True, help="Output JSONL path.")
    parser.add_argument("--manifest-out", default="", help="Optional dataset manifest JSON path.")
    parser.add_argument("--summary-out", default="", help="Optional summary JSON path.")
    parser.add_argument("--dataset-id", default="wsp-failure-corpus-0.1")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    failure_modes = normalize_failure_modes(args.failure_modes or None)
    samples = generate_wsp_failure_corpus_samples(
        count=args.count,
        failure_modes=failure_modes,
        valid_ratio=args.valid_ratio,
        seed=args.seed,
    )
    output_path = Path(args.out)
    manifest = write_world_model_dataset_jsonl(
        samples,
        output_path=output_path,
        dataset_id=args.dataset_id,
        manifest_path=Path(args.manifest_out) if args.manifest_out else None,
        metadata={
            "source": "wsp_failure_corpus_generator",
            "failure_modes": failure_modes,
            "valid_ratio": args.valid_ratio,
            "seed": args.seed,
        },
    )
    summary = {
        "ok": len(samples) == args.count,
        "dataset_id": manifest.dataset_id,
        "output_path": str(output_path),
        "manifest_path": args.manifest_out or None,
        "summary_path": args.summary_out or None,
        "generator": {
            "failure_modes": failure_modes,
            "valid_ratio": args.valid_ratio,
            "seed": args.seed,
        },
        "manifest": {
            "dataset_id": manifest.dataset_id,
            "schema_version": manifest.schema_version,
            "sample_count": manifest.sample_count,
            "executable_count": manifest.executable_count,
            "rejected_count": manifest.rejected_count,
            "sample_schema_version": manifest.sample_schema_version,
            "feature_dim": len(manifest.feature_schema),
            "source_trace_count": len(manifest.source_trace_ids),
        },
        "corpus": summarize_wsp_failure_corpus(samples),
    }
    if args.summary_out:
        summary_path = Path(args.summary_out)
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
