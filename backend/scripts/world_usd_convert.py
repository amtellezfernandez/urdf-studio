"""Convert between the World format and OpenUSD.

Usage:
    python -m backend.scripts.world_usd_convert export <world-package.json> <out.usda>
    python -m backend.scripts.world_usd_convert import <in.usd[a|c|z]> <out.world-package.json>
                                                    [--package-id ID] [--version V]

The JSON World document remains the canonical format; USD is interchange
(docs/specs/WORLD_FORMAT.md, "OpenUSD interchange").
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from backend.services.world_usd_interchange import (
    WorldUsdInterchangeError,
    export_world_to_usda,
    import_usd_to_world,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    export_parser = subparsers.add_parser("export", help="World package JSON -> .usda")
    export_parser.add_argument("world_package")
    export_parser.add_argument("output")

    import_parser = subparsers.add_parser("import", help="USD stage -> world package JSON")
    import_parser.add_argument("usd_file")
    import_parser.add_argument("output")
    import_parser.add_argument("--package-id", default=None)
    import_parser.add_argument("--version", default="1.0.0")

    args = parser.parse_args(argv)
    try:
        if args.command == "export":
            payload = json.loads(Path(args.world_package).read_text(encoding="utf-8"))
            output = export_world_to_usda(payload, args.output)
            print(f"exported: {output}")
            return 0
        payload = import_usd_to_world(
            args.usd_file, package_id=args.package_id, version=args.version
        )
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        skipped = payload["provenance"].get("skipped_prims", [])
        print(
            f"imported: {output} ({len(payload['world']['objects'])} objects"
            + (f", {len(skipped)} prims skipped" if skipped else "")
            + ")"
        )
        return 0
    except (WorldUsdInterchangeError, OSError, json.JSONDecodeError) as exc:
        print(f"world usd convert failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
