"""Persist a browser-recorded motion as a runnable scenario.

Turns a recorded waypoint document + the current world into a scenario
directory under the writable user library, so it immediately appears in the
Scenarios panel and runs across simulators with no new run plumbing. The
written scenario is validated with the same loader the runtime uses before it
is returned, so an authored scenario can never be un-runnable.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

import yaml

from backend.models.scenario_service import ScenarioAuthoringRequest, ScenarioSummary
from backend.services.scenario_library import (
    is_valid_scenario_id,
    scenario_library_root,
    user_scenario_library_root,
)
from backend.services.scenario_loader import (
    ScenarioLoadError,
    load_scenario,
    load_scenario_world,
    resolve_instruction,
    validate_scenario_against_world,
)
from backend.services.world_scene_package_compat import read_world_scene_registry_envelope

_AUTHORED_WORLD_FILENAME = "world.world-package.json"
_AUTHORED_WAYPOINTS_FILENAME = "waypoints.json"
_AUTHORED_ROBOT_FILENAME = "robot.urdf"
_TIMEOUT_MARGIN_S = 5.0
_DEFAULT_TIMEOUT_S = 30.0


class ScenarioAuthoringError(ValueError):
    ...


def _slugify(name: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_\-]+", "_", name.strip()).strip("_")
    if slug and not slug[0].isalnum():
        slug = f"s_{slug}"
    return slug or "authored_scenario"


def _waypoints_timeout_s(waypoints: dict) -> float:
    entries = waypoints.get("waypoints") if isinstance(waypoints, dict) else None
    if not isinstance(entries, list) or not entries:
        return _DEFAULT_TIMEOUT_S
    last_time = 0.0
    for entry in entries:
        if isinstance(entry, dict):
            try:
                last_time = max(last_time, float(entry.get("time_s", 0.0)))
            except (TypeError, ValueError):
                continue
    return round(last_time + _TIMEOUT_MARGIN_S, 3)


def _validate_waypoints(waypoints: dict) -> None:
    entries = waypoints.get("waypoints") if isinstance(waypoints, dict) else None
    if not isinstance(entries, list) or not entries:
        raise ScenarioAuthoringError("waypoints must contain a non-empty 'waypoints' list.")
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict) or "time_s" not in entry or "joints" not in entry:
            raise ScenarioAuthoringError(
                f"waypoints[{index}] must have 'time_s' and 'joints'."
            )
        if not isinstance(entry.get("joints"), dict):
            raise ScenarioAuthoringError(f"waypoints[{index}].joints must be an object.")


def _world_object_ids(envelope) -> set[str]:
    return {
        str(world_object.get("id", "")).strip()
        for world_object in envelope.world.objects
        if isinstance(world_object, dict)
    }


def _build_scenario_yaml(
    request: ScenarioAuthoringRequest,
    scenario_id: str,
    *,
    uses_attach: bool,
    has_robot_urdf: bool,
) -> dict:
    document: dict = {
        "schema_version": "scenario-v1",
        "scenario_id": scenario_id,
        "title": request.name,
        "world": {
            "package": f"./{_AUTHORED_WORLD_FILENAME}",
            "frame_map": "identity",
            "include_hidden": False,
        },
        "task": {
            "family": "authored",
            "instruction": "Move the {object:target} into {object:container}",
            "objects": {
                "target": {"role": "target", "world_object_id": request.target_object_id},
                "container": {
                    "role": "container",
                    "world_object_id": request.container_object_id,
                },
            },
        },
        "success": {
            "all_of": [
                {
                    "inside": {
                        "object": request.target_object_id,
                        "container": request.container_object_id,
                        "ratio": 1.2,
                    }
                }
            ],
            "timeout_sim_seconds": _waypoints_timeout_s(request.waypoints),
        },
        "runtime": {
            "physics_timestep_s": 0.002,
            "control_hz": 50,
            "checker_interval_steps": 5,
            "max_episode_steps": 1500,
            "observation": {"modalities": ["joint_positions", "object_poses"]},
        },
        "policy": {
            "kind": "waypoint",
            "params": {"waypoints_file": f"./{_AUTHORED_WAYPOINTS_FILENAME}"},
        },
        "metrics": ["success_rate", "time_to_success_s", "final_object_pose_error_m"],
        "evaluation": {
            "episodes": 1,
            "seeds": [0],
            "record_trace": True,
            "record_decisions": True,
            "record_video": False,
        },
    }
    if has_robot_urdf:
        document["robot"] = {"urdf": f"./{_AUTHORED_ROBOT_FILENAME}"}
    if uses_attach:
        document["runtime"]["grasp_attach"] = "weld"
        document["runtime"]["attach_link"] = request.attach_link
    return document


def save_recorded_scenario(request: ScenarioAuthoringRequest) -> ScenarioSummary:
    scenario_id = _slugify(request.name)
    if not is_valid_scenario_id(scenario_id):
        raise ScenarioAuthoringError(f"Could not derive a valid scenario id from {request.name!r}.")
    if (scenario_library_root() / scenario_id / "scenario.yaml").is_file():
        raise ScenarioAuthoringError(
            f"Scenario id {scenario_id!r} collides with a shipped scenario; choose another name."
        )

    try:
        envelope = read_world_scene_registry_envelope(request.world)
    except (ValueError, TypeError) as exc:
        raise ScenarioAuthoringError(f"Invalid world payload: {exc}") from exc
    _validate_waypoints(request.waypoints)

    object_ids = _world_object_ids(envelope)
    for role, object_id in (
        ("target", request.target_object_id),
        ("container", request.container_object_id),
    ):
        if object_id not in object_ids:
            raise ScenarioAuthoringError(
                f"{role} object {object_id!r} is not present in the world."
            )

    uses_attach = any(
        isinstance(entry, dict) and entry.get("attach")
        for entry in request.waypoints.get("waypoints", [])
    )
    if uses_attach and not request.attach_link:
        raise ScenarioAuthoringError(
            "Waypoints contain attach events but no attach_link was provided."
        )

    scenario_dir = user_scenario_library_root() / scenario_id
    if scenario_dir.exists():
        raise ScenarioAuthoringError(
            f"Scenario id {scenario_id!r} already exists; choose another name."
        )
    scenario_dir.mkdir(parents=True, exist_ok=True)
    try:
        world_payload = envelope.model_dump(mode="json", exclude_none=True)
        (scenario_dir / _AUTHORED_WORLD_FILENAME).write_text(
            json.dumps(world_payload, indent=2), encoding="utf-8"
        )
        (scenario_dir / _AUTHORED_WAYPOINTS_FILENAME).write_text(
            json.dumps(request.waypoints, indent=2), encoding="utf-8"
        )
        has_robot_urdf = bool(request.robot_urdf and request.robot_urdf.strip())
        if has_robot_urdf:
            (scenario_dir / _AUTHORED_ROBOT_FILENAME).write_text(
                request.robot_urdf, encoding="utf-8"
            )
        document = _build_scenario_yaml(
            request, scenario_id, uses_attach=uses_attach, has_robot_urdf=has_robot_urdf
        )
        (scenario_dir / "scenario.yaml").write_text(
            yaml.safe_dump(document, sort_keys=False), encoding="utf-8"
        )

        scenario = load_scenario(scenario_dir)
        world = load_scenario_world(scenario_dir, scenario)
        cross_errors = validate_scenario_against_world(scenario, world)
        if cross_errors:
            raise ScenarioAuthoringError("; ".join(cross_errors))
        instruction = resolve_instruction(scenario)
    except (ScenarioLoadError, ScenarioAuthoringError) as exc:
        shutil.rmtree(scenario_dir, ignore_errors=True)
        raise ScenarioAuthoringError(str(exc)) from exc

    return ScenarioSummary(
        scenario_id=scenario.scenario_id,
        title=scenario.title,
        task_family=scenario.task.family,
        instruction=instruction,
        world_package=scenario.world.package,
        default_sims=["mujoco", "genesis"],
        episodes=scenario.evaluation.episodes,
        success_condition_count=len(scenario.success.all_of),
    )
