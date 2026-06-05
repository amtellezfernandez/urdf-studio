from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence
from xml.etree import ElementTree as ET

import numpy as np
from scipy.spatial.transform import Rotation

from backend.models.physical_state import PhysicalEntity, PhysicalRolloutTrace, SimulatorExportState
from backend.services.executability_audit import audit_physical_rollout_trace
from backend.services.world_layout_static_transfer import STUDIO_Y_UP_TO_Z_UP, WorldLayoutFrameMap


INVALID_MJCF_NAME_PATTERN = re.compile(r"[^A-Za-z0-9_.-]")
DEFAULT_RGBA = (0.231372549, 0.509803922, 0.964705882, 1.0)
_GENESIS_INITIALIZED = False


@dataclass(frozen=True)
class ExportPrimitive:
    entity_id: str
    sim_name: str
    sim_type: str
    position_xyz: list[float]
    quat_wxyz: list[float]
    size_xyz: list[float]
    rgba: tuple[float, float, float, float]
    collision: bool


def _safe_mjcf_name(value: str) -> str:
    normalized = INVALID_MJCF_NAME_PATTERN.sub("_", value.strip())
    return normalized or "entity"


def _format_float_vector(values: list[float] | tuple[float, ...]) -> str:
    return " ".join(f"{float(value):.12g}" for value in values)


def _frame_map_for_simulator(frame_convention: str) -> WorldLayoutFrameMap:
    normalized = frame_convention.strip().lower().replace("_", "-")
    if normalized in {"studio-y-up", "urdf-studio-y-up"}:
        return "studio-y-up-to-z-up"
    if normalized in {"identity", "z-up", "mujoco-z-up", "genesis-z-up", "simulator-z-up", "world-z-up"}:
        return "identity"
    raise ValueError(f"Unsupported physical frame convention for simulator export: {frame_convention}")


def _frame_matrix(frame_map: WorldLayoutFrameMap) -> np.ndarray:
    if frame_map == "studio-y-up-to-z-up":
        return STUDIO_Y_UP_TO_Z_UP
    if frame_map == "identity":
        return np.eye(3)
    raise ValueError(f"Unsupported MuJoCo export frame map: {frame_map}")


def _transform_position(position_xyz: Sequence[float], frame_map: WorldLayoutFrameMap) -> list[float]:
    transformed = _frame_matrix(frame_map) @ np.array(position_xyz, dtype=float)
    return [float(component) for component in transformed]


def _transform_size(size_xyz: Sequence[float], frame_map: WorldLayoutFrameMap) -> list[float]:
    transformed = np.abs(_frame_matrix(frame_map)) @ np.array(size_xyz, dtype=float)
    return [float(component) for component in transformed]


def _transform_quat_wxyz(quat_wxyz: Sequence[float], frame_map: WorldLayoutFrameMap) -> list[float]:
    frame = _frame_matrix(frame_map)
    physical_rotation = Rotation.from_quat([quat_wxyz[1], quat_wxyz[2], quat_wxyz[3], quat_wxyz[0]]).as_matrix()
    sim_rotation = frame @ physical_rotation @ frame.T
    quat_xyzw = Rotation.from_matrix(sim_rotation).as_quat()
    return [float(quat_xyzw[3]), float(quat_xyzw[0]), float(quat_xyzw[1]), float(quat_xyzw[2])]


def _parse_rgba(value: object) -> tuple[float, float, float, float]:
    if not isinstance(value, str):
        return DEFAULT_RGBA
    normalized = value.strip()
    if not normalized.startswith("#"):
        return DEFAULT_RGBA
    hex_value = normalized[1:]
    if len(hex_value) == 3:
        hex_value = "".join(component * 2 for component in hex_value)
    if len(hex_value) != 6:
        return DEFAULT_RGBA
    try:
        return (
            int(hex_value[0:2], 16) / 255.0,
            int(hex_value[2:4], 16) / 255.0,
            int(hex_value[4:6], 16) / 255.0,
            1.0,
        )
    except ValueError:
        return DEFAULT_RGBA


def _export_primitive(entity: PhysicalEntity, frame_map: WorldLayoutFrameMap) -> ExportPrimitive | None:
    if entity.size_xyz is None:
        return None
    position = _transform_position(entity.position_xyz, frame_map)
    quat = _transform_quat_wxyz(entity.quat_wxyz, frame_map)
    rgba = _parse_rgba(entity.metadata.get("color"))
    collision = entity.metadata.get("collision", True) is not False
    if entity.geometry_type == "box":
        return ExportPrimitive(
            entity_id=entity.entity_id,
            sim_name=_safe_mjcf_name(entity.entity_id),
            sim_type="box",
            position_xyz=position,
            quat_wxyz=quat,
            size_xyz=_transform_size(entity.size_xyz, frame_map),
            rgba=rgba,
            collision=collision,
        )
    if entity.geometry_type == "sphere":
        diameter = max(entity.size_xyz)
        return ExportPrimitive(
            entity_id=entity.entity_id,
            sim_name=_safe_mjcf_name(entity.entity_id),
            sim_type="sphere",
            position_xyz=position,
            quat_wxyz=quat,
            size_xyz=[diameter, diameter, diameter],
            rgba=rgba,
            collision=collision,
        )
    if entity.geometry_type == "cylinder":
        diameter = max(entity.size_xyz[0], entity.size_xyz[1])
        return ExportPrimitive(
            entity_id=entity.entity_id,
            sim_name=_safe_mjcf_name(entity.entity_id),
            sim_type="cylinder",
            position_xyz=position,
            quat_wxyz=quat,
            size_xyz=[diameter, diameter, entity.size_xyz[2]],
            rgba=rgba,
            collision=collision,
        )
    if entity.geometry_type == "point":
        diameter = max(entity.size_xyz)
        return ExportPrimitive(
            entity_id=entity.entity_id,
            sim_name=_safe_mjcf_name(entity.entity_id),
            sim_type="sphere",
            position_xyz=position,
            quat_wxyz=quat,
            size_xyz=[diameter, diameter, diameter],
            rgba=rgba,
            collision=False,
        )
    return None


def _mujoco_geom_size(primitive: ExportPrimitive) -> list[float]:
    if primitive.sim_type == "box":
        return [component / 2.0 for component in primitive.size_xyz]
    if primitive.sim_type == "sphere":
        return [max(primitive.size_xyz) / 2.0]
    if primitive.sim_type == "cylinder":
        return [primitive.size_xyz[0] / 2.0, primitive.size_xyz[2] / 2.0]
    raise ValueError(f"Unsupported MuJoCo export primitive type: {primitive.sim_type}")


def _collect_export_primitives(
    trace: PhysicalRolloutTrace,
    *,
    target: str,
    output_path: Path | None,
    branch_id: str | None,
) -> tuple[list[ExportPrimitive], str, int, list[str], SimulatorExportState | None]:
    report = audit_physical_rollout_trace(trace)
    if not report.success:
        return [], "identity", 0, [], SimulatorExportState(
            success=False,
            target=target,  # type: ignore[arg-type]
            branch_id=branch_id,
            output_path=str(output_path) if output_path else None,
            smoke_passed=False,
            error=f"Trace is not executable: decision={report.decision}, score={report.score:.3f}",
            metrics={"audit_decision": report.decision, "audit_score": report.score},
        )
    if not trace.frames:
        return [], "identity", 0, [], SimulatorExportState(
            success=False,
            target=target,  # type: ignore[arg-type]
            branch_id=branch_id,
            output_path=str(output_path) if output_path else None,
            smoke_passed=False,
            error="Cannot export an empty rollout trace.",
        )

    final_frame = trace.frames[-1]
    try:
        frame_map = _frame_map_for_simulator(final_frame.frame_convention)
    except ValueError as exc:
        return [], "identity", 0, [], SimulatorExportState(
            success=False,
            target=target,  # type: ignore[arg-type]
            branch_id=branch_id,
            output_path=str(output_path) if output_path else None,
            smoke_passed=False,
            error=str(exc),
        )

    skipped_hidden_count = 0
    warnings: list[str] = []
    primitives: list[ExportPrimitive] = []
    for entity in final_frame.entities:
        if entity.metadata.get("is_hidden") is True:
            skipped_hidden_count += 1
            warnings.append(f"Skipped hidden entity: {entity.entity_id}")
            continue
        primitive = _export_primitive(entity, frame_map)
        if primitive is not None:
            primitives.append(primitive)
    return primitives, frame_map, skipped_hidden_count, warnings, None


def _final_frame(trace: PhysicalRolloutTrace):
    return trace.frames[-1]


def export_rollout_trace_to_mujoco_mjcf(
    trace: PhysicalRolloutTrace,
    *,
    output_path: Path | None = None,
    branch_id: str | None = None,
) -> tuple[str, SimulatorExportState]:
    primitives, frame_map, skipped_hidden_count, warnings, failure = _collect_export_primitives(
        trace,
        target="mujoco",
        output_path=output_path,
        branch_id=branch_id,
    )
    if failure is not None:
        return "", failure

    final_frame = _final_frame(trace)
    root = ET.Element("mujoco", {"model": _safe_mjcf_name(final_frame.frame_id)})
    worldbody = ET.SubElement(root, "worldbody")
    for primitive in primitives:
        attrs = {
            "name": primitive.sim_name,
            "type": primitive.sim_type,
            "pos": _format_float_vector(primitive.position_xyz),
            "quat": _format_float_vector(primitive.quat_wxyz),
            "size": _format_float_vector(_mujoco_geom_size(primitive)),
            "rgba": _format_float_vector(primitive.rgba),
        }
        if not primitive.collision:
            attrs["contype"] = "0"
            attrs["conaffinity"] = "0"
        ET.SubElement(worldbody, "geom", attrs)

    mjcf_text = ET.tostring(root, encoding="unicode")
    smoke_passed = False
    smoke_error: str | None = None
    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(mjcf_text + "\n", encoding="utf-8")

    try:
        import mujoco

        mujoco.MjModel.from_xml_string(mjcf_text)
        smoke_passed = True
    except ImportError:
        warnings.append("MuJoCo is not installed; MJCF XML was generated but not smoke-loaded.")
    except Exception as exc:
        smoke_error = str(exc)

    report = audit_physical_rollout_trace(trace)
    status = SimulatorExportState(
        success=smoke_error is None,
        target="mujoco",
        branch_id=branch_id,
        output_path=str(output_path) if output_path else None,
        smoke_passed=smoke_passed,
        error=smoke_error,
        warnings=warnings,
        metrics={
            "exported_geom_count": len(primitives),
            "skipped_hidden_count": skipped_hidden_count,
            "frame_id": final_frame.frame_id,
            "trace_id": trace.trace_id,
            "audit_score": report.score,
            "source_frame_convention": final_frame.frame_convention,
            "mujoco_frame_map": frame_map,
        },
    )
    return mjcf_text, status


def _primitive_to_genesis_record(primitive: ExportPrimitive) -> dict[str, Any]:
    record: dict[str, Any] = {
        "entity_id": primitive.entity_id,
        "name": primitive.sim_name,
        "type": primitive.sim_type,
        "position_xyz": primitive.position_xyz,
        "quat_wxyz": primitive.quat_wxyz,
        "rgba": list(primitive.rgba),
        "collision": primitive.collision,
    }
    if primitive.sim_type == "box":
        record["size_xyz"] = primitive.size_xyz
    elif primitive.sim_type == "sphere":
        record["radius_m"] = max(primitive.size_xyz) / 2.0
    elif primitive.sim_type == "cylinder":
        record["radius_m"] = primitive.size_xyz[0] / 2.0
        record["height_m"] = primitive.size_xyz[2]
    return record


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


def _build_genesis_scene(primitives: Sequence[ExportPrimitive]) -> dict[str, float | int]:
    import genesis as gs

    _ensure_genesis_initialized(gs)
    scene = gs.Scene(show_viewer=False)
    entities: list[tuple[ExportPrimitive, Any]] = []
    for primitive in primitives:
        if primitive.sim_type == "box":
            morph = gs.morphs.Box(
                size=primitive.size_xyz,
                pos=primitive.position_xyz,
                quat=primitive.quat_wxyz,
                fixed=True,
                collision=primitive.collision,
            )
        elif primitive.sim_type == "sphere":
            morph = gs.morphs.Sphere(
                radius=max(primitive.size_xyz) / 2.0,
                pos=primitive.position_xyz,
                quat=primitive.quat_wxyz,
                fixed=True,
                collision=primitive.collision,
            )
        elif primitive.sim_type == "cylinder":
            morph = gs.morphs.Cylinder(
                radius=primitive.size_xyz[0] / 2.0,
                height=primitive.size_xyz[2],
                pos=primitive.position_xyz,
                quat=primitive.quat_wxyz,
                fixed=True,
                collision=primitive.collision,
            )
        else:
            raise ValueError(f"Unsupported Genesis primitive type: {primitive.sim_type}")
        surface = gs.surfaces.Default(color=primitive.rgba[:3], opacity=primitive.rgba[3])
        entities.append((primitive, scene.add_entity(morph, surface=surface, name=primitive.sim_name)))
    scene.build()

    max_position_error = 0.0
    max_quat_error = 0.0
    for primitive, entity in entities:
        loaded_position = np.array(entity.get_pos().tolist(), dtype=float)
        expected_position = np.array(primitive.position_xyz, dtype=float)
        max_position_error = max(max_position_error, float(np.linalg.norm(loaded_position - expected_position)))
        loaded_quat = np.array(entity.get_quat().tolist(), dtype=float)
        expected_quat = np.array(primitive.quat_wxyz, dtype=float)
        quat_error = min(
            float(np.linalg.norm(loaded_quat - expected_quat)),
            float(np.linalg.norm(loaded_quat + expected_quat)),
        )
        max_quat_error = max(max_quat_error, quat_error)
    return {
        "genesis_entity_count": len(entities),
        "max_position_error_m": max_position_error,
        "max_quat_error": max_quat_error,
    }


def export_rollout_trace_to_genesis_scene(
    trace: PhysicalRolloutTrace,
    *,
    output_path: Path | None = None,
    branch_id: str | None = None,
) -> tuple[dict[str, Any], SimulatorExportState]:
    primitives, frame_map, skipped_hidden_count, warnings, failure = _collect_export_primitives(
        trace,
        target="genesis",
        output_path=output_path,
        branch_id=branch_id,
    )
    if failure is not None:
        return {}, failure

    final_frame = _final_frame(trace)
    scene_payload: dict[str, Any] = {
        "schema_version": "wsp-genesis-scene-v1",
        "target": "genesis",
        "frame_id": final_frame.frame_id,
        "trace_id": trace.trace_id,
        "branch_id": branch_id,
        "source_frame_convention": final_frame.frame_convention,
        "genesis_frame_map": frame_map,
        "entities": [_primitive_to_genesis_record(primitive) for primitive in primitives],
    }
    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(scene_payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    smoke_passed = False
    smoke_error: str | None = None
    smoke_metrics: dict[str, float | int] = {}
    try:
        smoke_metrics = _build_genesis_scene(primitives)
        smoke_passed = True
    except ImportError:
        warnings.append("Genesis is not installed; Genesis scene JSON was generated but not smoke-built.")
    except Exception as exc:
        smoke_error = str(exc)

    report = audit_physical_rollout_trace(trace)
    status = SimulatorExportState(
        success=smoke_error is None,
        target="genesis",
        branch_id=branch_id,
        output_path=str(output_path) if output_path else None,
        smoke_passed=smoke_passed,
        error=smoke_error,
        warnings=warnings,
        metrics={
            "exported_entity_count": len(primitives),
            "skipped_hidden_count": skipped_hidden_count,
            "frame_id": final_frame.frame_id,
            "trace_id": trace.trace_id,
            "audit_score": report.score,
            "source_frame_convention": final_frame.frame_convention,
            "genesis_frame_map": frame_map,
            **smoke_metrics,
        },
    )
    return scene_payload, status
