from __future__ import annotations

from backend.models.physical_state import (
    ActionToken,
    CorrectionBranch,
    ExecutabilityReport,
    PhysicalRolloutTrace,
    RepairPlan,
)
from backend.services.executability_audit import audit_physical_rollout_trace
from backend.services.physical_rollout_baseline import rollout_action


def _scale_delta(action: ActionToken, scale: float) -> ActionToken:
    params = dict(action.params)
    raw_delta = params.get("delta_xyz")
    if isinstance(raw_delta, list | tuple) and len(raw_delta) == 3:
        params["delta_xyz"] = [float(component) * scale for component in raw_delta]
    params["repair_strategy"] = "scaled_delta"
    return action.model_copy(
        update={
            "action_id": f"{action.action_id}_scaled_{scale:g}",
            "params": params,
        }
    )


def _build_replan_action(original: ActionToken | None) -> ActionToken:
    return ActionToken(
        action_id=f"{original.action_id}_replan" if original else "replan",
        action_type="replan",
        actor_id=original.actor_id if original else None,
        object_id=original.object_id if original else None,
        target_id=original.target_id if original else None,
        destination_id=original.destination_id if original else None,
        params={"reason": "executability_audit_failed"},
    )


def _build_handoff_action(original: ActionToken | None) -> ActionToken:
    return ActionToken(
        action_id=f"{original.action_id}_handoff" if original else "handoff_to_human",
        action_type="handoff_to_human",
        actor_id=original.actor_id if original else None,
        object_id=original.object_id if original else None,
        target_id=original.target_id if original else None,
        destination_id=original.destination_id if original else None,
        params={"handoff_reason": "physical_execution_risk"},
    )


def build_repair_plan(
    trace: PhysicalRolloutTrace,
    *,
    report: ExecutabilityReport | None = None,
) -> RepairPlan:
    audit_report = report or audit_physical_rollout_trace(trace)
    original = trace.actions[0] if trace.actions else None
    branches: list[CorrectionBranch] = []

    if audit_report.success:
        return RepairPlan(
            trace_id=trace.trace_id,
            source_decision=audit_report.decision,
            original_score=audit_report.score,
            branches=[],
            metadata={"reason": "trace_already_executable"},
        )

    if original is not None and original.action_type in {"push", "translate", "move_object", "navigate"}:
        scaled = _scale_delta(original, 0.5)
        branches.append(
            CorrectionBranch(
                branch_id="scaled_delta_retry",
                parent_trace_id=trace.trace_id,
                label="Scale movement delta and retry",
                action=scaled,
                proposed_actions=[scaled],
                expected_decision="warn",
                expected_executability_score=min(1.0, audit_report.score + 0.25),
                expected_cost=1.4,
                risk_score=max(0.0, 1.0 - audit_report.score - 0.2),
                training_value="medium",
                rationale="A smaller transition probes the same failure boundary with lower collision/contact risk.",
                tradeoffs={"speed": "slower", "path_length": "same"},
            )
        )

    replan = _build_replan_action(original)
    branches.append(
        CorrectionBranch(
            branch_id="stop_and_replan",
            parent_trace_id=trace.trace_id,
            label="Stop rollout and request geometric replan",
            action=replan,
            proposed_actions=[replan],
            expected_decision="allow",
            expected_executability_score=max(0.76, audit_report.score),
            expected_cost=2.0,
            risk_score=0.12,
            training_value="high",
            rationale="The invalid transition becomes a post-training failure state instead of an exported command.",
            tradeoffs={"latency": "higher", "training_value": "high"},
        )
    )

    handoff = _build_handoff_action(original)
    branches.append(
        CorrectionBranch(
            branch_id="human_handoff",
            parent_trace_id=trace.trace_id,
            label="Handoff high-risk action to a human/operator",
            action=handoff,
            proposed_actions=[handoff],
            expected_decision="allow",
            expected_executability_score=max(0.7, audit_report.score),
            expected_cost=3.5,
            risk_score=0.08,
            training_value="low",
            rationale="Safe fallback for physical risk, but lower value for autonomous policy improvement.",
            tradeoffs={"autonomy": "lower", "safety": "higher"},
        )
    )

    return RepairPlan(
        trace_id=trace.trace_id,
        source_decision=audit_report.decision,
        original_score=audit_report.score,
        branches=branches,
        metadata={
            "reject_count": audit_report.reject_count,
            "warn_count": audit_report.warn_count,
            "stop_count": audit_report.stop_count,
        },
    )


def rollout_correction_branch(
    trace: PhysicalRolloutTrace,
    branch: CorrectionBranch,
    *,
    step_ms: int = 100,
) -> PhysicalRolloutTrace:
    if not trace.frames:
        raise ValueError("Cannot repair an empty rollout trace.")
    current_frame = trace.frames[0]
    repaired_frames = [current_frame.model_copy(deep=True)]
    applied_actions: list[ActionToken] = []

    for action in branch.proposed_actions or ([branch.action] if branch.action is not None else []):
        if action is None:
            continue
        branch_trace = rollout_action(current_frame, action, step_count=1, step_ms=step_ms)
        repaired_frames.extend(branch_trace.frames[1:])
        current_frame = branch_trace.frames[-1]
        applied_actions.append(action)

    return PhysicalRolloutTrace(
        trace_id=f"{trace.trace_id}:{branch.branch_id}",
        frames=repaired_frames,
        actions=applied_actions,
        metadata={
            **trace.metadata,
            "repair_branch_id": branch.branch_id,
            "parent_trace_id": trace.trace_id,
        },
    )
