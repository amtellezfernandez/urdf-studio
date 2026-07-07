"""Shared conformance contract every SimBackend must satisfy.

Runs against FakeBackend and MuJoCo always; Genesis when importable (heavy
init, so it is gated the same way as the other Genesis suites). A future
IsaacBackend must pass this suite unchanged.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
import pytest

from backend.models.scenario import EpisodeManifest, EpisodeObjectPlacement
from backend.services.scenario_loader import load_scenario, load_scenario_world

REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIO_DIR = REPO_ROOT / "scenarios" / "carton_sorting_0001"

_BACKENDS = ["fake"]
if importlib.util.find_spec("mujoco") is not None:
    _BACKENDS.append("mujoco")
if importlib.util.find_spec("genesis") is not None:
    _BACKENDS.append("genesis")


def _build_backend(backend_id: str):
    scenario = load_scenario(SCENARIO_DIR)
    if backend_id == "fake":
        from backend.services.sim_backends.fake_backend import FakeBackend

        world = load_scenario_world(SCENARIO_DIR, scenario)
        return FakeBackend(scenario, world), scenario
    if backend_id == "mujoco":
        from backend.services.sim_backends.mujoco_backend import build_mujoco_backend

        return build_mujoco_backend(scenario, SCENARIO_DIR), scenario
    if backend_id == "genesis":
        from backend.services.sim_backends.genesis_backend import build_genesis_backend

        return build_genesis_backend(scenario, SCENARIO_DIR), scenario
    raise AssertionError(backend_id)


_MANIFEST = EpisodeManifest(
    scenario_id="carton_sorting_0001",
    episode_index=0,
    seed=0,
    object_placements={
        "carton_1": EpisodeObjectPlacement(
            position_xyz=(0.4, -0.15, 0.9), rotation_rpy_rad=(0.0, 0.0, 0.0)
        )
    },
    init_joint_positions={},
)


@pytest.fixture(scope="module", params=_BACKENDS)
def conformant_backend(request):
    backend, scenario = _build_backend(request.param)
    backend.load_scene(physics_timestep_s=scenario.runtime.physics_timestep_s)
    yield backend
    backend.close()


def test_reset_applies_manifest_placements(conformant_backend) -> None:
    observation = conformant_backend.reset_episode(_MANIFEST)

    pose = observation.object_poses["carton_1"]
    assert pose.position_xyz == pytest.approx((0.4, -0.15, 0.9), abs=1e-3)
    assert observation.sim_time_s == pytest.approx(0.0, abs=1e-6)


def test_step_advances_sim_time(conformant_backend) -> None:
    conformant_backend.reset_episode(_MANIFEST)

    conformant_backend.step(None, substeps=10)

    assert conformant_backend.sim_time_s > 0.0
    state = conformant_backend.get_state()
    assert "carton_1" in state.object_poses


def test_apicore_accessors_are_consistent(conformant_backend) -> None:
    conformant_backend.reset_episode(_MANIFEST)

    position, quat = conformant_backend.get_obj_world_pose("/World/Objects/carton_1")
    matrix = conformant_backend.get_obj_world_pose_matrix("/World/Objects/carton_1")
    aabb = conformant_backend.get_obj_aabb("/World/Objects/carton_1")

    assert np.allclose(matrix[:3, 3], position, atol=1e-6)
    assert len(quat) == 4
    assert np.isclose(np.linalg.norm(quat), 1.0, atol=1e-3)
    min_corner, max_corner = aabb[:3], aabb[3:]
    assert all(low < high for low, high in zip(min_corner, max_corner))
    assert all(
        low - 1e-6 <= center <= high + 1e-6
        for low, center, high in zip(min_corner, position, max_corner)
    )
    joints = conformant_backend.get_joint_state_dict()
    assert isinstance(joints, dict)


def test_reset_is_repeatable(conformant_backend) -> None:
    first = conformant_backend.reset_episode(_MANIFEST)
    conformant_backend.step(None, substeps=50)
    second = conformant_backend.reset_episode(_MANIFEST)

    assert second.object_poses["carton_1"].position_xyz == pytest.approx(
        first.object_poses["carton_1"].position_xyz, abs=1e-3
    )
    assert second.sim_time_s == pytest.approx(0.0, abs=1e-6)
