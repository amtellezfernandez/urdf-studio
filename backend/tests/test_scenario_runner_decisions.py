"""Phase-3 episode semantics: waypoint pick-place, guard rejects, decisions."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

pytest.importorskip("mujoco")

from backend.models.scenario import EpisodeManifest, EpisodeObjectPlacement
from backend.models.world_rollouts import WorldRolloutDecisionRecord
from backend.services.scenario_loader import load_scenario
from backend.services.scenario_policies import build_scenario_policy
from backend.services.scenario_runtime.episode_runner import run_episode
from backend.services.sim_backends.mujoco_backend import build_mujoco_backend

REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIO_DIR = REPO_ROOT / "scenarios" / "carton_sorting_0001"

PICK_MANIFEST = EpisodeManifest(
    scenario_id="carton_sorting_0001",
    episode_index=0,
    seed=0,
    object_placements={
        "carton_1": EpisodeObjectPlacement(
            position_xyz=(0.4, -0.15, 0.755), rotation_rpy_rad=(0.0, 0.0, 0.0)
        )
    },
    init_joint_positions={"gantry_x": 0.4, "gantry_y": -0.15, "gantry_z": 0.0},
)


def _scenario_dir_with_overrides(tmp_path: Path, mutate) -> Path:
    scenario_dir = tmp_path / "scenario"
    scenario_dir.mkdir()
    for name in ("carton-sorting.world-package.json", "gantry.urdf", "waypoints.json"):
        (scenario_dir / name).write_bytes((SCENARIO_DIR / name).read_bytes())
    payload = yaml.safe_load((SCENARIO_DIR / "scenario.yaml").read_text(encoding="utf-8"))
    mutate(payload, scenario_dir)
    (scenario_dir / "scenario.yaml").write_text(yaml.safe_dump(payload), encoding="utf-8")
    return scenario_dir


def _run(scenario_dir: Path, out_dir: Path, manifest: EpisodeManifest = PICK_MANIFEST):
    scenario = load_scenario(scenario_dir)
    backend = build_mujoco_backend(scenario, scenario_dir)
    policy = build_scenario_policy(scenario, scenario_dir)
    return run_episode(
        scenario=scenario,
        manifest=manifest,
        backend=backend,
        output_dir=out_dir,
        policy=policy,
    )


def _decisions(out_dir: Path) -> list[WorldRolloutDecisionRecord]:
    lines = (out_dir / "decisions.ndjson").read_text(encoding="utf-8").splitlines()
    return [WorldRolloutDecisionRecord.model_validate(json.loads(line)) for line in lines]


def test_waypoint_pick_place_succeeds_with_per_rule_allow(tmp_path: Path) -> None:
    result = _run(SCENARIO_DIR, tmp_path)

    assert result.success is True
    assert result.stop_reason == "success"
    assert result.grasp_attach_used is True
    assert result.scores.get("E2E") == 1
    decisions = _decisions(tmp_path)
    assert [d.decision for d in decisions] == ["allow"]
    assert decisions[0].rule_id.startswith("scenario/inside[")
    carton = result.final_object_poses["carton_1"]["position_xyz"]
    assert abs(carton[0] - 0.45) < 0.05 and abs(carton[1] - 0.3) < 0.05


def test_sabotaged_waypoints_time_out_with_stop_decision(tmp_path: Path) -> None:
    def sabotage(payload: dict, scenario_dir: Path) -> None:
        waypoints = json.loads((scenario_dir / "waypoints.json").read_text(encoding="utf-8"))
        for waypoint in waypoints["waypoints"]:
            waypoint["joints"]["gantry_y"] = -0.42  # deliver to bin_b instead
        (scenario_dir / "waypoints.json").write_text(json.dumps(waypoints), encoding="utf-8")
        payload["success"]["timeout_sim_seconds"] = 8

    scenario_dir = _scenario_dir_with_overrides(tmp_path, sabotage)
    out_dir = tmp_path / "out"

    result = _run(scenario_dir, out_dir)

    assert result.success is False
    assert result.stop_reason == "timeout"
    assert result.scores.get("E2E") == 0
    decisions = _decisions(out_dir)
    assert decisions[-1].decision == "stop"
    assert decisions[-1].rule_id == "scenario/timeout"


def test_forbidden_contact_rejects_episode(tmp_path: Path) -> None:
    def forbid_table_contact(payload: dict, scenario_dir: Path) -> None:
        payload["success"]["guards"] = [
            {"no_collision": {"pairs": [["carton_1", "work_table"]]}}
        ]

    scenario_dir = _scenario_dir_with_overrides(tmp_path, forbid_table_contact)
    out_dir = tmp_path / "out"

    # The carton starts resting on the table -> guard trips on the first tick.
    result = _run(scenario_dir, out_dir)

    assert result.success is False
    assert result.stop_reason == "guard_reject"
    decisions = _decisions(out_dir)
    assert any(
        d.decision == "reject" and d.rule_id.startswith("scenario/no_collision[")
        for d in decisions
    )


def test_stable_for_guard_confirms_settled_place(tmp_path: Path) -> None:
    def add_stability(payload: dict, scenario_dir: Path) -> None:
        payload["success"]["guards"].append(
            {"stable_for": {"object": "carton_1", "seconds": 1.0, "max_drift_m": 0.02}}
        )

    scenario_dir = _scenario_dir_with_overrides(tmp_path, add_stability)
    out_dir = tmp_path / "out"

    result = _run(scenario_dir, out_dir)

    assert result.success is True
    assert result.stop_reason == "success"
    # The stability hold extends sim time past the success tick.
    assert result.sim_time_s >= 5.9
