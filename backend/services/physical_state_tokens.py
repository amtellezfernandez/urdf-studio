from __future__ import annotations

from backend.models.physical_state import ActionToken, PhysicalStateFrame, PhysicalTokenSequence


TOKEN_SCHEMA_VERSION = "wsp-physical-token-sequence-v1"

ENTITY_TYPE_IDS = {
    "unknown": 0,
    "robot": 1,
    "object": 2,
    "pallet": 3,
    "dock": 4,
    "lane": 5,
    "zone": 6,
    "surface": 7,
    "target": 8,
    "camera": 9,
    "human": 10,
    "tool": 11,
}

ACTION_TYPE_IDS = {
    "noop": 0,
    "navigate": 1,
    "translate": 2,
    "push": 3,
    "pick": 4,
    "place": 5,
    "move_object": 6,
    "reserve_dock": 7,
    "wait": 8,
    "handoff_to_human": 9,
    "inspect": 10,
    "replan": 11,
    "set_pose": 12,
    "custom": 99,
}

CONSTRAINT_TYPES = (
    "collision",
    "joint_limit",
    "contact",
    "contact_stability",
    "reachability",
    "battery",
    "capacity",
    "deadline",
    "temperature",
    "dock_availability",
    "scale",
    "frame",
    "custom",
)

ENTITY_FEATURE_SCHEMA = (
    "position_x_m",
    "position_y_m",
    "position_z_m",
    "quat_w",
    "quat_x",
    "quat_y",
    "quat_z",
    "size_x_m",
    "size_y_m",
    "size_z_m",
    "velocity_x_mps",
    "velocity_y_mps",
    "velocity_z_mps",
    "mass_kg",
    "friction",
    "battery_fraction",
    "movable",
    "confidence",
)


def _format_float(value: float) -> str:
    return f"{value:.6g}"


def _entity_feature_vector(entity) -> list[float]:
    size = entity.size_xyz or [0.0, 0.0, 0.0]
    mass = entity.mass_kg or 0.0
    friction = entity.friction if entity.friction is not None else 0.0
    battery = entity.battery if entity.battery is not None else 0.0
    return [
        *entity.position_xyz,
        *entity.quat_wxyz,
        *size,
        *entity.velocity_xyz,
        mass,
        friction,
        battery,
        1.0 if entity.movable else 0.0,
        entity.confidence,
    ]


def build_physical_token_sequence(
    frame: PhysicalStateFrame,
    action: ActionToken | None = None,
) -> PhysicalTokenSequence:
    text_tokens = [f"<TIME_{frame.t_ms:06d}>"]
    entity_ids: list[str] = []
    entity_type_ids: list[int] = []
    continuous_features: list[list[float]] = []

    for entity in frame.entities:
        entity_ids.append(entity.entity_id)
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
            f"object={action.object_id or ''} target={action.target_id or ''} destination={action.destination_id or ''}>"
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
        entity_ids=entity_ids,
        entity_type_ids=entity_type_ids,
        action_ids=action_ids,
        continuous_features=continuous_features,
        relation_edges=relation_edges,
        constraint_mask=constraint_mask,
        metadata={
            "schema_version": TOKEN_SCHEMA_VERSION,
            "entity_count": len(frame.entities),
            "relation_count": len(frame.relations),
            "constraint_count": len(frame.constraints),
            "frame_convention": frame.frame_convention,
            "entity_feature_schema": list(ENTITY_FEATURE_SCHEMA),
            "entity_feature_dim": len(ENTITY_FEATURE_SCHEMA),
            "entity_type_vocab": ENTITY_TYPE_IDS,
            "action_type_vocab": ACTION_TYPE_IDS,
            "constraint_types": list(CONSTRAINT_TYPES),
            "frame_snapshot": frame.model_dump(mode="json"),
            "action_snapshot": action.model_dump(mode="json") if action is not None else None,
        },
    )


def decode_physical_token_sequence(sequence: PhysicalTokenSequence) -> PhysicalStateFrame:
    snapshot = sequence.metadata.get("frame_snapshot")
    if not isinstance(snapshot, dict):
        raise ValueError("PhysicalTokenSequence does not contain a frame_snapshot for roundtrip decoding.")
    return PhysicalStateFrame.model_validate(snapshot)
