from __future__ import annotations

import argparse
from pathlib import Path

from backend.services.world_model_dataset import (
    load_world_model_dataset_jsonl,
    validate_world_model_dataset_samples,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate WSP JSONL samples for trainable world-model readiness.")
    parser.add_argument("input", help="Path to world_model_samples.jsonl.")
    parser.add_argument("--dataset-id", default="", help="Optional dataset id for the readiness report.")
    parser.add_argument(
        "--require-balanced-labels",
        action="store_true",
        help="Require at least one executable and one rejected sample.",
    )
    parser.add_argument(
        "--require-simulator-provenance",
        action="store_true",
        help="Warn when samples do not include simulator export provenance.",
    )
    parser.add_argument("--out", default="", help="Optional output readiness report JSON path.")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    samples = load_world_model_dataset_jsonl(Path(args.input))
    report = validate_world_model_dataset_samples(
        samples,
        dataset_id=args.dataset_id or None,
        require_executable_and_rejected=args.require_balanced_labels,
        require_simulator_exports=args.require_simulator_provenance,
    )
    output = report.model_dump_json(indent=2)
    if args.out:
        output_path = Path(args.out)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(output + "\n", encoding="utf-8")
    else:
        print(output)
    return 0 if report.ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
