from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from backend.models.scenario import EpisodeManifest, ScenarioDocument
from backend.models.world_rollouts import WorldRolloutDecisionRecord
from backend.services.scenario_runtime.ader_evaluation import (
    AderEvaluation,
    build_ader_evaluation,
    tick_ader_checkers,
)
from backend.services.scenario_runtime.trace_writer import (
    EpisodeTraceWriter,
    SCENARIO_CHECKER_MODULE_ID,
    SCENARIO_RUNNER_MODULE_ID,
    TRACE_STREAM_OBJECTS,
    TRACE_STREAM_POLICY_ACTION,
    TRACE_STREAM_ROBOT_JOINTS,
)
from backend.services.sim_backends.base import SimBackend
from backend.services.sim_backends.types import Observation


class EpisodePolicy(Protocol):
    """Minimal policy protocol; wraps the vendored BasePolicy chunk buffering."""

    def reset(self) -> None: ...

    def next_joint_targets(
        self,
        observation: Observation,
        *,
        step: int,
        instruction: str,
    ) -> dict[str, float] | None: ...


@dataclass
class EpisodeResult:
    scenario_id: str
    episode_index: int
    seed: int
    backend_id: str
    success: bool
    stop_reason: str  # "success" | "timeout" | "max_steps" | "guard_reject"
    steps: int
    sim_time_s: float
    wall_time_s: float
    checker_progress: dict[str, dict]
    final_object_poses: dict[str, dict]
    final_joint_positions: dict[str, float]
    artifacts: dict[str, dict[str, object]] = field(default_factory=dict)

    def to_report(self) -> dict:
        return {
            "schema": "scenario_episode_report.v1",
            "scenario_id": self.scenario_id,
            "episode_index": self.episode_index,
            "seed": self.seed,
            "backend_id": self.backend_id,
            "success": self.success,
            "stop_reason": self.stop_reason,
            "steps": self.steps,
            "sim_time_s": self.sim_time_s,
            "wall_time_s": self.wall_time_s,
            "checker_progress": self.checker_progress,
            "final_object_poses": self.final_object_poses,
            "final_joint_positions": self.final_joint_positions,
            "artifacts": self.artifacts,
        }


def _success_from_progress(evaluation: AderEvaluation) -> bool:
    """Success = every leaf checker (not containers/exit nodes) reported SCORE 1.

    Containers (WaitAll/WaitAny/...) and exit nodes (TimeOut/StepOut) never
    publish progress; when the tree completes via the Timeout branch the leaf
    checkers keep their non-success progress, so this distinguishes the two.
    """
    leaf_progress = [
        item["acion_obj"].progress_info
        for item in evaluation.task_progress
        if item["acion_obj"].__class__.__name__
        not in ("ActionSetWaitAll", "ActionSetWaitAny", "ActionSetWaitSome", "ActionList", "TimeOut", "StepOut")
    ]
    return bool(leaf_progress) and all(
        progress.get("SCORE") == 1 for progress in leaf_progress
    )


def run_episode(
    *,
    scenario: ScenarioDocument,
    manifest: EpisodeManifest,
    backend: SimBackend,
    output_dir: Path,
    policy: EpisodePolicy | None = None,
    instruction: str | None = None,
) -> EpisodeResult:
    """Run one episode of a scenario on a backend, writing rollout artifacts.

    The control timeline is identical across backends: ``control_hz`` control
    steps, each advancing physics by ``substeps`` timesteps; the vendored
    checker tree ticks every ``checker_interval_steps`` control steps on
    simulation time.
    """
    runtime = scenario.runtime
    control_dt_s = 1.0 / runtime.control_hz
    substeps = max(1, round(control_dt_s / runtime.physics_timestep_s))
    checker_dt_s = control_dt_s * runtime.checker_interval_steps

    output_dir.mkdir(parents=True, exist_ok=True)
    writer = EpisodeTraceWriter(
        output_dir,
        record_trace=scenario.evaluation.record_trace,
        record_decisions=scenario.evaluation.record_decisions,
    )

    started = time.monotonic()
    backend.load_scene(physics_timestep_s=runtime.physics_timestep_s)
    observation = backend.reset_episode(manifest)
    evaluation = build_ader_evaluation(scenario, backend)
    if policy is not None:
        policy.reset()
    resolved_instruction = instruction or scenario.task.instruction

    stop_reason = "max_steps"
    step = 0
    for step in range(1, runtime.max_episode_steps + 1):
        joint_targets: dict[str, float] | None = None
        if policy is not None:
            joint_targets = policy.next_joint_targets(
                observation, step=step, instruction=resolved_instruction
            )
            if joint_targets:
                writer.write_state(
                    t_ms=_t_ms(backend), stream=TRACE_STREAM_POLICY_ACTION,
                    state={"joint_targets": joint_targets},
                )
        backend.step(joint_targets, substeps=substeps)
        observation = backend.get_observation()
        t_ms = _t_ms(backend)
        writer.write_state(
            t_ms=t_ms, stream=TRACE_STREAM_ROBOT_JOINTS,
            state={"joint_positions": observation.joint_positions},
        )
        writer.write_state(
            t_ms=t_ms, stream=TRACE_STREAM_OBJECTS,
            state={
                object_id: {
                    "position_xyz": list(pose.position_xyz),
                    "quat_wxyz": list(pose.quat_wxyz),
                }
                for object_id, pose in observation.object_poses.items()
            },
        )
        if step % runtime.checker_interval_steps == 0:
            tick_ader_checkers(evaluation, sim_dt_s=checker_dt_s)
            if evaluation.has_done:
                stop_reason = "success" if _success_from_progress(evaluation) else "timeout"
                break

    success = stop_reason == "success"
    writer.write_decision(
        WorldRolloutDecisionRecord(
            t_ms=_t_ms(backend),
            module_id=SCENARIO_CHECKER_MODULE_ID if success else SCENARIO_RUNNER_MODULE_ID,
            decision="allow" if success else "stop",
            rule_id="scenario/success" if success else f"scenario/{stop_reason}",
            message=(
                "All success conditions satisfied."
                if success
                else f"Episode ended without success ({stop_reason})."
            ),
        )
    )
    artifacts = writer.close()
    final_state = backend.get_state()
    return EpisodeResult(
        scenario_id=scenario.scenario_id,
        episode_index=manifest.episode_index,
        seed=manifest.seed,
        backend_id=backend.backend_id,
        success=success,
        stop_reason=stop_reason,
        steps=step,
        sim_time_s=backend.sim_time_s,
        wall_time_s=time.monotonic() - started,
        checker_progress=evaluation.progress_by_node(),
        final_object_poses={
            object_id: {
                "position_xyz": list(pose.position_xyz),
                "quat_wxyz": list(pose.quat_wxyz),
            }
            for object_id, pose in final_state.object_poses.items()
        },
        final_joint_positions=dict(final_state.joint_positions),
        artifacts=artifacts,
    )


def _t_ms(backend: Any) -> int:
    return max(0, round(backend.sim_time_s * 1000.0))
