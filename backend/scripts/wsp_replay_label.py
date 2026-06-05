from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.services.world_model_dataset import load_world_model_dataset_jsonl, write_world_model_dataset_jsonl
from backend.services.wsp_replay_label import (
    normalize_replay_targets,
    replay_label_samples,
    summarize_replay_labeled_samples,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Attach MuJoCo/Genesis replay oracle labels to WSP JSONL samples.")
    parser.add_argument("input", help="Input WSP world-model sample JSONL.")
    parser.add_argument("--sim", default="mujoco,genesis", help="Comma-separated replay targets: mujoco,genesis.")
    parser.add_argument(
        "--smoke-load",
        action="store_true",
        help="Load simulator libraries for per-sample smoke verification. Off by default for corpus-scale safety.",
    )
    parser.add_argument("--out", required=True, help="Output labeled JSONL path.")
    parser.add_argument("--manifest-out", default="", help="Optional output dataset manifest JSON path.")
    parser.add_argument("--summary-out", default="", help="Optional replay summary JSON path.")
    parser.add_argument("--dataset-id", default="wsp-replay-labeled-corpus")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    targets = normalize_replay_targets(args.sim)
    samples = load_world_model_dataset_jsonl(Path(args.input))
    labeled_samples = replay_label_samples(samples, targets=targets, smoke_load=args.smoke_load)
    manifest = write_world_model_dataset_jsonl(
        labeled_samples,
        output_path=Path(args.out),
        dataset_id=args.dataset_id,
        manifest_path=Path(args.manifest_out) if args.manifest_out else None,
        metadata={"source": "wsp_replay_label", "replay_targets": targets},
    )
    summary = {
        "ok": len(labeled_samples) == len(samples),
        "input_path": args.input,
        "output_path": args.out,
        "manifest_path": args.manifest_out or None,
        "summary_path": args.summary_out or None,
        "dataset": {
            "dataset_id": manifest.dataset_id,
            "sample_count": manifest.sample_count,
            "executable_count": manifest.executable_count,
            "rejected_count": manifest.rejected_count,
        },
        "replay": summarize_replay_labeled_samples(labeled_samples),
        "smoke_load_requested": args.smoke_load,
    }
    if args.summary_out:
        summary_path = Path(args.summary_out)
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
