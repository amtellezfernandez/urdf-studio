"""Emit the open-contract JSON Schemas from the pydantic models.

The World and Scenario formats are the platform's public contracts (see the
dual-license stance in CONTRIBUTING/README): third-party tooling should be
able to validate `world-v1` / `scenario-v1` documents without importing this
codebase. This script generates draft 2020-12 JSON Schemas from the
authoritative pydantic models so the published schemas never drift from the
runtime validators.

    python -m backend.scripts.generate_contract_schemas [--check]

`--check` fails (exit 1) if the committed schema files are stale — wire it
into CI so a model change that isn't reflected in the schemas is caught.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from backend.models.scenario import ScenarioDocument
from backend.models.world_scene_package import WorldSceneRegistryEnvelope

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SPECS_DIR = _REPO_ROOT / "docs" / "specs"

CONTRACTS_LICENSE = "CC0-1.0"
CONTRACTS_LICENSE_NOTE = (
    "This JSON Schema describes a public URDF Studio data contract and is released "
    "under CC0-1.0 (public domain). It is generated from "
    "backend/scripts/generate_contract_schemas.py; edit the pydantic models, not this file. "
    "The schema is open; the URDF Studio implementation is separately licensed (see LICENSE)."
)


class _Contract:
    def __init__(self, *, model: type[BaseModel], schema_id: str, title: str, filename: str) -> None:
        self.model = model
        self.schema_id = schema_id
        self.title = title
        self.filename = filename


CONTRACTS = (
    _Contract(
        model=WorldSceneRegistryEnvelope,
        schema_id="https://urdf.studio/specs/world-1.0.0.schema.json",
        title="URDF Studio World (world-v1)",
        filename="world-v1.schema.json",
    ),
    _Contract(
        model=ScenarioDocument,
        schema_id="https://urdf.studio/specs/scenario-1.0.0.schema.json",
        title="URDF Studio Scenario (scenario-v1)",
        filename="scenario-v1.schema.json",
    ),
)


def build_schema(contract: _Contract) -> dict[str, Any]:
    schema = contract.model.model_json_schema()
    ordered: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": contract.schema_id,
        "title": contract.title,
        "x-license": CONTRACTS_LICENSE,
        "x-license-note": CONTRACTS_LICENSE_NOTE,
        "x-generated-by": "backend/scripts/generate_contract_schemas.py",
    }
    # Preserve the pydantic-emitted body (type/properties/$defs/…) after our metadata.
    for key, value in schema.items():
        if key in ("$schema", "$id", "title"):
            continue
        ordered[key] = value
    return ordered


def _serialize(schema: dict[str, Any]) -> str:
    return json.dumps(schema, indent=2, sort_keys=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify committed schemas are up to date (non-zero exit if stale).",
    )
    args = parser.parse_args(argv)

    stale: list[str] = []
    for contract in CONTRACTS:
        path = _SPECS_DIR / contract.filename
        content = _serialize(build_schema(contract))
        if args.check:
            existing = path.read_text(encoding="utf-8") if path.is_file() else ""
            if existing != content:
                stale.append(contract.filename)
        else:
            path.write_text(content, encoding="utf-8")
            print(f"wrote {path.relative_to(_REPO_ROOT)}")

    if args.check:
        if stale:
            print(
                "Contract schemas are stale (regenerate with "
                "`python -m backend.scripts.generate_contract_schemas`): "
                + ", ".join(stale),
                file=sys.stderr,
            )
            return 1
        print("contract schemas are up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
