from __future__ import annotations

import xml.etree.ElementTree as ET

from backend.models.simulator_runtime import validate_simulator_relative_path

ROOT_RELATIVE_URDF_MESH_PREFIXES = (
    "assets/",
    "mesh/",
    "meshes/",
    "model/",
    "models/",
)


def normalize_resolved_urdf_asset_path(value: str | None) -> str:
    normalized = validate_simulator_relative_path(value or "robot.urdf", "asset path")
    lowered = normalized.lower()
    if lowered.endswith(".urdf.xacro"):
        return f"{normalized[:-len('.urdf.xacro')]}.urdf"
    if lowered.endswith(".xacro"):
        return f"{normalized[:-len('.xacro')]}.urdf"
    return normalized


def normalize_root_relative_urdf_mesh_filenames(urdf_xml: str) -> str:
    try:
        root = ET.fromstring(urdf_xml)
    except ET.ParseError:
        return urdf_xml

    changed = False
    for mesh in root.findall(".//mesh"):
        filename = mesh.get("filename")
        if not filename:
            continue
        normalized_filename = filename.strip().replace("\\", "/")
        if not normalized_filename.startswith("/"):
            continue
        portable_filename = normalized_filename.lstrip("/")
        if not is_portable_root_relative_mesh_path(portable_filename):
            continue
        mesh.set("filename", portable_filename)
        changed = True

    if not changed:
        return urdf_xml
    return ET.tostring(root, encoding="unicode")


def is_portable_root_relative_mesh_path(value: str) -> bool:
    if not value:
        return False
    if value.startswith(ROOT_RELATIVE_URDF_MESH_PREFIXES):
        return True
    return "/" not in value
