from __future__ import annotations

from backend.world_bridge.readiness_params import (
    READINESS_MIN_COUNTERFACTUAL_TRANSITIONS_FOR_GO,
    READINESS_MIN_LIVE_ROLLOUT_TRANSITIONS_FOR_GO,
    READINESS_MIN_TRANSITIONS_FOR_GO,
    READINESS_MIN_TRANSITIONS_FOR_WATCH,
    READINESS_MIN_UNIQUE_ADAPTERS_FOR_GO,
    READINESS_MIN_UNIQUE_PLANNERS_FOR_GO,
    READINESS_MIN_UNIQUE_PLANNERS_FOR_WATCH,
    READINESS_MIN_UNIQUE_ROBOTS_FOR_GO,
    READINESS_MIN_UNIQUE_ROBOTS_FOR_WATCH,
    READINESS_MIN_UNIQUE_TASKS_FOR_GO,
)
from backend.world_bridge.types import (
    WorldBridgeReadinessDecision,
    WorldBridgeReadinessMetrics,
    WorldBridgeReadinessResponse,
)

READINESS_DECISION_RANK = {
    WorldBridgeReadinessDecision.NO_GO: 0,
    WorldBridgeReadinessDecision.WATCH: 1,
    WorldBridgeReadinessDecision.GO: 2,
}


def _record_threshold_check(
    *,
    metric_name: str,
    actual_value: int,
    minimum_value: int,
    checks_passed: list[str],
    blockers: list[str],
) -> None:
    if actual_value >= minimum_value:
        checks_passed.append(
            f"{metric_name} >= {minimum_value} ({actual_value})"
        )
        return
    blockers.append(
        f"{metric_name} below {minimum_value} ({actual_value})"
    )


def is_readiness_at_least(
    *,
    actual: WorldBridgeReadinessDecision,
    minimum: WorldBridgeReadinessDecision,
) -> bool:
    return READINESS_DECISION_RANK[actual] >= READINESS_DECISION_RANK[minimum]


def evaluate_world_bridge_readiness(
    metrics: WorldBridgeReadinessMetrics,
) -> WorldBridgeReadinessResponse:
    go_checks: list[str] = []
    go_blockers: list[str] = []
    _record_threshold_check(
        metric_name="total_transitions",
        actual_value=metrics.total_transitions,
        minimum_value=READINESS_MIN_TRANSITIONS_FOR_GO,
        checks_passed=go_checks,
        blockers=go_blockers,
    )
    _record_threshold_check(
        metric_name="unique_robot_count",
        actual_value=metrics.unique_robot_count,
        minimum_value=READINESS_MIN_UNIQUE_ROBOTS_FOR_GO,
        checks_passed=go_checks,
        blockers=go_blockers,
    )
    _record_threshold_check(
        metric_name="unique_planner_count",
        actual_value=metrics.unique_planner_count,
        minimum_value=READINESS_MIN_UNIQUE_PLANNERS_FOR_GO,
        checks_passed=go_checks,
        blockers=go_blockers,
    )
    _record_threshold_check(
        metric_name="unique_task_count",
        actual_value=metrics.unique_task_count,
        minimum_value=READINESS_MIN_UNIQUE_TASKS_FOR_GO,
        checks_passed=go_checks,
        blockers=go_blockers,
    )
    _record_threshold_check(
        metric_name="unique_adapter_count",
        actual_value=metrics.unique_adapter_count,
        minimum_value=READINESS_MIN_UNIQUE_ADAPTERS_FOR_GO,
        checks_passed=go_checks,
        blockers=go_blockers,
    )
    _record_threshold_check(
        metric_name="counterfactual_transition_count",
        actual_value=metrics.counterfactual_transition_count,
        minimum_value=READINESS_MIN_COUNTERFACTUAL_TRANSITIONS_FOR_GO,
        checks_passed=go_checks,
        blockers=go_blockers,
    )
    _record_threshold_check(
        metric_name="live_rollout_transition_count",
        actual_value=metrics.live_rollout_transition_count,
        minimum_value=READINESS_MIN_LIVE_ROLLOUT_TRANSITIONS_FOR_GO,
        checks_passed=go_checks,
        blockers=go_blockers,
    )
    if not go_blockers:
        return WorldBridgeReadinessResponse(
            decision=WorldBridgeReadinessDecision.GO,
            checks_passed=go_checks,
            blockers=[],
            metrics=metrics,
        )

    watch_checks: list[str] = []
    watch_blockers: list[str] = []
    _record_threshold_check(
        metric_name="total_transitions",
        actual_value=metrics.total_transitions,
        minimum_value=READINESS_MIN_TRANSITIONS_FOR_WATCH,
        checks_passed=watch_checks,
        blockers=watch_blockers,
    )
    _record_threshold_check(
        metric_name="unique_robot_count",
        actual_value=metrics.unique_robot_count,
        minimum_value=READINESS_MIN_UNIQUE_ROBOTS_FOR_WATCH,
        checks_passed=watch_checks,
        blockers=watch_blockers,
    )
    _record_threshold_check(
        metric_name="unique_planner_count",
        actual_value=metrics.unique_planner_count,
        minimum_value=READINESS_MIN_UNIQUE_PLANNERS_FOR_WATCH,
        checks_passed=watch_checks,
        blockers=watch_blockers,
    )
    if not watch_blockers:
        return WorldBridgeReadinessResponse(
            decision=WorldBridgeReadinessDecision.WATCH,
            checks_passed=watch_checks,
            blockers=go_blockers,
            metrics=metrics,
        )

    return WorldBridgeReadinessResponse(
        decision=WorldBridgeReadinessDecision.NO_GO,
        checks_passed=watch_checks,
        blockers=watch_blockers,
        metrics=metrics,
    )
