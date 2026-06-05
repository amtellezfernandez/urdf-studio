from __future__ import annotations

import re
from pathlib import Path
from xml.etree import ElementTree as ET

from backend.models.physical_state import PhysicalEntity, PhysicalRolloutTrace, SimulatorExportState
from backend.services.executability_audit import audit_physical_rollout_trace


INVALID_MJCF_NAME_PATTERN = re.compile(r"[^A-Za-z0-9_.-]")


def _safe_mjcf_name(value: str) -> str:
    normalized = INVALID_MJCF_NAME_PATTERN.sub("_", value.strip())
    return normalized or "entity"


def _format_float_vector(values: list[float] | tuple[float, ...]) -> str:
    return " ".join(f"{float(value):.12g}" for value in values)


def _geom_size(entity: PhysicalEntity) -> tuple[str, list[float]] | None:
    if entity.size_xyz is None:
        return None
    if entity.geometry_type == "box":
        return "box", [component / 2.0 for component in entity.size_xyz]
    if entity.geometry_type == "sphere":
        return "sphere", [max(entity.size_xyz) / 2.0]
    if entity.geometry_type == "cylinder":
        radius = max(entity.size_xyz[0], entity.size_xyz[1]) / 2.0
        half_height = entity.size_xyz[2] / 2.0
        return "cylinder", [radius, half_height]
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
    root = ET.Element("mujoco", {"model": _safe_mjcf_name(final_frame.frame_id)})
    worldbody = ET.SubElement(root, "worldbody")
    exported_count = 0
    for entity in final_frame.entities:
        geom = _geom_size(entity)
        if geom is None:
            continue
        geom_type, size = geom
        attrs = {
            "name": _safe_mjcf_name(entity.entity_id),
            "type": geom_type,
            "pos": _format_float_vector(entity.position_xyz),
            "quat": _format_float_vector(entity.quat_wxyz),
            "size": _format_float_vector(size),
        }
        if entity.metadata.get("collision", True) is False:
            attrs["contype"] = "0"
            attrs["conaffinity"] = "0"
        ET.SubElement(worldbody, "geom", attrs)
        exported_count += 1

    mjcf_text = ET.tostring(root, encoding="unicode")
    warnings: list[str] = []
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
            "frame_id": final_frame.frame_id,
            "trace_id": trace.trace_id,
            "audit_score": report.score,
        },
    )
    return mjcf_text, status
