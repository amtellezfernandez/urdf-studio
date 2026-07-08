"""The published world-v1 / scenario-v1 JSON Schemas stay in sync with the
pydantic models and accept the shipped fixtures."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from backend.scripts.generate_contract_schemas import CONTRACTS, build_schema, main as generate_main

REPO_ROOT = Path(__file__).resolve().parents[2]
SPECS_DIR = REPO_ROOT / "docs" / "specs"
CARTON_DIR = REPO_ROOT / "scenarios" / "carton_sorting_0001"


def test_committed_schemas_match_models() -> None:
    # The --check path is what CI runs; failing here means someone changed a
    # model without regenerating the schemas.
    assert generate_main(["--check"]) == 0


def test_schemas_declare_open_contract_license() -> None:
    for contract in CONTRACTS:
        schema = json.loads((SPECS_DIR / contract.filename).read_text(encoding="utf-8"))
        assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
        assert schema["x-license"] == "CC0-1.0"
        assert "$id" in schema and "$defs" in schema


def test_world_fixture_validates_against_world_schema() -> None:
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads((SPECS_DIR / "world-v1.schema.json").read_text(encoding="utf-8"))
    world = json.loads((CARTON_DIR / "carton-sorting.world-package.json").read_text(encoding="utf-8"))

    jsonschema.validate(world, schema)


def test_scenario_fixture_validates_against_scenario_schema() -> None:
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads((SPECS_DIR / "scenario-v1.schema.json").read_text(encoding="utf-8"))
    scenario = yaml.safe_load((CARTON_DIR / "scenario.yaml").read_text(encoding="utf-8"))

    jsonschema.validate(scenario, schema)


def test_build_schema_is_deterministic() -> None:
    for contract in CONTRACTS:
        assert build_schema(contract) == build_schema(contract)
