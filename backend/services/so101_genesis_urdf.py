from __future__ import annotations

import hashlib
import xml.etree.ElementTree as ET
from pathlib import Path

from backend.core.paths import BASE_DIR

GENESIS_SO101_URDF_CACHE_DIR = BASE_DIR / ".cache" / "genesis-urdf"
GENESIS_SO101_GRIPPER_COLLISION_VERSION = "so101-genesis-gripper-pads-v2"

SO101_FIXED_GRIPPER_PAD_NAME = "fixed_gripper_pad_collision"
SO101_MOVING_GRIPPER_PAD_NAME = "moving_gripper_pad_collision"

_SO101_GRIPPER_PAD_COLLISIONS = (
    (
        "gripper_link",
        SO101_FIXED_GRIPPER_PAD_NAME,
        "-0.0026 -0.0020 -0.0770",
        "0 0 0",
        "0.070 0.056 0.060",
    ),
    (
        "moving_jaw_so101_v1_link",
        SO101_MOVING_GRIPPER_PAD_NAME,
        "-0.0012 -0.0360 0.0189",
        "0 0 0",
        "0.030 0.095 0.052",
    ),
)


def _find_link(root: ET.Element, name: str) -> ET.Element | None:
    for link in root.findall("link"):
        if link.get("name") == name:
            return link
    return None


def _has_named_collision(link: ET.Element, name: str) -> bool:
    return any(collision.get("name") == name for collision in link.findall("collision"))


def _append_box_collision(
    link: ET.Element,
    *,
    name: str,
    xyz: str,
    rpy: str,
    size: str,
) -> None:
    collision = ET.SubElement(link, "collision", {"name": name})
    ET.SubElement(collision, "origin", {"xyz": xyz, "rpy": rpy})
    geometry = ET.SubElement(collision, "geometry")
    ET.SubElement(geometry, "box", {"size": size})


def _make_mesh_paths_absolute(root: ET.Element, *, urdf_path: Path) -> None:
    urdf_dir = urdf_path.parent
    for mesh in root.iter("mesh"):
        filename = mesh.get("filename")
        if not filename or filename.startswith(("package://", "http://", "https://")):
            continue
        path = Path(filename)
        if path.is_absolute():
            continue
        mesh.set("filename", str((urdf_dir / path).resolve()))


def _is_so101_gripper_urdf(root: ET.Element) -> bool:
    return all(
        _find_link(root, link_name) is not None
        for link_name, *_rest in _SO101_GRIPPER_PAD_COLLISIONS
    )


def materialize_so101_genesis_urdf(
    urdf_path: Path,
    *,
    output_dir: Path = GENESIS_SO101_URDF_CACHE_DIR,
) -> Path:
    source_path = urdf_path.resolve()
    source_xml = source_path.read_bytes()
    root = ET.fromstring(source_xml)
    if not _is_so101_gripper_urdf(root):
        return source_path

    digest = hashlib.sha256(
        GENESIS_SO101_GRIPPER_COLLISION_VERSION.encode("utf-8") + source_xml
    ).hexdigest()[:16]
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{source_path.stem}.genesis-{digest}.urdf"
    if output_path.exists():
        return output_path

    _make_mesh_paths_absolute(root, urdf_path=source_path)
    for link_name, collision_name, xyz, rpy, size in _SO101_GRIPPER_PAD_COLLISIONS:
        link = _find_link(root, link_name)
        if link is None or _has_named_collision(link, collision_name):
            continue
        _append_box_collision(
            link,
            name=collision_name,
            xyz=xyz,
            rpy=rpy,
            size=size,
        )

    ET.indent(root, space="  ")
    output_path.write_text(
        ET.tostring(root, encoding="unicode"),
        encoding="utf-8",
    )
    return output_path
