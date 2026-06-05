from __future__ import annotations

from backend.models.physical_state import ActionToken, PhysicalStateFrame, PhysicalTokenSequence


ENTITY_TYPE_IDS = {
    "unknown": 0,
    "robot": 1,
    "object": 2,
    "surface": 3,
    "zone": 4,
    "target": 5,
}

ACTION_TYPE_IDS = {
    "noop": 0,
    "translate": 1,
    "push": 2,
    "move_object": 3,
    "set_pose": 4,
    "custom": 99,
}

CONSTRAINT_TYPES = (
    "collision",
    "joint_limit",
    "contact",
    "reachability",
    "battery",
    "capacity",
    "scale",
    "frame",
    "custom",
)


def _format_float(value: float) -> str:
    return f"{value:.6g}"


def _entity_feature_vector(entity) -> list[float]:
    size = entity.size_xyz or [0.0, 0.0, 0.0]
    mass = entity.mass_kg or 0.0
    return [
        *entity.position_xyz,
        *entity.quat_wxyz,
        *size,
        *entity.velocity_xyz,
        mass,
        1.0 if entity.movable else 0.0,
        entity.confidence,
    ]


def build_physical_token_sequence(
    frame: PhysicalStateFrame,
    action: ActionToken | None = None,
) -> PhysicalTokenSequence:
    text_tokens = [f"<TIME_{frame.t_ms:06d}>"]
    entity_type_ids: list[int] = []
    continuous_features: list[list[float]] = []

    for entity in frame.entities:
        entity_type_ids.append(ENTITY_TYPE_IDS.get(entity.entity_type, ENTITY_TYPE_IDS["unknown"]))
        continuous_features.append(_entity_feature_vector(entity))
        pose = " ".join(_format_float(component) for component in entity.position_xyz)
        size = " ".join(_format_float(component) for component in (entity.size_xyz or [0.0, 0.0, 0.0]))
        text_tokens.append(
            f"<ENTITY id={entity.entity_id} type={entity.entity_type} geom={entity.geometry_type} "
            f"pose={pose} size={size}>"
        )

    action_ids: list[int] = []
    if action is not None:
        action_ids.append(ACTION_TYPE_IDS.get(action.action_type, ACTION_TYPE_IDS["custom"]))
        text_tokens.append(
            f"<ACTION id={action.action_id} type={action.action_type} actor={action.actor_id or ''} "
            f"object={action.object_id or ''} target={action.target_id or ''}>"
        )

    relation_edges = [
        {
            "source": relation.source_id,
            "target": relation.target_id,
            "type": relation.relation_type,
            "confidence": relation.confidence,
        }
        for relation in frame.relations
    ]
    constraint_mask = {constraint_type: False for constraint_type in CONSTRAINT_TYPES}
    for constraint in frame.constraints:
        constraint_mask[constraint.constraint_type] = True

    return PhysicalTokenSequence(
        frame_id=frame.frame_id,
        text_tokens=text_tokens,
        entity_type_ids=entity_type_ids,
        action_ids=action_ids,
        continuous_features=continuous_features,
        relation_edges=relation_edges,
        constraint_mask=constraint_mask,
        metadata={
            "entity_count": len(frame.entities),
            "relation_count": len(frame.relations),
            "constraint_count": len(frame.constraints),
            "frame_convention": frame.frame_convention,
        },
    )
