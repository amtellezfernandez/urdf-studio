from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from backend.services.scenario_loader import (
    ScenarioLoadError,
    compile_success_to_acts,
    load_scenario,
    load_scenario_world,
    resolve_instruction,
    validate_scenario_against_world,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
EXAMPLE_SCENARIO_DIR = REPO_ROOT / "scenarios" / "carton_sorting_0001"


def _example_payload() -> dict:
    return yaml.safe_load((EXAMPLE_SCENARIO_DIR / "scenario.yaml").read_text(encoding="utf-8"))


def _write_scenario(tmp_path: Path, payload: dict) -> Path:
    path = tmp_path / "scenario.yaml"
    path.write_text(yaml.safe_dump(payload), encoding="utf-8")
    return path


def test_example_scenario_loads_and_cross_validates() -> None:
    scenario = load_scenario(EXAMPLE_SCENARIO_DIR)
    world = load_scenario_world(EXAMPLE_SCENARIO_DIR, scenario)

    assert scenario.scenario_id == "carton_sorting_0001"
    assert world.package_id == "carton-sorting"
    assert validate_scenario_against_world(scenario, world) == []
    assert resolve_instruction(scenario) == "Pick up the carton_1 and place it into bin_a"


def test_success_compiles_to_genie_checker_dsl() -> None:
    scenario = load_scenario(EXAMPLE_SCENARIO_DIR)

    acts = compile_success_to_acts(scenario.success)

    assert acts == {
        "ActionSetWaitAny": [
            {"ActionSetWaitAll": [{"Inside": "carton_1|bin_a|1.2"}]},
            {"Timeout": 30.0},
        ]
    }


def test_success_without_timeout_compiles_to_wait_all(tmp_path: Path) -> None:
    payload = _example_payload()
    payload["success"].pop("timeout_sim_seconds")
    payload["success"]["all_of"] = [
        {"ontop": {"object": "carton_1", "base": "work_table"}},
        {"liftup": {"object": "carton_1", "height_m": 0.15}},
        {"upright": {"object": "carton_1", "tilt_threshold_deg": 20, "allow_flipped": True}},
        {"stack": {"objects": ["carton_1", "bin_a"], "xy_threshold_m": [0.02, 0.03]}},
        {"inbbox": {"object": "carton_1", "center": [0.4, 0.3, 0.8], "size": [0.3, 0.3, 0.3]}},
        {"onfloor": {"object": "carton_1", "height_m": 0.04}},
    ]
    scenario = load_scenario(_write_scenario(tmp_path, payload))

    acts = compile_success_to_acts(scenario.success)

    assert acts == {
        "ActionSetWaitAll": [
            {"Ontop": "carton_1|work_table"},
            {"LiftUp": "carton_1|0.15"},
            {"Upright": "carton_1|20.0|true"},
            {"Stack": "[carton_1,bin_a]|[0.02,0.03]"},
            {"InBBox": "carton_1|0.4,0.3,0.8|0.3,0.3,0.3"},
            {"Onfloor": "carton_1|0.04"},
        ]
    }


def test_raw_acts_passthrough_overrides_structured_form(tmp_path: Path) -> None:
    payload = _example_payload()
    payload["success"] = {"acts": {"ActionSetWaitAll": [{"Inside": "a|b|1.0"}]}}
    scenario = load_scenario(_write_scenario(tmp_path, payload))

    assert compile_success_to_acts(scenario.success) == {
        "ActionSetWaitAll": [{"Inside": "a|b|1.0"}]
    }


def test_rejects_wrong_schema_version(tmp_path: Path) -> None:
    payload = _example_payload()
    payload["schema_version"] = "scenario-v0"

    with pytest.raises(ScenarioLoadError, match="schema_version"):
        load_scenario(_write_scenario(tmp_path, payload))


def test_rejects_unknown_success_condition(tmp_path: Path) -> None:
    payload = _example_payload()
    payload["success"]["all_of"] = [{"levitates": {"object": "carton_1"}}]

    with pytest.raises(ScenarioLoadError, match="unsupported condition 'levitates'"):
        load_scenario(_write_scenario(tmp_path, payload))


def test_rejects_unknown_guard(tmp_path: Path) -> None:
    payload = _example_payload()
    payload["success"]["guards"] = [{"never_explodes": {}}]

    with pytest.raises(ScenarioLoadError, match="unsupported guard 'never_explodes'"):
        load_scenario(_write_scenario(tmp_path, payload))


def test_rejects_unknown_randomization_region(tmp_path: Path) -> None:
    payload = _example_payload()
    payload["task"]["randomization"]["object_pose"]["carton_1"]["region"] = "the_moon"

    with pytest.raises(ScenarioLoadError, match="unknown region 'the_moon'"):
        load_scenario(_write_scenario(tmp_path, payload))


def test_rejects_instruction_with_unknown_binding(tmp_path: Path) -> None:
    payload = _example_payload()
    payload["task"]["instruction"] = "Move the {object:ghost} somewhere"

    with pytest.raises(ScenarioLoadError, match="unknown object binding 'ghost'"):
        load_scenario(_write_scenario(tmp_path, payload))


def test_cross_validation_reports_missing_world_object(tmp_path: Path) -> None:
    payload = _example_payload()
    payload["task"]["objects"]["bin"]["world_object_id"] = "bin_z"
    scenario_path = _write_scenario(tmp_path, payload)
    scenario = load_scenario(scenario_path)
    world = load_scenario_world(EXAMPLE_SCENARIO_DIR, scenario)

    errors = validate_scenario_against_world(scenario, world)

    assert any("bin_z" in error for error in errors)
