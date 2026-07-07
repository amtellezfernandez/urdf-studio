from __future__ import annotations

from dataclasses import dataclass, field

from backend.services.scenario_runtime.vendor_loader import ensure_geniesim_on_path
from backend.services.sim_backends.types import Observation

ensure_geniesim_on_path()

from geniesim_benchmark.benchmark.policy.base import BasePolicy  # noqa: E402


@dataclass(frozen=True)
class PolicyAction:
    """One control-step action emitted by a scenario policy."""

    joint_targets: dict[str, float] = field(default_factory=dict)
    attach_object: str | None = None
    detach: bool = False


class ScenarioPolicy(BasePolicy):
    """Scenario policy base: vendored BasePolicy action-chunk buffering.

    Subclasses implement ``act(observations, **kwargs) -> list[PolicyAction]``
    (a chunk); the episode runner calls ``next_action`` once per control step
    and the vendored ``need_infer``/``action_buffer`` machinery replays the
    chunk without re-inferring.
    """

    def next_action(
        self,
        observation: Observation,
        *,
        step: int,
        instruction: str,
    ) -> PolicyAction | None:
        if self.need_infer():
            chunk = self.act(observation, step_num=step, task_instruction=instruction)
            if chunk:
                self.action_buffer.extend(chunk)
        if not self.action_buffer:
            return None
        return self.action_buffer.popleft()
