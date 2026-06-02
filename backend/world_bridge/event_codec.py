from __future__ import annotations

from backend.world_bridge.types import WorldBridgeEventType

WORLDD_EVENT_TYPE_BY_WORLD_BRIDGE_EVENT_TYPE: dict[WorldBridgeEventType, str] = {
    WorldBridgeEventType.SESSION_CREATED: "session_created",
    WorldBridgeEventType.JOINT_COMMAND_APPLIED: "joint_command_applied",
    WorldBridgeEventType.SCENARIO_TIME_UPDATED: "scenario_time_updated",
}

WORLD_BRIDGE_EVENT_TYPE_BY_WORLDD_EVENT_TYPE: dict[str, WorldBridgeEventType] = {
    worldd_value: world_bridge_value
    for world_bridge_value, worldd_value in WORLDD_EVENT_TYPE_BY_WORLD_BRIDGE_EVENT_TYPE.items()
}


def worldd_event_type_from_world_bridge(
    event_type: WorldBridgeEventType,
) -> str | None:
    return WORLDD_EVENT_TYPE_BY_WORLD_BRIDGE_EVENT_TYPE.get(event_type)


def world_bridge_event_type_from_worldd(
    event_type: str,
) -> WorldBridgeEventType | None:
    return WORLD_BRIDGE_EVENT_TYPE_BY_WORLDD_EVENT_TYPE.get(event_type)
