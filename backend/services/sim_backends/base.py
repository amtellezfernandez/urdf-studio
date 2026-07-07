from __future__ import annotations

import abc
from typing import ClassVar

from backend.models.scenario import EpisodeManifest
from backend.services.scenario_runtime.vendor_loader import ensure_geniesim_on_path
from backend.services.sim_backends.types import ContactRecord, Observation, SimState

ensure_geniesim_on_path()

from geniesim_benchmark.app.controllers.api_core import APICore  # noqa: E402

WORLD_OBJECT_PRIM_PREFIX = "/World/Objects/"
ROBOT_PRIM_PATH = "/World/Robot"


def world_object_id_from_prim_path(prim_path: str) -> str:
    """Map the vendored Genie prim-path convention back to a world-object id."""
    if prim_path.startswith(WORLD_OBJECT_PRIM_PREFIX):
        return prim_path[len(WORLD_OBJECT_PRIM_PREFIX):]
    return prim_path.lstrip("/")


class SimBackend(APICore):
    """Engine-neutral episode backend.

    Extends the vendored Genie Sim ``APICore`` accessor contract (which the
    vendored checkers consume) with the episode-runtime lifecycle used by the
    scenario episode runner. One instance drives one episode process.
    """

    backend_id: ClassVar[str]

    # --- lifecycle ---

    @abc.abstractmethod
    def load_scene(self, *, physics_timestep_s: float) -> None:
        """Build/compile the simulator scene (world primitives + robot)."""

    @abc.abstractmethod
    def reset_episode(self, manifest: EpisodeManifest) -> Observation:
        """Apply the episode's resolved initial state and return the first observation."""

    @abc.abstractmethod
    def step(self, joint_targets: dict[str, float] | None, substeps: int) -> None:
        """Advance physics by ``substeps`` timesteps applying joint position targets."""

    @abc.abstractmethod
    def get_observation(self) -> Observation:
        ...

    @abc.abstractmethod
    def get_state(self) -> SimState:
        ...

    @abc.abstractmethod
    def set_state(self, state: SimState) -> None:
        ...

    @abc.abstractmethod
    def check_contacts(
        self,
        body_a: str | None = None,
        body_b: str | None = None,
    ) -> tuple[ContactRecord, ...]:
        """Return active contacts, optionally filtered by world-object/robot names."""

    def render(self, camera_id: str | None = None):
        return None

    def close(self) -> None:
        pass

    # --- kinematic grasp-attach (runtime.grasp_attach: weld) ---

    def attach_object(self, object_id: str) -> None:
        raise NotImplementedError(f"{self.backend_id} does not support grasp_attach.")

    def detach_object(self) -> None:
        raise NotImplementedError(f"{self.backend_id} does not support grasp_attach.")

    @property
    @abc.abstractmethod
    def sim_time_s(self) -> float:
        ...
