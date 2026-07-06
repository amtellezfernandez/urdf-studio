from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from backend.models.json_payload import JsonObject

StaticTransferValidationBackend = Literal["mujoco", "genesis"]
ConcreteWorldLayoutFrameMap = Literal["identity", "studio-y-up-to-z-up"]
WorldLayoutFrameMap = Literal["auto", "identity", "studio-y-up-to-z-up"]


class WorldLayoutTransferError(ValueError):
    ...


@dataclass(frozen=True)
class WorldLayoutObject:
    id: str
    name: str
    primitive_type: str
    position_xyz: tuple[float, float, float]
    rotation_rpy_rad: tuple[float, float, float]
    size_xyz: tuple[float, float, float]
    color: str
    is_hidden: bool = False
    fixed: bool = True
    collision: bool = True
    mass_kg: float | None = None
    friction: float | None = None
    restitution: float | None = None
    semantic_role: str | None = None
    asset_ref: str | None = None
    asset_scale_xyz: tuple[float, float, float] | None = None


@dataclass(frozen=True)
class StaticWorldLayout:
    name: str
    objects: tuple[WorldLayoutObject, ...]
    scenario_time_ms: int
    scenario_duration_ms: int
    source_kind: str
    urdf_xml: str | None = None
    joint_positions: dict[str, float] | None = None
    cameras: tuple[JsonObject, ...] = ()
    environment: JsonObject | None = None
    frame_convention: str | None = None
    frame_map_hint: ConcreteWorldLayoutFrameMap | None = None


@dataclass(frozen=True)
class SimPrimitive:
    source_id: str
    source_name: str
    sim_name: str
    source_type: str
    sim_type: str
    position_xyz: tuple[float, float, float]
    quat_wxyz: tuple[float, float, float, float]
    size_xyz: tuple[float, float, float]
    rgba: tuple[float, float, float, float]
    collision: bool
    fixed: bool = True
    mass_kg: float | None = None
    friction: float | None = None
    restitution: float | None = None
    semantic_role: str | None = None
    asset_ref: str | None = None
    asset_scale_xyz: tuple[float, float, float] | None = None


@dataclass(frozen=True)
class LoadedPrimitive:
    source_id: str
    sim_name: str
    sim_type: str | None
    position_xyz: tuple[float, float, float]
    quat_wxyz: tuple[float, float, float, float] | None
    size_xyz: tuple[float, float, float] | None
    collision: bool | None
    rgba: tuple[float, float, float, float] | None = None
