from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.models.scenario import EpisodeManifest, ScenarioDocument
from backend.models.world_rollouts import WorldRolloutDecisionRecord
from backend.services.scenario_policies.base import PolicyAction, ScenarioPolicy
from backend.services.scenario_runtime.ader_evaluation import (
    AderEvaluation,
    build_ader_evaluation,
    tick_ader_checkers,
)
from backend.services.scenario_runtime.environment_fingerprint import environment_fingerprint
from backend.services.scenario_runtime.trace_writer import (
    EpisodeTraceWriter,
    SCENARIO_CHECKER_MODULE_ID,
    SCENARIO_GUARD_MODULE_ID,
    SCENARIO_RUNNER_MODULE_ID,
    TRACE_STREAM_OBJECTS,
    TRACE_STREAM_POLICY_ACTION,
    TRACE_STREAM_ROBOT_JOINTS,
)
from backend.services.sim_backends.base import SimBackend
from backend.services.sim_backends.types import Observation

_CONTAINER_NODE_NAMES = (
    "ActionSetWaitAll",
    "ActionSetWaitAny",
    "ActionSetWaitSome",
    "ActionList",
    "TimeOut",
    "StepOut",
    "ActionWaitForTime",
)


@dataclass
class EpisodeResult:
    scenario_id: str
    episode_index: int
    seed: int
    backend_id: str
    success: bool
    stop_reason: str  # "success" | "timeout" | "max_steps" | "guard_reject" | "unstable"
    steps: int
    sim_time_s: float
    wall_time_s: float
    checker_progress: dict[str, dict]
    scores: dict
    final_object_poses: dict[str, dict]
    final_joint_positions: dict[str, float]
    grasp_attach_used: bool = False
    artifacts: dict[str, dict[str, object]] = field(default_factory=dict)
    environment: dict = field(default_factory=dict)

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
            "scores": self.scores,
            "final_object_poses": self.final_object_poses,
            "final_joint_positions": self.final_joint_positions,
            "grasp_attach_used": self.grasp_attach_used,
            "artifacts": self.artifacts,
            "environment": self.environment,
        }


def success_rule_ids(scenario: ScenarioDocument) -> list[str]:
    """One rule id per success condition, in compile (= leaf checker) order."""
    rule_ids: list[str] = []
    for entry in scenario.success.all_of:
        for name, params in entry.items():
            summary = "|".join(
                str(value)
                for key, value in sorted(params.items())
                if isinstance(value, (str, int, float))
            ) if isinstance(params, dict) else ""
            rule_ids.append(f"scenario/{name}[{summary}]")
    return rule_ids


class _GuardMonitor:
    """Runner-side hard-failure checks (decision: reject)."""

    def __init__(self, scenario: ScenarioDocument, backend: SimBackend) -> None:
        self._backend = backend
        self._collision_pairs: list[tuple[str, str]] = []
        self._plane_checks: list[tuple[str, float]] = []
        for entry in scenario.success.guards:
            for name, params in entry.items():
                params = params if isinstance(params, dict) else {}
                if name == "no_collision":
                    for pair in params.get("pairs", []):
                        if isinstance(pair, (list, tuple)) and len(pair) == 2:
                            self._collision_pairs.append((str(pair[0]), str(pair[1])))
                elif name == "above_plane":
                    self._plane_checks.append(
                        (str(params.get("object", "")), float(params.get("z_min", 0.0)))
                    )

    def violations(self, observation: Observation) -> list[WorldRolloutDecisionRecord]:
        records: list[WorldRolloutDecisionRecord] = []
        t_ms = max(0, round(observation.sim_time_s * 1000.0))
        for body_a, body_b in self._collision_pairs:
            contacts = self._backend.check_contacts(body_a, body_b)
            if contacts:
                records.append(
                    WorldRolloutDecisionRecord(
                        t_ms=t_ms,
                        module_id=SCENARIO_GUARD_MODULE_ID,
                        decision="reject",
                        rule_id=f"scenario/no_collision[{body_a}|{body_b}]",
                        message=f"Forbidden contact between {body_a} and {body_b}.",
                    )
                )
        for object_id, z_min in self._plane_checks:
            pose = observation.object_poses.get(object_id)
            if pose is not None and pose.position_xyz[2] < z_min:
                records.append(
                    WorldRolloutDecisionRecord(
                        t_ms=t_ms,
                        module_id=SCENARIO_GUARD_MODULE_ID,
                        decision="reject",
                        rule_id=f"scenario/above_plane[{object_id}|{z_min}]",
                        message=f"Object {object_id} fell below z={z_min}.",
                    )
                )
        return records


def _stable_for_spec(scenario: ScenarioDocument) -> tuple[str, float, float] | None:
    for entry in scenario.success.guards:
        for name, params in entry.items():
            if name == "stable_for" and isinstance(params, dict):
                return (
                    str(params.get("object", "")),
                    float(params.get("seconds", 2.0)),
                    float(params.get("max_drift_m", 0.01)),
                )
    return None


def _leaf_progress(evaluation: AderEvaluation) -> list[tuple[str, dict]]:
    return [
        (item["acion_obj"].__class__.__name__, dict(item["acion_obj"].progress_info))
        for item in evaluation.task_progress
        if item["acion_obj"].__class__.__name__ not in _CONTAINER_NODE_NAMES
    ]


def _success_from_progress(evaluation: AderEvaluation) -> bool:
    """Success = every leaf checker (not containers/exit nodes) reported SCORE 1."""
    leaves = _leaf_progress(evaluation)
    return bool(leaves) and all(progress.get("SCORE") == 1 for _, progress in leaves)


def _vendored_scores(scenario: ScenarioDocument, evaluation: AderEvaluation) -> dict:
    """Per-step scores + E2E flag via the vendored Genie Sim metrics rubric."""
    from geniesim_benchmark.plugins.output_system.eval_utils import TaskEvaluation

    task_evaluation = TaskEvaluation(task_name=scenario.scenario_id)
    task_evaluation.sub_steps = [name for name, _ in _leaf_progress(evaluation)]
    task_evaluation.update_progress(
        [
            {
                "class_name": item["acion_obj"].__class__.__name__,
                "id": item["id"],
                "progress": item["acion_obj"].progress_info,
            }
            for item in evaluation.task_progress
        ]
    )
    task_evaluation.summarize_scores()
    return task_evaluation.result.get("scores", {})


def run_episode(
    *,
    scenario: ScenarioDocument,
    manifest: EpisodeManifest,
    backend: SimBackend,
    output_dir: Path,
    policy: ScenarioPolicy | None = None,
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
    guards = _GuardMonitor(scenario, backend)
    if policy is not None:
        policy.reset()
    resolved_instruction = instruction or scenario.task.instruction
    grasp_attach_used = False

    stop_reason = "max_steps"
    step = 0
    for step in range(1, runtime.max_episode_steps + 1):
        action: PolicyAction | None = None
        if policy is not None:
            action = policy.next_action(
                observation, step=step, instruction=resolved_instruction
            )
        if action is not None:
            if action.attach_object is not None:
                _require_weld(scenario)
                backend.attach_object(action.attach_object)
                grasp_attach_used = True
            if action.detach:
                backend.detach_object()
            if action.joint_targets:
                writer.write_state(
                    t_ms=_t_ms(backend), stream=TRACE_STREAM_POLICY_ACTION,
                    state={"joint_targets": action.joint_targets},
                )
        backend.step(action.joint_targets if action else None, substeps=substeps)
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
            violations = guards.violations(observation)
            if violations:
                for record in violations:
                    writer.write_decision(record)
                stop_reason = "guard_reject"
                break
            tick_ader_checkers(evaluation, sim_dt_s=checker_dt_s)
            if evaluation.has_done:
                stop_reason = "success" if _success_from_progress(evaluation) else "timeout"
                break

    success = stop_reason == "success"

    if success:
        stable_spec = _stable_for_spec(scenario)
        if stable_spec is not None:
            success = _hold_and_check_stability(
                backend, stable_spec,
                substeps=substeps, control_dt_s=control_dt_s,
            )
            if not success:
                stop_reason = "unstable"

    _write_final_decisions(
        writer, scenario, evaluation, backend,
        success=success, stop_reason=stop_reason,
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
        scores=_vendored_scores(scenario, evaluation),
        final_object_poses={
            object_id: {
                "position_xyz": list(pose.position_xyz),
                "quat_wxyz": list(pose.quat_wxyz),
            }
            for object_id, pose in final_state.object_poses.items()
        },
        final_joint_positions=dict(final_state.joint_positions),
        grasp_attach_used=grasp_attach_used,
        artifacts=artifacts,
        environment=environment_fingerprint(backend.backend_id),
    )


def _require_weld(scenario: ScenarioDocument) -> None:
    if scenario.runtime.grasp_attach != "weld":
        raise ValueError(
            "Policy emitted an attach event but runtime.grasp_attach is not 'weld'."
        )


_STABILITY_WINDOW_S = 0.2


def _hold_and_check_stability(
    backend: SimBackend,
    stable_spec: tuple[str, float, float],
    *,
    substeps: int,
    control_dt_s: float,
) -> bool:
    """Stable-after-N-seconds: settle for ``seconds``, then the object must not
    move more than ``max_drift_m`` over a short trailing window."""
    object_id, seconds, max_drift_m = stable_spec
    for _ in range(max(1, round(seconds / control_dt_s))):
        backend.step(None, substeps=substeps)
    start_pose = backend.get_observation().object_poses.get(object_id)
    if start_pose is None:
        return True
    for _ in range(max(1, round(_STABILITY_WINDOW_S / control_dt_s))):
        backend.step(None, substeps=substeps)
    end_pose = backend.get_observation().object_poses.get(object_id)
    if end_pose is None:
        return False
    drift = sum(
        (a - b) ** 2 for a, b in zip(start_pose.position_xyz, end_pose.position_xyz)
    ) ** 0.5
    return drift <= max_drift_m


def _write_final_decisions(
    writer: EpisodeTraceWriter,
    scenario: ScenarioDocument,
    evaluation: AderEvaluation,
    backend: SimBackend,
    *,
    success: bool,
    stop_reason: str,
) -> None:
    t_ms = _t_ms(backend)
    if success:
        leaves = _leaf_progress(evaluation)
        rule_ids = success_rule_ids(scenario)
        for index, (class_name, progress) in enumerate(leaves):
            rule_id = rule_ids[index] if index < len(rule_ids) else f"scenario/{class_name}[{index}]"
            writer.write_decision(
                WorldRolloutDecisionRecord(
                    t_ms=t_ms,
                    module_id=SCENARIO_CHECKER_MODULE_ID,
                    decision="allow",
                    rule_id=rule_id,
                    message=f"{class_name} satisfied.",
                    metrics={"score": progress.get("SCORE", 0)},
                )
            )
        return
    writer.write_decision(
        WorldRolloutDecisionRecord(
            t_ms=t_ms,
            module_id=SCENARIO_RUNNER_MODULE_ID,
            decision="stop",
            rule_id=f"scenario/{stop_reason}",
            message=f"Episode ended without success ({stop_reason}).",
        )
    )


def _t_ms(backend: Any) -> int:
    return max(0, round(backend.sim_time_s * 1000.0))
