from __future__ import annotations

from collections.abc import Sequence
from typing import Any, TypeAlias

from backend.services.world_layout_transfer_constants import (
    COLOR_TOLERANCE,
    POSITION_TOLERANCE_M,
    QUATERNION_TOLERANCE,
    SIZE_TOLERANCE_M,
)
from backend.services.world_layout_transfer_report import (
    PrimitiveCheckReport,
    build_primitive_check_report,
)
from backend.services.world_layout_transfer_types import (
    LoadedPrimitive,
    SimPrimitive,
    WorldLayoutTransferError,
)

_GENESIS_INITIALIZED = False
GenesisEntityEntry: TypeAlias = tuple[SimPrimitive, object]


def _ensure_genesis_initialized(gs: Any) -> None:
    global _GENESIS_INITIALIZED
    if _GENESIS_INITIALIZED:
        return
    try:
        gs.init(backend=gs.cpu, logging_level="warning")
    except Exception as exc:
        if "already" not in str(exc).lower() and "initialized" not in str(exc).lower():
            raise
    _GENESIS_INITIALIZED = True


def check_genesis_transfer(
    primitives: Sequence[SimPrimitive],
    *,
    position_tolerance_m: float = POSITION_TOLERANCE_M,
    size_tolerance_m: float = SIZE_TOLERANCE_M,
    quaternion_tolerance: float = QUATERNION_TOLERANCE,
    color_tolerance: float = COLOR_TOLERANCE,
) -> PrimitiveCheckReport:
    import genesis as gs

    _ensure_genesis_initialized(gs)
    scene = gs.Scene(show_viewer=False)
    entities: list[GenesisEntityEntry] = []
    for primitive in primitives:
        if primitive.sim_type == "box":
            morph = gs.morphs.Box(
                size=primitive.size_xyz,
                pos=primitive.position_xyz,
                quat=primitive.quat_wxyz,
                fixed=primitive.fixed,
                collision=primitive.collision,
            )
        elif primitive.sim_type == "sphere":
            morph = gs.morphs.Sphere(
                radius=max(primitive.size_xyz) * 0.5,
                pos=primitive.position_xyz,
                quat=primitive.quat_wxyz,
                fixed=primitive.fixed,
                collision=primitive.collision,
            )
        elif primitive.sim_type == "cylinder":
            morph = gs.morphs.Cylinder(
                radius=primitive.size_xyz[0] * 0.5,
                height=primitive.size_xyz[2],
                pos=primitive.position_xyz,
                quat=primitive.quat_wxyz,
                fixed=primitive.fixed,
                collision=primitive.collision,
            )
        else:
            raise WorldLayoutTransferError(
                f"Unsupported Genesis primitive type: {primitive.sim_type}"
            )
        surface = gs.surfaces.Default(color=primitive.rgba[:3], opacity=primitive.rgba[3])
        entity = scene.add_entity(morph, surface=surface, name=primitive.sim_name)
        entities.append((primitive, entity))
    scene.build()
    loaded: list[LoadedPrimitive] = []
    for primitive, entity in entities:
        pos = entity.get_pos()
        quat = entity.get_quat()
        loaded.append(
            LoadedPrimitive(
                source_id=primitive.source_id,
                sim_name=primitive.sim_name,
                sim_type=_genesis_morph_type_name(entity.main_morph),
                position_xyz=tuple(float(value) for value in pos.tolist()),
                quat_wxyz=tuple(float(value) for value in quat.tolist()),
                size_xyz=_genesis_morph_full_size(entity.main_morph),
                collision=bool(entity.main_morph.collision),
                rgba=_genesis_entity_rgba(entity),
            )
        )
    report: PrimitiveCheckReport = build_primitive_check_report(
        primitives,
        loaded,
        position_tolerance_m=position_tolerance_m,
        size_tolerance_m=size_tolerance_m,
        quaternion_tolerance=quaternion_tolerance,
        color_tolerance=color_tolerance,
    )
    report.update(
        {
            "backend": "genesis",
            "genesis_version": getattr(gs, "__version__", "unknown"),
            "entity_count": len(entities),
        }
    )
    return report


def _genesis_morph_type_name(morph: object) -> str | None:
    class_name = type(morph).__name__.lower()
    if class_name == "box":
        return "box"
    if class_name == "sphere":
        return "sphere"
    if class_name == "cylinder":
        return "cylinder"
    return None


def _genesis_morph_full_size(morph: object) -> tuple[float, float, float] | None:
    morph_type = _genesis_morph_type_name(morph)
    if morph_type == "box":
        return tuple(float(value) for value in morph.size)
    if morph_type == "sphere":
        diameter = float(morph.radius * 2.0)
        return (diameter, diameter, diameter)
    if morph_type == "cylinder":
        diameter = float(morph.radius * 2.0)
        return (diameter, diameter, float(morph.height))
    return None


def _genesis_entity_rgba(entity: object) -> tuple[float, float, float, float] | None:
    surface = getattr(entity, "surface", None)
    diffuse = _genesis_texture_color(getattr(surface, "diffuse_texture", None))
    if diffuse is None or len(diffuse) < 3:
        return None
    opacity = _genesis_texture_color(getattr(surface, "opacity_texture", None))
    alpha = opacity[0] if opacity else 1.0
    return (float(diffuse[0]), float(diffuse[1]), float(diffuse[2]), float(alpha))


def _genesis_texture_color(texture: object) -> tuple[float, ...] | None:
    color = getattr(texture, "color", None)
    if color is None:
        return None
    try:
        return tuple(float(value) for value in color)
    except (TypeError, ValueError):
        return None
