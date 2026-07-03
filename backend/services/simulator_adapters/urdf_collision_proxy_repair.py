from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
import re
import xml.etree.ElementTree as ET


@dataclass(frozen=True)
class BoxCollisionProxy:
    link_name: str
    collision_name: str
    xyz: str
    rpy: str
    size: str


@dataclass(frozen=True)
class UrdfCollisionProxyRepairProfile:
    repair_id: str
    cache_dir: Path
    robot_name_pattern: str
    mesh_filename_pattern: str
    required_link_names: tuple[str, ...]
    box_collisions: tuple[BoxCollisionProxy, ...]
    clear_existing_collisions_on_touched_links: bool = True
    make_relative_mesh_paths_absolute: bool = True


@dataclass(frozen=True)
class UrdfCollisionProxyRepairResult:
    path: Path
    applied: bool
    repair_id: str | None = None


def _find_link(root: ET.Element, name: str) -> ET.Element | None:
    for link in root.findall("link"):
        if link.get("name") == name:
            return link
    return None


def _has_named_collision(link: ET.Element, name: str) -> bool:
    return any(collision.get("name") == name for collision in link.findall("collision"))


def _remove_collision_elements(link: ET.Element) -> None:
    for collision in list(link.findall("collision")):
        link.remove(collision)


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


def _profile_matches(root: ET.Element, profile: UrdfCollisionProxyRepairProfile) -> bool:
    if any(_find_link(root, link_name) is None for link_name in profile.required_link_names):
        return False

    robot_name_pattern = re.compile(profile.robot_name_pattern, re.IGNORECASE)
    mesh_filename_pattern = re.compile(profile.mesh_filename_pattern, re.IGNORECASE)
    robot_name = root.get("name", "")
    if robot_name_pattern.search(robot_name):
        return True
    return any(
        mesh_filename_pattern.search(Path(filename).name)
        for mesh in root.iter("mesh")
        if (filename := mesh.get("filename"))
    )


def materialize_urdf_collision_proxy_repair_report(
    urdf_path: Path,
    *,
    profile: UrdfCollisionProxyRepairProfile,
) -> UrdfCollisionProxyRepairResult:
    source_path = urdf_path.resolve()
    source_xml = source_path.read_bytes()
    root = ET.fromstring(source_xml)
    if not _profile_matches(root, profile):
        return UrdfCollisionProxyRepairResult(path=source_path, applied=False)

    digest = hashlib.sha256(
        profile.repair_id.encode("utf-8") + source_xml
    ).hexdigest()[:16]
    profile.cache_dir.mkdir(parents=True, exist_ok=True)
    output_path = profile.cache_dir / f"{source_path.stem}.genesis-{digest}.urdf"
    if output_path.exists():
        return UrdfCollisionProxyRepairResult(
            path=output_path,
            applied=True,
            repair_id=profile.repair_id,
        )

    if profile.make_relative_mesh_paths_absolute:
        _make_mesh_paths_absolute(root, urdf_path=source_path)

    if profile.clear_existing_collisions_on_touched_links:
        touched_link_names = {collision.link_name for collision in profile.box_collisions}
        for link_name in touched_link_names:
            link = _find_link(root, link_name)
            if link is not None:
                _remove_collision_elements(link)

    for collision in profile.box_collisions:
        link = _find_link(root, collision.link_name)
        if link is None or _has_named_collision(link, collision.collision_name):
            continue
        _append_box_collision(
            link,
            name=collision.collision_name,
            xyz=collision.xyz,
            rpy=collision.rpy,
            size=collision.size,
        )

    ET.indent(root, space="  ")
    output_path.write_text(
        ET.tostring(root, encoding="unicode"),
        encoding="utf-8",
    )
    return UrdfCollisionProxyRepairResult(
        path=output_path,
        applied=True,
        repair_id=profile.repair_id,
    )
