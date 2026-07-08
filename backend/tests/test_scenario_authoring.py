"""Saving a browser-recorded motion as a runnable scenario."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.models.scenario_service import ScenarioAuthoringRequest
from backend.services.scenario_authoring import ScenarioAuthoringError, save_recorded_scenario
from backend.services.scenario_library import (
    USER_SCENARIO_LIBRARY_ENV_VAR,
    list_scenarios,
    scenario_directory,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
CARTON_WORLD = REPO_ROOT / "scenarios" / "carton_sorting_0001" / "carton-sorting.world-package.json"


@pytest.fixture(autouse=True)
def _user_library(tmp_path, monkeypatch):
    monkeypatch.setenv(USER_SCENARIO_LIBRARY_ENV_VAR, str(tmp_path / "user-scenarios"))
    return tmp_path


def _world_payload() -> dict:
    return json.loads(CARTON_WORLD.read_text(encoding="utf-8"))


def _waypoints(*, with_attach: bool = False) -> dict:
    waypoints = [
        {"time_s": 0.0, "joints": {"gantry_x": 0.4, "gantry_y": -0.15, "gantry_z": 0.0}},
        {"time_s": 2.0, "joints": {"gantry_x": 0.45, "gantry_y": 0.3, "gantry_z": 0.0}},
    ]
    if with_attach:
        waypoints[0]["attach"] = "carton_1"
    return {"waypoints": waypoints}


def _request(**overrides) -> ScenarioAuthoringRequest:
    payload = {
        "name": "My Recorded Pick",
        "world": _world_payload(),
        "waypoints": _waypoints(),
        "target_object_id": "carton_1",
        "container_object_id": "bin_a",
    }
    payload.update(overrides)
    return ScenarioAuthoringRequest(**payload)


def test_saved_scenario_is_valid_and_listed() -> None:
    summary = save_recorded_scenario(_request())

    assert summary.scenario_id == "My_Recorded_Pick"
    assert summary.task_family == "authored"
    assert "carton_1" in summary.instruction
    directory = scenario_directory(summary.scenario_id)
    assert (directory / "scenario.yaml").is_file()
    assert (directory / "world.world-package.json").is_file()
    assert (directory / "waypoints.json").is_file()
    assert any(entry.scenario_id == summary.scenario_id for entry in list_scenarios())


def test_saved_scenario_timeout_follows_last_waypoint() -> None:
    import yaml

    summary = save_recorded_scenario(_request())
    scenario_yaml = yaml.safe_load(
        (scenario_directory(summary.scenario_id) / "scenario.yaml").read_text(encoding="utf-8")
    )

    assert scenario_yaml["success"]["timeout_sim_seconds"] == pytest.approx(7.0)  # 2.0 + margin
    assert scenario_yaml["policy"]["kind"] == "waypoint"


def test_attach_waypoints_enable_weld_and_require_link() -> None:
    with pytest.raises(ScenarioAuthoringError, match="attach_link"):
        save_recorded_scenario(_request(waypoints=_waypoints(with_attach=True)))

    summary = save_recorded_scenario(
        _request(
            name="Weld Pick",
            waypoints=_waypoints(with_attach=True),
            attach_link="magnet_link",
        )
    )
    import yaml

    scenario_yaml = yaml.safe_load(
        (scenario_directory(summary.scenario_id) / "scenario.yaml").read_text(encoding="utf-8")
    )
    assert scenario_yaml["runtime"]["grasp_attach"] == "weld"
    assert scenario_yaml["runtime"]["attach_link"] == "magnet_link"


def test_rejects_unknown_target_object() -> None:
    with pytest.raises(ScenarioAuthoringError, match="not present in the world"):
        save_recorded_scenario(_request(target_object_id="ghost"))


def test_rejects_collision_with_shipped_scenario() -> None:
    with pytest.raises(ScenarioAuthoringError, match="shipped scenario"):
        save_recorded_scenario(_request(name="carton_sorting_0001"))


def test_rejects_empty_waypoints() -> None:
    with pytest.raises(ScenarioAuthoringError, match="non-empty"):
        save_recorded_scenario(_request(waypoints={"waypoints": []}))


@pytest.mark.skipif(
    __import__("importlib").util.find_spec("mujoco") is None, reason="mujoco not installed"
)
def test_saved_scenario_runs_on_mujoco() -> None:
    demo_dir = REPO_ROOT / "scenarios" / "carton_sorting_0001"
    gantry_urdf = (demo_dir / "gantry.urdf").read_text(encoding="utf-8")
    # A good recording succeeds: reuse the demo's known-good pick-place waypoints.
    demo_waypoints = json.loads((demo_dir / "waypoints.json").read_text(encoding="utf-8"))
    summary = save_recorded_scenario(
        _request(
            name="Runnable Pick",
            waypoints=demo_waypoints,
            attach_link="magnet_link",
            robot_urdf=gantry_urdf,
        )
    )
    from backend.models.scenario import EpisodeManifest, EpisodeObjectPlacement
    from backend.services.scenario_loader import load_scenario
    from backend.services.scenario_runtime.episode_runner import run_episode
    from backend.services.sim_backends.mujoco_backend import build_mujoco_backend

    scenario_dir = scenario_directory(summary.scenario_id)
    scenario = load_scenario(scenario_dir)
    backend = build_mujoco_backend(scenario, scenario_dir)
    manifest = EpisodeManifest(
        scenario_id=scenario.scenario_id,
        episode_index=0,
        seed=0,
        object_placements={
            "carton_1": EpisodeObjectPlacement(
                position_xyz=(0.4, -0.15, 0.755), rotation_rpy_rad=(0.0, 0.0, 0.0)
            )
        },
        init_joint_positions={"gantry_x": 0.4, "gantry_y": -0.15, "gantry_z": 0.0},
    )
    from backend.services.scenario_policies import build_scenario_policy

    result = run_episode(
        scenario=scenario,
        manifest=manifest,
        backend=backend,
        output_dir=scenario_dir / "_run",
        policy=build_scenario_policy(scenario, scenario_dir),
    )
    assert result.success is True
