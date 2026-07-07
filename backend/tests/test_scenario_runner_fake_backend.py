"""Episode runner semantics on the dependency-free FakeBackend."""

from __future__ import annotations

from pathlib import Path

from backend.models.scenario import EpisodeManifest, EpisodeObjectPlacement
from backend.services.scenario_loader import load_scenario, load_scenario_world
from backend.services.scenario_policies.base import PolicyAction, ScenarioPolicy
from backend.services.scenario_runtime.episode_runner import run_episode
from backend.services.sim_backends.fake_backend import FakeBackend
from backend.services.sim_backends.types import Observation

REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIO_DIR = REPO_ROOT / "scenarios" / "carton_sorting_0001"


class PlaceAtStepPolicy(ScenarioPolicy):
    """Scripted test policy: teleports the carton into the bin at a given step."""

    def __init__(self, backend: FakeBackend, *, at_step: int) -> None:
        super().__init__()
        self._backend = backend
        self._at_step = at_step
        self.reset_calls = 0

    def reset(self) -> None:
        self.action_buffer.clear()
        self.reset_calls += 1

    def act(self, observations: Observation, **kwargs) -> list[PolicyAction]:
        if int(kwargs.get("step_num", 0)) == self._at_step:
            self._backend.move_object("carton_1", (0.45, 0.3, 0.775))
        return [PolicyAction()]


def _fake_backend() -> FakeBackend:
    scenario = load_scenario(SCENARIO_DIR)
    world = load_scenario_world(SCENARIO_DIR, scenario)
    return FakeBackend(scenario, world)


def test_policy_driven_success_mid_episode(tmp_path: Path) -> None:
    scenario = load_scenario(SCENARIO_DIR)
    backend = _fake_backend()
    policy = PlaceAtStepPolicy(backend, at_step=40)
    manifest = EpisodeManifest(
        scenario_id=scenario.scenario_id,
        episode_index=0,
        seed=0,
        object_placements={
            "carton_1": EpisodeObjectPlacement(
                position_xyz=(0.4, -0.15, 0.755), rotation_rpy_rad=(0.0, 0.0, 0.0)
            )
        },
    )

    result = run_episode(
        scenario=scenario,
        manifest=manifest,
        backend=backend,
        output_dir=tmp_path,
        policy=policy,
    )

    assert policy.reset_calls == 1
    assert result.success is True
    assert result.stop_reason == "success"
    assert 40 <= result.steps <= 40 + 2 * scenario.runtime.checker_interval_steps


def test_unmoved_carton_times_out(tmp_path: Path) -> None:
    scenario = load_scenario(SCENARIO_DIR)
    backend = _fake_backend()
    manifest = EpisodeManifest(
        scenario_id=scenario.scenario_id, episode_index=0, seed=0
    )

    result = run_episode(
        scenario=scenario, manifest=manifest, backend=backend, output_dir=tmp_path
    )

    assert result.success is False
    assert result.stop_reason == "timeout"
