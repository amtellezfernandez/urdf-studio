from __future__ import annotations

from backend.world_bridge.readiness import (
    evaluate_world_bridge_readiness,
    is_readiness_at_least,
)
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
)

ZERO_COUNT = 0
ONE_COUNT = 1


def _build_metrics(
    *,
    total_transitions: int,
    unique_robot_count: int,
    unique_planner_count: int,
    unique_task_count: int,
    unique_adapter_count: int,
    counterfactual_transition_count: int,
    live_rollout_transition_count: int,
) -> WorldBridgeReadinessMetrics:
    return WorldBridgeReadinessMetrics(
        total_sessions=ONE_COUNT,
        total_joint_commands=total_transitions,
        total_scenario_time_updates=ZERO_COUNT,
        total_transitions=total_transitions,
        unique_robot_count=unique_robot_count,
        unique_planner_count=unique_planner_count,
        unique_task_count=unique_task_count,
        unique_adapter_count=unique_adapter_count,
        counterfactual_transition_count=counterfactual_transition_count,
        live_rollout_transition_count=live_rollout_transition_count,
    )


def test_readiness_reports_no_go_with_empty_metrics() -> None:
    readiness = evaluate_world_bridge_readiness(
        _build_metrics(
            total_transitions=ZERO_COUNT,
            unique_robot_count=ZERO_COUNT,
            unique_planner_count=ZERO_COUNT,
            unique_task_count=ZERO_COUNT,
            unique_adapter_count=ZERO_COUNT,
            counterfactual_transition_count=ZERO_COUNT,
            live_rollout_transition_count=ZERO_COUNT,
        )
    )
    assert readiness.decision == WorldBridgeReadinessDecision.NO_GO
    assert len(readiness.blockers) > ZERO_COUNT


def test_readiness_reports_watch_when_watch_thresholds_met_only() -> None:
    readiness = evaluate_world_bridge_readiness(
        _build_metrics(
            total_transitions=READINESS_MIN_TRANSITIONS_FOR_WATCH,
            unique_robot_count=READINESS_MIN_UNIQUE_ROBOTS_FOR_WATCH,
            unique_planner_count=READINESS_MIN_UNIQUE_PLANNERS_FOR_WATCH,
            unique_task_count=ZERO_COUNT,
            unique_adapter_count=ZERO_COUNT,
            counterfactual_transition_count=ZERO_COUNT,
            live_rollout_transition_count=ZERO_COUNT,
        )
    )
    assert readiness.decision == WorldBridgeReadinessDecision.WATCH
    assert len(readiness.blockers) > ZERO_COUNT


def test_readiness_reports_go_when_go_thresholds_met() -> None:
    readiness = evaluate_world_bridge_readiness(
        _build_metrics(
            total_transitions=READINESS_MIN_TRANSITIONS_FOR_GO,
            unique_robot_count=READINESS_MIN_UNIQUE_ROBOTS_FOR_GO,
            unique_planner_count=READINESS_MIN_UNIQUE_PLANNERS_FOR_GO,
            unique_task_count=READINESS_MIN_UNIQUE_TASKS_FOR_GO,
            unique_adapter_count=READINESS_MIN_UNIQUE_ADAPTERS_FOR_GO,
            counterfactual_transition_count=READINESS_MIN_COUNTERFACTUAL_TRANSITIONS_FOR_GO,
            live_rollout_transition_count=READINESS_MIN_LIVE_ROLLOUT_TRANSITIONS_FOR_GO,
        )
    )
    assert readiness.decision == WorldBridgeReadinessDecision.GO
    assert len(readiness.blockers) == ZERO_COUNT


def test_is_readiness_at_least_obeys_decision_order() -> None:
    assert is_readiness_at_least(
        actual=WorldBridgeReadinessDecision.GO,
        minimum=WorldBridgeReadinessDecision.WATCH,
    )
    assert is_readiness_at_least(
        actual=WorldBridgeReadinessDecision.WATCH,
        minimum=WorldBridgeReadinessDecision.NO_GO,
    )
    assert not is_readiness_at_least(
        actual=WorldBridgeReadinessDecision.NO_GO,
        minimum=WorldBridgeReadinessDecision.GO,
    )
