from __future__ import annotations

from collections.abc import Sequence
import re
from pathlib import Path
from typing import Any, TypeAlias
from xml.etree import ElementTree as ET

import numpy as np
from scipy.spatial.transform import Rotation

from backend.services.simulator_adapters.world_mesh_assets import resolve_declared_mesh_asset_path
from backend.services.world_layout_transfer_constants import (
    COLOR_TOLERANCE,
    POSITION_TOLERANCE_M,
    QUATERNION_TOLERANCE,
    SIZE_TOLERANCE_M,
)
from backend.services.world_layout_transfer_types import (
    LoadedPrimitive,
    SimPrimitive,
    WorldLayoutTransferError,
)
from backend.services.world_layout_transfer_report import (
    PrimitiveCheckReport,
    build_primitive_check_report,
)

MujocoXmlAttributes: TypeAlias = dict[str, str]


def _format_float(value: float) -> str:
    return f"{value:.12g}"


def _format_vec(values: Sequence[float]) -> str:
    return " ".join(_format_float(value) for value in values)


def _safe_xml_token(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip()).strip("_")
    return normalized or "static_world_layout"


def _mujoco_mesh_name(primitive: SimPrimitive) -> str:
    return _safe_xml_token(f"{primitive.sim_name}_mesh")


def _mujoco_geom_attrs(
    primitive: SimPrimitive,
    *,
    mesh_name: str | None = None,
) -> MujocoXmlAttributes:
    attrs: MujocoXmlAttributes = {
        "name": primitive.sim_name,
        "type": "mesh" if mesh_name is not None else primitive.sim_type,
        "pos": _format_vec(primitive.position_xyz),
        "quat": _format_vec(primitive.quat_wxyz),
        "rgba": _format_vec(primitive.rgba),
    }
    if mesh_name is not None:
        attrs["mesh"] = mesh_name
    elif primitive.sim_type == "box":
        attrs["size"] = _format_vec(component * 0.5 for component in primitive.size_xyz)
    elif primitive.sim_type == "sphere":
        attrs["size"] = _format_float(max(primitive.size_xyz) * 0.5)
    elif primitive.sim_type == "cylinder":
        attrs["size"] = _format_vec((primitive.size_xyz[0] * 0.5, primitive.size_xyz[2] * 0.5))
    else:
        raise WorldLayoutTransferError(f"Unsupported MuJoCo primitive type: {primitive.sim_type}")
    if not primitive.collision:
        attrs["contype"] = "0"
        attrs["conaffinity"] = "0"
    if primitive.friction is not None:
        attrs["friction"] = _format_vec((primitive.friction, 0.005, 0.0001))
    return attrs


def _mujoco_asset_root(root: ET.Element) -> ET.Element:
    asset = root.find("asset")
    if asset is None:
        asset = ET.Element("asset")
        compiler = root.find("compiler")
        insert_index = list(root).index(compiler) + 1 if compiler is not None else 0
        root.insert(insert_index, asset)
    return asset


def _append_mujoco_mesh_asset(
    root: ET.Element,
    primitive: SimPrimitive,
    asset_path: Path,
) -> str:
    mesh_name = _mujoco_mesh_name(primitive)
    asset = _mujoco_asset_root(root)
    attrs: MujocoXmlAttributes = {
        "name": mesh_name,
        "file": str(asset_path),
    }
    if primitive.asset_scale_xyz is not None:
        attrs["scale"] = _format_vec(primitive.asset_scale_xyz)
    existing = asset.find(f"mesh[@name='{mesh_name}']")
    if existing is None:
        ET.SubElement(asset, "mesh", attrs)
    else:
        existing.attrib.update(attrs)
    return mesh_name


def _mujoco_mesh_name_for_primitive(
    root: ET.Element,
    primitive: SimPrimitive,
    asset_roots: Sequence[Path],
) -> str | None:
    asset_path = resolve_declared_mesh_asset_path(
        primitive,
        asset_roots,
        simulator_label="MuJoCo",
    )
    if asset_path is None:
        return None
    return _append_mujoco_mesh_asset(root, primitive, asset_path)


def _add_mujoco_floor(worldbody: ET.Element) -> None:
    ET.SubElement(
        worldbody,
        "geom",
        {
            "name": "wl_reference_floor",
            "type": "plane",
            "pos": "0 0 0",
            "size": "4 4 0.01",
            "rgba": "0.16 0.16 0.16 0.35",
        },
    )


def _set_mujoco_offscreen_size(root: ET.Element, offscreen_size: tuple[int, int]) -> None:
    visual = root.find("visual")
    if visual is None:
        visual = ET.SubElement(root, "visual")
    global_visual = visual.find("global")
    if global_visual is None:
        global_visual = ET.SubElement(visual, "global")
    global_visual.set("offwidth", str(max(int(offscreen_size[0]), 1)))
    global_visual.set("offheight", str(max(int(offscreen_size[1]), 1)))


def append_primitives_to_mujoco_mjcf(
    mjcf_text: str,
    primitives: Sequence[SimPrimitive],
    *,
    include_floor: bool = False,
    offscreen_size: tuple[int, int] | None = None,
    asset_roots: Sequence[Path] = (),
) -> str:
    try:
        root = ET.fromstring(mjcf_text)
    except ET.ParseError as exc:
        raise WorldLayoutTransferError(f"Invalid MuJoCo MJCF XML: {exc}") from exc
    if root.tag != "mujoco":
        raise WorldLayoutTransferError("MuJoCo MJCF root element must be <mujoco>")
    if offscreen_size is not None:
        _set_mujoco_offscreen_size(root, offscreen_size)
    worldbody = root.find("worldbody")
    if worldbody is None:
        worldbody = ET.SubElement(root, "worldbody")
    if include_floor:
        _add_mujoco_floor(worldbody)
    for primitive in primitives:
        mesh_name = _mujoco_mesh_name_for_primitive(root, primitive, asset_roots)
        ET.SubElement(worldbody, "geom", _mujoco_geom_attrs(primitive, mesh_name=mesh_name))
    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="unicode")


def export_primitives_to_mujoco_mjcf(
    primitives: Sequence[SimPrimitive],
    *,
    model_name: str = "static_world_layout",
    include_floor: bool = False,
    offscreen_size: tuple[int, int] | None = None,
    asset_roots: Sequence[Path] = (),
) -> str:
    root = ET.Element("mujoco", {"model": _safe_xml_token(model_name)})
    ET.SubElement(root, "compiler", {"angle": "radian"})
    ET.SubElement(root, "option", {"timestep": "0.01", "gravity": "0 0 -9.81"})
    if offscreen_size is not None:
        visual = ET.SubElement(root, "visual")
        ET.SubElement(
            visual,
            "global",
            {
                "offwidth": str(max(int(offscreen_size[0]), 1)),
                "offheight": str(max(int(offscreen_size[1]), 1)),
            },
        )
    worldbody = ET.SubElement(root, "worldbody")
    if include_floor:
        _add_mujoco_floor(worldbody)
    for primitive in primitives:
        mesh_name = _mujoco_mesh_name_for_primitive(root, primitive, asset_roots)
        ET.SubElement(worldbody, "geom", _mujoco_geom_attrs(primitive, mesh_name=mesh_name))
    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="unicode")


def check_mujoco_transfer(
    primitives: Sequence[SimPrimitive],
    *,
    mjcf_text: str | None = None,
    position_tolerance_m: float = POSITION_TOLERANCE_M,
    size_tolerance_m: float = SIZE_TOLERANCE_M,
    quaternion_tolerance: float = QUATERNION_TOLERANCE,
    color_tolerance: float = COLOR_TOLERANCE,
) -> PrimitiveCheckReport:
    import mujoco

    compiled_mjcf = mjcf_text or export_primitives_to_mujoco_mjcf(primitives)
    model = mujoco.MjModel.from_xml_string(compiled_mjcf)
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    loaded: list[LoadedPrimitive] = []
    for primitive in primitives:
        geom_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM, primitive.sim_name)
        if geom_id < 0:
            continue
        loaded.append(
            LoadedPrimitive(
                source_id=primitive.source_id,
                sim_name=primitive.sim_name,
                sim_type=_mujoco_geom_type_name(mujoco, model, geom_id),
                position_xyz=tuple(float(value) for value in data.geom_xpos[geom_id]),
                quat_wxyz=_matrix9_to_quat_wxyz(data.geom_xmat[geom_id]),
                size_xyz=_mujoco_geom_full_size(mujoco, model, geom_id),
                collision=bool(
                    model.geom_contype[geom_id] != 0
                    or model.geom_conaffinity[geom_id] != 0
                ),
                rgba=tuple(float(value) for value in model.geom_rgba[geom_id]),
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
            "backend": "mujoco",
            "mujoco_version": getattr(mujoco, "__version__", "unknown"),
            "compiled_geom_count": int(model.ngeom),
        }
    )
    return report


def _mujoco_geom_type_name(mujoco: Any, model: Any, geom_id: int) -> str | None:
    geom_type = int(model.geom_type[geom_id])
    if geom_type == int(mujoco.mjtGeom.mjGEOM_BOX):
        return "box"
    if geom_type == int(mujoco.mjtGeom.mjGEOM_SPHERE):
        return "sphere"
    if geom_type == int(mujoco.mjtGeom.mjGEOM_CYLINDER):
        return "cylinder"
    return None


def _mujoco_geom_full_size(
    mujoco: Any,
    model: Any,
    geom_id: int,
) -> tuple[float, float, float] | None:
    geom_type = int(model.geom_type[geom_id])
    size = model.geom_size[geom_id]
    if geom_type == int(mujoco.mjtGeom.mjGEOM_BOX):
        return (float(size[0] * 2.0), float(size[1] * 2.0), float(size[2] * 2.0))
    if geom_type == int(mujoco.mjtGeom.mjGEOM_SPHERE):
        diameter = float(size[0] * 2.0)
        return (diameter, diameter, diameter)
    if geom_type == int(mujoco.mjtGeom.mjGEOM_CYLINDER):
        diameter = float(size[0] * 2.0)
        return (diameter, diameter, float(size[1] * 2.0))
    return None


def _matrix9_to_quat_wxyz(matrix9: Sequence[float]) -> tuple[float, float, float, float]:
    matrix = np.array(matrix9, dtype=float).reshape(3, 3)
    quat_xyzw = Rotation.from_matrix(matrix).as_quat()
    return (
        float(quat_xyzw[3]),
        float(quat_xyzw[0]),
        float(quat_xyzw[1]),
        float(quat_xyzw[2]),
    )
