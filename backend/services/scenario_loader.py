from __future__ import annotations

import json
import re
from pathlib import Path

import yaml
from pydantic import ValidationError

from backend.models.scenario import (
    SCENARIO_SCHEMA_VERSION,
    EpisodeManifest,
    ScenarioDocument,
    ScenarioSuccessSpec,
)
from backend.models.world_scene_package import WorldSceneRegistryEnvelope
from backend.models.json_payload import JsonObject
from backend.services.world_scene_package_compat import read_world_scene_registry_envelope

SCENARIO_FILENAME = "scenario.yaml"

_INSTRUCTION_OBJECT_PATTERN = re.compile(r"\{object:([A-Za-z0-9_\-]+)\}")


class ScenarioLoadError(ValueError):
    ...


def load_scenario(path: str | Path) -> ScenarioDocument:
    """Load and validate a scenario document from a YAML/JSON file or directory."""
    scenario_path = Path(path)
    if scenario_path.is_dir():
        scenario_path = scenario_path / SCENARIO_FILENAME
    if not scenario_path.is_file():
        raise ScenarioLoadError(f"Scenario file was not found: {scenario_path}")
    raw = scenario_path.read_text(encoding="utf-8")
    try:
        payload = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise ScenarioLoadError(f"Scenario file is not valid YAML/JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ScenarioLoadError("Scenario document must be a mapping.")
    if payload.get("schema_version") != SCENARIO_SCHEMA_VERSION:
        raise ScenarioLoadError(
            f"schema_version must be {SCENARIO_SCHEMA_VERSION!r}, "
            f"got {payload.get('schema_version')!r}."
        )
    try:
        scenario = ScenarioDocument.model_validate(payload)
    except ValidationError as exc:
        raise ScenarioLoadError(f"Invalid scenario document: {exc}") from exc
    _validate_success_conditions(scenario.success)
    _validate_object_references(scenario)
    return scenario


def resolve_scenario_asset_path(scenario_path: str | Path, asset_ref: str) -> Path:
    """Resolve an asset reference relative to the scenario file's directory."""
    base = Path(scenario_path)
    if base.is_file():
        base = base.parent
    resolved = (base / asset_ref).resolve()
    if not resolved.is_file():
        raise ScenarioLoadError(f"Scenario asset was not found: {resolved}")
    return resolved


def load_scenario_world(
    scenario_path: str | Path,
    scenario: ScenarioDocument,
) -> WorldSceneRegistryEnvelope:
    world_path = resolve_scenario_asset_path(scenario_path, scenario.world.package)
    try:
        payload = json.loads(world_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ScenarioLoadError(f"World package is not valid JSON: {world_path}") from exc
    try:
        return read_world_scene_registry_envelope(payload)
    except (ValidationError, ValueError) as exc:
        raise ScenarioLoadError(f"Invalid world package {world_path}: {exc}") from exc


def resolve_instruction(scenario: ScenarioDocument) -> str:
    """Expand {object:binding_name} templates against task object bindings."""

    def _replace(match: re.Match[str]) -> str:
        binding_name = match.group(1)
        binding = scenario.task.objects.get(binding_name)
        if binding is None:
            raise ScenarioLoadError(
                f"Instruction references unknown object binding {binding_name!r}."
            )
        return binding.world_object_id

    return _INSTRUCTION_OBJECT_PATTERN.sub(_replace, scenario.task.instruction)


# --- success-condition compilation into the Genie Sim checker DSL ---
#
# Each structured condition compiles to a single vendored checker node
# ({"CheckerName": "pipe|separated|args"}) consumed verbatim by the vendored
# geniesim_benchmark parse_action (backend/vendor/geniesim/...).


def _compile_inside(params: JsonObject) -> JsonObject:
    ratio = params.get("ratio", 1.0)
    return {"Inside": f"{params['object']}|{params['container']}|{ratio}"}


def _compile_inbbox(params: JsonObject) -> JsonObject:
    center = ",".join(str(float(v)) for v in params["center"])
    size = ",".join(str(float(v)) for v in params["size"])
    return {"InBBox": f"{params['object']}|{center}|{size}"}


def _compile_ontop(params: JsonObject) -> JsonObject:
    return {"Ontop": f"{params['object']}|{params['base']}"}


def _compile_onfloor(params: JsonObject) -> JsonObject:
    height = params.get("height_m", 0.05)
    return {"Onfloor": f"{params['object']}|{height}"}


def _compile_liftup(params: JsonObject) -> JsonObject:
    return {"LiftUp": f"{params['object']}|{float(params['height_m'])}"}


def _compile_upright(params: JsonObject) -> JsonObject:
    tilt = float(params.get("tilt_threshold_deg", 10.0))
    allow_flipped = "true" if params.get("allow_flipped") else "false"
    return {"Upright": f"{params['object']}|{tilt}|{allow_flipped}"}


def _compile_stack(params: JsonObject) -> JsonObject:
    objects = "[" + ",".join(str(o) for o in params["objects"]) + "]"
    xy = params.get("xy_threshold_m", (0.05, 0.05))
    return {"Stack": f"{objects}|[{float(xy[0])},{float(xy[1])}]"}


_SUCCESS_COMPILERS = {
    "inside": _compile_inside,
    "inbbox": _compile_inbbox,
    "ontop": _compile_ontop,
    "onfloor": _compile_onfloor,
    "liftup": _compile_liftup,
    "upright": _compile_upright,
    "stack": _compile_stack,
}

SUPPORTED_SUCCESS_CONDITIONS = frozenset(_SUCCESS_COMPILERS)

# Guard checks are evaluated by the episode runner itself (decision: reject),
# not by the vendored action tree.
SUPPORTED_GUARDS = frozenset({"no_collision", "above_plane", "stable_for"})


def _validate_success_conditions(success: ScenarioSuccessSpec) -> None:
    if success.acts is not None:
        return
    if not success.all_of:
        raise ScenarioLoadError("success.all_of must contain at least one condition (or set success.acts).")
    for index, entry in enumerate(success.all_of):
        (name, params), = entry.items()
        if name not in SUPPORTED_SUCCESS_CONDITIONS:
            allowed = ", ".join(sorted(SUPPORTED_SUCCESS_CONDITIONS))
            raise ScenarioLoadError(
                f"success.all_of[{index}]: unsupported condition {name!r}. Supported: {allowed}."
            )
        try:
            _SUCCESS_COMPILERS[name](params if isinstance(params, dict) else {})
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            raise ScenarioLoadError(f"success.all_of[{index}] ({name}): invalid params: {exc}") from exc
    for index, entry in enumerate(success.guards):
        (name, _params), = entry.items()
        if name not in SUPPORTED_GUARDS:
            allowed = ", ".join(sorted(SUPPORTED_GUARDS))
            raise ScenarioLoadError(
                f"success.guards[{index}]: unsupported guard {name!r}. Supported: {allowed}."
            )


def _validate_object_references(scenario: ScenarioDocument) -> None:
    for object_id, jitter in scenario.task.randomization.object_pose.items():
        if jitter.region is not None and jitter.region not in scenario.task.randomization.regions:
            raise ScenarioLoadError(
                f"randomization.object_pose[{object_id!r}] references unknown region "
                f"{jitter.region!r}."
            )
    # Instruction templating must resolve.
    _INSTRUCTION_OBJECT_PATTERN.sub("", scenario.task.instruction)
    for match in _INSTRUCTION_OBJECT_PATTERN.finditer(scenario.task.instruction):
        if match.group(1) not in scenario.task.objects:
            raise ScenarioLoadError(
                f"Instruction references unknown object binding {match.group(1)!r}."
            )


def compile_success_to_acts(success: ScenarioSuccessSpec) -> JsonObject:
    """Compile the structured success spec into a Genie Sim Acts dict.

    Shape: WaitAny([WaitAll([conditions...]), Timeout]) so a timeout ends the
    episode (decision: stop) while all conditions passing means success.
    """
    if success.acts is not None:
        return success.acts
    conditions = [
        _SUCCESS_COMPILERS[name](params if isinstance(params, dict) else {})
        for entry in success.all_of
        for name, params in entry.items()
    ]
    all_node: JsonObject = {"ActionSetWaitAll": conditions}
    if success.timeout_sim_seconds is None:
        return all_node
    return {
        "ActionSetWaitAny": [
            all_node,
            {"Timeout": success.timeout_sim_seconds},
        ]
    }


def validate_scenario_against_world(
    scenario: ScenarioDocument,
    world: WorldSceneRegistryEnvelope,
) -> list[str]:
    """Cross-check scenario object references against the world document."""
    errors: list[str] = []
    world_object_ids = {
        str(world_object.get("id", "")).strip()
        for world_object in world.world.objects
        if isinstance(world_object, dict)
    }
    for binding_name, binding in scenario.task.objects.items():
        if binding.world_object_id not in world_object_ids:
            errors.append(
                f"task.objects[{binding_name!r}] references world object "
                f"{binding.world_object_id!r}, which is not present in the world package."
            )
    for object_id in scenario.task.randomization.object_pose:
        if object_id not in world_object_ids:
            errors.append(
                f"randomization.object_pose references unknown world object {object_id!r}."
            )
    return errors
