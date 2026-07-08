"""Wiring between URDF Studio scenarios and the vendored Genie Sim Ader engine.

The vendored AderEnv drives checker updates from wall-clock time
(`AderEnv.action_update`); episodes here are simulation-time deterministic, so
`tick_ader_checkers` is a sim-time port of that method (same semantics, the
delta comes from the physics clock).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from backend.models.scenario import ScenarioDocument
from backend.services.scenario_loader import compile_success_to_acts
from backend.services.scenario_runtime.vendor_loader import ensure_geniesim_on_path


@dataclass
class AderEvaluation:
    env: Any
    task: Any
    task_progress: list[dict] = field(default_factory=list)

    def progress_by_node(self) -> dict[str, dict]:
        return {
            f"{item['acion_obj'].__class__.__name__}[{index}]": dict(item["acion_obj"].progress_info)
            for index, item in enumerate(self.task_progress)
        }

    @property
    def has_done(self) -> bool:
        return bool(self.env.has_done)


def build_ader_evaluation(scenario: ScenarioDocument, api_core: Any) -> AderEvaluation:
    """Build the vendored Ader evaluation tree for a scenario.

    ``api_core`` must implement the APICore contract
    (backend/vendor/geniesim/geniesim_benchmark/app/controllers/api_core.py).
    """
    ensure_geniesim_on_path()
    from geniesim_benchmark.plugins.ader import AderEnv, AderParams, AderTask
    from geniesim_benchmark.plugins.ader.action import action_parsing

    from backend.services.scenario_runtime.checker_registry import install_registry_parser

    acts = compile_success_to_acts(scenario.success)
    env = AderEnv(api_core=api_core, params=AderParams(task_name=scenario.scenario_id))
    # Empty init_task_config selects the vendored /World/Objects/<id> prim-path
    # convention (see EvaluateAction._analyze_obj_name).
    env.init_task_config = {}
    task = AderTask(env, task_definitions_path=None)
    task_progress: list[dict] = []
    # Custom checkers (checker_registry) build inside the tree, including nested
    # containers, without editing the vendored parser.
    with install_registry_parser():
        tree = action_parsing.parse_action(acts, task_progress, env)
    task.task_progress = task_progress
    env.task = task
    env.execute_action = tree
    env.do_eval_action()
    return AderEvaluation(env=env, task=task, task_progress=task_progress)


def tick_ader_checkers(evaluation: AderEvaluation, sim_dt_s: float) -> None:
    """Advance the checker tree by a simulation-time delta.

    Sim-time port of the vendored ``AderEnv.action_update``: an action that
    completed immediately at start never registers in the manager, so an empty
    eval slot means the episode is done.
    """
    env = evaluation.env
    if not env.exist_eval_action():
        env.has_done = True
        return
    env.action_executor.update(sim_dt_s)
    if env.has_done:
        env.cancel_action("eval")
