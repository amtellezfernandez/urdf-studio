from __future__ import annotations

import argparse
from pathlib import Path

from backend.services.robot_reality_log import compile_robot_reality_log_file


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compile an observed robot-state/action log into a WSP trace.")
    parser.add_argument("input", help="Path to a JSON or JSONL robot reality log.")
    parser.add_argument("--out", required=True, help="Output PhysicalRolloutTrace JSON path.")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    trace = compile_robot_reality_log_file(Path(args.input))
    output_path = Path(args.out)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(trace.model_dump_json(indent=2) + "\n", encoding="utf-8")
    print(
        trace.model_dump_json(
            indent=2,
            include={
                "trace_id",
                "metadata",
            },
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
