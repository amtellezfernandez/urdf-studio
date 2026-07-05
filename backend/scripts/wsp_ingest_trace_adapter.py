from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import cast

from backend.services.world_model_dataset import write_world_model_dataset_jsonl
from backend.services.wsp_trace_adapters import (
    TraceAdapterSource,
    build_trace_adapter_dataset,
    compile_trace_adapter_file,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compile MuJoCo, Genesis, ROS/MCAP-style, or LeRobot JSON traces into WSP rollout samples."
    )
    parser.add_argument("input", help="Trace JSON or JSONL path.")
    parser.add_argument(
        "--source",
        choices=["auto", "mujoco", "genesis", "ros", "lerobot"],
        default="auto",
        help="Source adapter. Defaults to auto-detect.",
    )
    parser.add_argument("--trace-out", default="", help="Optional PhysicalRolloutTrace JSON output path.")
    parser.add_argument("--dataset-out", default="", help="Optional WSP world-model samples JSONL output path.")
    parser.add_argument("--manifest-out", default="", help="Optional dataset manifest JSON path.")
    parser.add_argument("--dataset-id", default="", help="Stable dataset id for emitted samples.")
    return parser.parse_args()


def _selected_source(value: str) -> TraceAdapterSource:
    if value in ("auto", "mujoco", "genesis", "ros", "lerobot"):
        return cast(TraceAdapterSource, value)
    raise ValueError(f"Unsupported trace adapter source: {value}")


def main() -> int:
    args = _parse_args()
    trace = compile_trace_adapter_file(Path(args.input), source=_selected_source(args.source))
    samples = build_trace_adapter_dataset(trace)
    artifacts: dict[str, str] = {}
    if args.trace_out:
        trace_path = Path(args.trace_out)
        trace_path.parent.mkdir(parents=True, exist_ok=True)
        trace_path.write_text(trace.model_dump_json(indent=2) + "\n", encoding="utf-8")
        artifacts["trace"] = str(trace_path)
    manifest = None
    if args.dataset_out:
        dataset_path = Path(args.dataset_out)
        manifest = write_world_model_dataset_jsonl(
            samples,
            output_path=dataset_path,
            dataset_id=args.dataset_id or f"{trace.trace_id}:trace-adapter:wsp-samples",
            manifest_path=Path(args.manifest_out) if args.manifest_out else None,
            metadata={
                "source_kind": trace.metadata.get("source_kind"),
                "adapter_schema_version": trace.metadata.get("adapter_schema_version"),
            },
        )
        artifacts["dataset"] = str(dataset_path)
        if args.manifest_out:
            artifacts["manifest"] = args.manifest_out
    summary = {
        "success": len(samples) > 0,
        "trace_id": trace.trace_id,
        "source_kind": trace.metadata.get("source_kind"),
        "frame_count": len(trace.frames),
        "action_count": len(trace.actions),
        "sample_count": len(samples),
        "artifacts": artifacts,
        "manifest": manifest.model_dump(mode="json") if manifest is not None else None,
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
