from __future__ import annotations

import re
from pathlib import Path
from typing import Sequence
from xml.etree import ElementTree as ET

import numpy as np
from scipy.spatial.transform import Rotation

from backend.models.physical_state import PhysicalEntity, PhysicalRolloutTrace, SimulatorExportState
from backend.services.executability_audit import audit_physical_rollout_trace
from backend.services.world_layout_static_transfer import STUDIO_Y_UP_TO_Z_UP, WorldLayoutFrameMap


INVALID_MJCF_NAME_PATTERN = re.compile(r"[^A-Za-z0-9_.-]")
DEFAULT_RGBA = (0.231372549, 0.509803922, 0.964705882, 1.0)


def _safe_mjcf_name(value: str) -> str:
    normalized = INVALID_MJCF_NAME_PATTERN.sub("_", value.strip())
    return normalized or "entity"


def _format_float_vector(values: list[float] | tuple[float, ...]) -> str:
    return " ".join(f"{float(value):.12g}" for value in values)


def _frame_map_for_mujoco(frame_convention: str) -> WorldLayoutFrameMap:
    normalized = frame_convention.strip().lower().replace("_", "-")
    if normalized in {"studio-y-up", "urdf-studio-y-up"}:
        return "studio-y-up-to-z-up"
    if normalized in {"identity", "z-up", "mujoco-z-up", "genesis-z-up", "simulator-z-up", "world-z-up"}:
        return "identity"
    raise ValueError(f"Unsupported physical frame convention for MuJoCo export: {frame_convention}")


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


def _geom_size(entity: PhysicalEntity, frame_map: WorldLayoutFrameMap) -> tuple[str, list[float]] | None:
    if entity.size_xyz is None:
        return None
    if entity.geometry_type == "box":
        return "box", [component / 2.0 for component in _transform_size(entity.size_xyz, frame_map)]
    if entity.geometry_type == "sphere":
        return "sphere", [max(entity.size_xyz) / 2.0]
    if entity.geometry_type == "cylinder":
        radius = max(entity.size_xyz[0], entity.size_xyz[1]) / 2.0
        half_height = entity.size_xyz[2] / 2.0
        return "cylinder", [radius, half_height]
    if entity.geometry_type == "point":
        return "sphere", [max(entity.size_xyz) / 2.0]
    return None


def export_rollout_trace_to_mujoco_mjcf(
    trace: PhysicalRolloutTrace,
    *,
    output_path: Path | None = None,
    branch_id: str | None = None,
) -> tuple[str, SimulatorExportState]:
    report = audit_physical_rollout_trace(trace)
    if not report.success:
        return "", SimulatorExportState(
            success=False,
            target="mujoco",
            branch_id=branch_id,
            output_path=str(output_path) if output_path else None,
            smoke_passed=False,
            error=f"Trace is not executable: decision={report.decision}, score={report.score:.3f}",
            metrics={"audit_decision": report.decision, "audit_score": report.score},
        )
    if not trace.frames:
        return "", SimulatorExportState(
            success=False,
            target="mujoco",
            branch_id=branch_id,
            output_path=str(output_path) if output_path else None,
            smoke_passed=False,
            error="Cannot export an empty rollout trace.",
        )

    final_frame = trace.frames[-1]
    try:
        frame_map = _frame_map_for_mujoco(final_frame.frame_convention)
    except ValueError as exc:
        return "", SimulatorExportState(
            success=False,
            target="mujoco",
            branch_id=branch_id,
            output_path=str(output_path) if output_path else None,
            smoke_passed=False,
            error=str(exc),
        )

    root = ET.Element("mujoco", {"model": _safe_mjcf_name(final_frame.frame_id)})
    worldbody = ET.SubElement(root, "worldbody")
    exported_count = 0
    skipped_hidden_count = 0
    warnings: list[str] = []
    for entity in final_frame.entities:
        if entity.metadata.get("is_hidden") is True:
            skipped_hidden_count += 1
            warnings.append(f"Skipped hidden entity: {entity.entity_id}")
            continue
        geom = _geom_size(entity, frame_map)
        if geom is None:
            continue
        geom_type, size = geom
        attrs = {
            "name": _safe_mjcf_name(entity.entity_id),
            "type": geom_type,
            "pos": _format_float_vector(_transform_position(entity.position_xyz, frame_map)),
            "quat": _format_float_vector(_transform_quat_wxyz(entity.quat_wxyz, frame_map)),
            "size": _format_float_vector(size),
            "rgba": _format_float_vector(_parse_rgba(entity.metadata.get("color"))),
        }
        if entity.metadata.get("collision", True) is False:
            attrs["contype"] = "0"
            attrs["conaffinity"] = "0"
        ET.SubElement(worldbody, "geom", attrs)
        exported_count += 1

    mjcf_text = ET.tostring(root, encoding="unicode")
    smoke_passed = False
    smoke_error: str | None = None
    if output_path is not None:
        output_path.write_text(mjcf_text + "\n", encoding="utf-8")

    try:
        import mujoco

        mujoco.MjModel.from_xml_string(mjcf_text)
        smoke_passed = True
    except ImportError:
        warnings.append("MuJoCo is not installed; MJCF XML was generated but not smoke-loaded.")
    except Exception as exc:
        smoke_error = str(exc)

    status = SimulatorExportState(
        success=smoke_error is None,
        target="mujoco",
        branch_id=branch_id,
        output_path=str(output_path) if output_path else None,
        smoke_passed=smoke_passed,
        error=smoke_error,
        warnings=warnings,
        metrics={
            "exported_geom_count": exported_count,
            "skipped_hidden_count": skipped_hidden_count,
            "frame_id": final_frame.frame_id,
            "trace_id": trace.trace_id,
            "audit_score": report.score,
            "source_frame_convention": final_frame.frame_convention,
            "mujoco_frame_map": frame_map,
        },
    )
    return mjcf_text, status
