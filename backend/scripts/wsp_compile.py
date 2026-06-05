from __future__ import annotations

import argparse
from pathlib import Path

from backend.services.physical_state_compiler import compile_physical_state_payload


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compile WSP/static scene input into physical-state tokens.")
    parser.add_argument("input", help="Path to a world package, world layout, or manifest JSON file.")
    parser.add_argument("--out", default="", help="Optional output path. Defaults to stdout.")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    compiled = compile_physical_state_payload(Path(args.input).read_text(encoding="utf-8"))
    output = compiled.model_dump_json(indent=2)
    if args.out:
        Path(args.out).write_text(output + "\n", encoding="utf-8")
    else:
        print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
