from __future__ import annotations

import hashlib
import json
import math
from typing import Any
from xml.etree import ElementTree as ET

from backend.models.physical_state import (
    PhysicalCompilerOutput,
    PhysicalEntity,
    PhysicalStateFrame,
)
from backend.models.world_scene_package import WorldScenePackageManifest
from backend.services.physical_state_tokens import build_physical_token_sequence
from backend.services.world_layout_static_transfer import StaticWorldLayout, parse_static_world_layout_payload


def _read_vector3(value: Any, fallback: list[float]) -> list[float]:
    if not isinstance(value, list | tuple) or len(value) != 3:
        return fallback
    try:
        parsed = [float(component) for component in value]
    except (TypeError, ValueError):
        return fallback
    if not all(math.isfinite(component) for component in parsed):
        return fallback
    return parsed


def _rpy_to_quat_wxyz(rpy: list[float]) -> list[float]:
    roll, pitch, yaw = rpy
    half_roll = roll / 2.0
    half_pitch = pitch / 2.0
    half_yaw = yaw / 2.0
    cr = math.cos(half_roll)
    sr = math.sin(half_roll)
    cp = math.cos(half_pitch)
    sp = math.sin(half_pitch)
    cy = math.cos(half_yaw)
    sy = math.sin(half_yaw)
    return [
        cr * cp * cy + sr * sp * sy,
        sr * cp * cy - cr * sp * sy,
        cr * sp * cy + sr * cp * sy,
        cr * cp * sy - sr * sp * cy,
    ]


def _stable_entity_id(prefix: str, index: int, raw_id: Any) -> str:
    if isinstance(raw_id, str) and raw_id.strip():
        return raw_id.strip()
    return f"{prefix}_{index:03d}"


def _geometry_type(raw_type: Any) -> str:
    if raw_type == "cube":
        return "box"
    if raw_type in {"sphere", "cylinder", "point", "mesh"}:
        return str(raw_type)
    return "unknown"


def _robot_name_from_urdf(urdf_xml: str) -> str:
    try:
        root = ET.fromstring(urdf_xml)
    except ET.ParseError:
        return "robot"
    if root.tag != "robot":
        return "robot"
    raw_name = root.get("name")
    return raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else "robot"


def _compile_object_record(obj: dict[str, Any], index: int, *, source_ref: str) -> PhysicalEntity:
    entity_id = _stable_entity_id("object", index, obj.get("id") or obj.get("name"))
    raw_type = obj.get("type") or obj.get("geometry_type")
    position = _read_vector3(obj.get("position_xyz") or obj.get("position"), [0.0, 0.0, 0.0])
    size = _read_vector3(obj.get("size_xyz") or obj.get("size"), [0.01, 0.01, 0.01])
    rpy = _read_vector3(obj.get("rotation_rpy_rad"), [0.0, 0.0, 0.0])
    mass = obj.get("mass_kg")
    friction = obj.get("friction")
    battery = obj.get("battery")
    raw_entity_type = obj.get("entity_type") or obj.get("role") or obj.get("semantic_type")
    return PhysicalEntity(
        entity_id=entity_id,
        entity_type=raw_entity_type if raw_entity_type in {"robot", "object", "pallet", "dock", "lane", "zone", "surface", "target", "camera", "human", "tool"} else "object",
        label=obj.get("name") if isinstance(obj.get("name"), str) else entity_id,
        geometry_type=_geometry_type(raw_type),  # type: ignore[arg-type]
        position_xyz=position,
        quat_wxyz=_rpy_to_quat_wxyz(rpy),
        size_xyz=size,
        mass_kg=float(mass) if isinstance(mass, int | float) and mass > 0 else None,
        friction=float(friction) if isinstance(friction, int | float) and friction >= 0 else None,
        battery=float(battery) if isinstance(battery, int | float) and 0 <= battery <= 1 else None,
        movable=obj.get("movable") is not False,
        confidence=float(obj.get("confidence", 1.0)) if isinstance(obj.get("confidence", 1.0), int | float) else 1.0,
        source_ref=source_ref,
        metadata={
            "source_type": raw_type or "unknown",
            "color": obj.get("color"),
            "is_hidden": obj.get("is_hidden") is True,
            "collision": obj.get("collision", True) is not False,
            "dock_status": obj.get("dock_status"),
            "reserved_by": obj.get("reserved_by"),
        },
    )


def compile_world_scene_package(manifest: WorldScenePackageManifest) -> PhysicalCompilerOutput:
    entities: list[PhysicalEntity] = []
    snapshot = manifest.world_snapshot
    urdf_sha256 = hashlib.sha256(snapshot.urdf_xml.encode("utf-8")).hexdigest()
    if snapshot.urdf_xml.strip():
        entities.append(
            PhysicalEntity(
                entity_id="robot",
                entity_type="robot",
                label=_robot_name_from_urdf(snapshot.urdf_xml),
                geometry_type="unknown",
                movable=True,
                source_ref=f"world_package:{manifest.package_id}@{manifest.version}",
                metadata={
                    "urdf_sha256": urdf_sha256,
                    "joint_positions": snapshot.joint_positions,
                    "collision": False,
                },
            )
        )

    for index, obj in enumerate(snapshot.objects):
        if isinstance(obj, dict):
            entities.append(
                _compile_object_record(
                    obj,
                    index,
                    source_ref=f"world_package:{manifest.package_id}@{manifest.version}:objects[{index}]",
                )
            )

    frame = PhysicalStateFrame(
        frame_id=f"{manifest.package_id}:{snapshot.scenario_time_ms}",
        t_ms=snapshot.scenario_time_ms,
        frame_convention=manifest.interface.frame_convention,
        entities=entities,
        source_refs=[f"world_package:{manifest.package_id}@{manifest.version}"],
        metadata={
            "package_id": manifest.package_id,
            "version": manifest.version,
            "title": manifest.title,
            "scenario_duration_ms": snapshot.scenario_duration_ms,
            "observation_modalities": manifest.interface.observation_modalities,
            "action_semantics": manifest.interface.action_semantics,
            "timestep_ms": manifest.interface.timestep_ms,
        },
    )
    return PhysicalCompilerOutput(frame=frame, tokens=build_physical_token_sequence(frame))


def compile_static_world_layout(layout: StaticWorldLayout) -> PhysicalCompilerOutput:
    entities = [
        PhysicalEntity(
            entity_id=obj.id,
            entity_type="object",
            label=obj.name,
            geometry_type=_geometry_type(obj.primitive_type),  # type: ignore[arg-type]
            position_xyz=list(obj.position_xyz),
            quat_wxyz=_rpy_to_quat_wxyz(list(obj.rotation_rpy_rad)),
            size_xyz=list(obj.size_xyz),
            movable=True,
            source_ref=f"{layout.source_kind}:objects[{index}]",
            metadata={
                "source_type": obj.primitive_type,
                "color": obj.color,
                "is_hidden": obj.is_hidden,
                "collision": True,
            },
        )
        for index, obj in enumerate(layout.objects)
    ]
    frame = PhysicalStateFrame(
        frame_id=f"{layout.name}:{layout.scenario_time_ms}",
        t_ms=layout.scenario_time_ms,
        frame_convention="studio-y-up",
        entities=entities,
        source_refs=[layout.source_kind],
        metadata={
            "name": layout.name,
            "scenario_duration_ms": layout.scenario_duration_ms,
            "source_kind": layout.source_kind,
        },
    )
    return PhysicalCompilerOutput(frame=frame, tokens=build_physical_token_sequence(frame))


def compile_physical_state_payload(payload: Any) -> PhysicalCompilerOutput:
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not isinstance(payload, dict):
        raise ValueError("Physical state compiler input must be a JSON object.")
    manifest_payload = payload.get("manifest") if isinstance(payload.get("manifest"), dict) else payload
    if isinstance(manifest_payload, dict) and "world_snapshot" in manifest_payload and "package_id" in manifest_payload:
        return compile_world_scene_package(WorldScenePackageManifest.model_validate(manifest_payload))
    return compile_static_world_layout(parse_static_world_layout_payload(payload))
