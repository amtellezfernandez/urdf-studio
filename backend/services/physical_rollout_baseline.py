from __future__ import annotations

from copy import deepcopy
from uuid import uuid4

from backend.models.physical_state import ActionToken, PhysicalRolloutTrace, PhysicalStateFrame


def _read_delta(action: ActionToken, step_count: int) -> list[float]:
    raw_delta = action.params.get("delta_xyz", [0.0, 0.0, 0.0])
    if not isinstance(raw_delta, list | tuple) or len(raw_delta) != 3:
        raw_delta = [0.0, 0.0, 0.0]
    return [float(component) / max(1, step_count) for component in raw_delta]


def _move_entity(frame: PhysicalStateFrame, entity_id: str | None, delta_xyz: list[float]) -> None:
    if entity_id is None:
        return
    for entity in frame.entities:
        if entity.entity_id != entity_id:
            continue
        entity.position_xyz = [
            entity.position_xyz[0] + delta_xyz[0],
            entity.position_xyz[1] + delta_xyz[1],
            entity.position_xyz[2] + delta_xyz[2],
        ]
        entity.velocity_xyz = delta_xyz
        return


def _entity_position(frame: PhysicalStateFrame, entity_id: str | None) -> list[float] | None:
    if entity_id is None:
        return None
    for entity in frame.entities:
        if entity.entity_id == entity_id:
            return list(entity.position_xyz)
    return None


def _read_destination_delta(frame: PhysicalStateFrame, action: ActionToken, step_count: int) -> list[float]:
    actor_id = action.actor_id or action.object_id
    actor_position = _entity_position(frame, actor_id)
    if actor_position is None:
        return [0.0, 0.0, 0.0]
    destination = action.params.get("destination_xyz")
    if not (isinstance(destination, list | tuple) and len(destination) == 3):
        destination = _entity_position(frame, action.destination_id or action.target_id)
    if not (isinstance(destination, list | tuple) and len(destination) == 3):
        return [0.0, 0.0, 0.0]
    return [
        (float(destination[0]) - actor_position[0]) / max(1, step_count),
        (float(destination[1]) - actor_position[1]) / max(1, step_count),
        (float(destination[2]) - actor_position[2]) / max(1, step_count),
    ]


def _set_entity_metadata(frame: PhysicalStateFrame, entity_id: str | None, updates: dict) -> None:
    if entity_id is None:
        return
    for entity in frame.entities:
        if entity.entity_id != entity_id:
            continue
        entity.metadata = {**entity.metadata, **updates}
        return


def _apply_action_step(frame: PhysicalStateFrame, action: ActionToken, *, step_count: int) -> PhysicalStateFrame:
    next_frame = frame.model_copy(deep=True)
    delta = _read_delta(action, step_count)
    if action.action_type == "navigate":
        _move_entity(next_frame, action.actor_id, _read_destination_delta(frame, action, step_count))
    elif action.action_type in {"translate", "move_object"}:
        _move_entity(next_frame, action.object_id or action.actor_id, delta)
    elif action.action_type == "push":
        _move_entity(next_frame, action.object_id, delta)
        _move_entity(next_frame, action.actor_id, [component * 0.25 for component in delta])
    elif action.action_type == "set_pose":
        entity_id = action.object_id or action.actor_id
        raw_position = action.params.get("position_xyz")
        if isinstance(raw_position, list | tuple) and len(raw_position) == 3:
            for entity in next_frame.entities:
                if entity.entity_id == entity_id:
                    entity.position_xyz = [float(component) for component in raw_position]
                    entity.velocity_xyz = [0.0, 0.0, 0.0]
                    break
    elif action.action_type == "reserve_dock":
        _set_entity_metadata(
            next_frame,
            action.destination_id or action.target_id,
            {"dock_status": "reserved", "reserved_by": action.actor_id},
        )
    elif action.action_type == "handoff_to_human":
        _set_entity_metadata(next_frame, action.object_id or action.target_id, {"handoff_requested": True})
    elif action.action_type in {"wait", "inspect", "replan", "noop"}:
        pass
    return next_frame


def rollout_action(
    frame: PhysicalStateFrame,
    action: ActionToken,
    *,
    step_count: int = 3,
    step_ms: int = 100,
) -> PhysicalRolloutTrace:
    if step_count < 1:
        raise ValueError("step_count must be >= 1.")
    if step_ms < 1:
        raise ValueError("step_ms must be >= 1.")

    frames = [frame.model_copy(deep=True)]
    current = frame
    for step_index in range(1, step_count + 1):
        current = _apply_action_step(current, action, step_count=step_count)
        current.frame_id = f"{frame.frame_id}:rollout:{step_index}"
        current.t_ms = frame.t_ms + step_index * step_ms
        current.metadata = {
            **deepcopy(current.metadata),
            "rollout_step": step_index,
            "rollout_action_id": action.action_id,
            "rollout_baseline": "deterministic_delta",
        }
        frames.append(current)

    return PhysicalRolloutTrace(
        trace_id=f"wsp-rollout-{uuid4().hex}",
        frames=frames,
        actions=[action],
        metadata={
            "runner": "deterministic_delta",
            "step_count": step_count,
            "step_ms": step_ms,
        },
    )
