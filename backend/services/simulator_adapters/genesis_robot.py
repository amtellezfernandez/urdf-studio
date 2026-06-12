from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Sequence

from backend.services.simulator_adapters.camera_transfer import SimCameraSpec
from backend.services.simulator_adapters.numeric import is_finite_number
from backend.services.simulator_adapters.params import GENESIS_SCENE_PARAMS


def to_float_list(value: Any) -> list[float]:
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "numpy"):
        value = value.numpy()
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, int | float):
        return [float(value)]
    if not isinstance(value, list | tuple):
        return []
    flattened: list[float] = []
    for item in value:
        if isinstance(item, list | tuple):
            flattened.extend(to_float_list(item))
        elif is_finite_number(item):
            flattened.append(float(item))
    return flattened


def joint_dof_indices_by_name(robot_entity: Any) -> dict[str, int]:
    indices: dict[str, int] = {}
    for joint in getattr(robot_entity, "joints", []):
        name = getattr(joint, "name", "")
        dof_indices = getattr(joint, "dofs_idx_local", None)
        if not isinstance(name, str) or not name:
            continue
        local_indices = to_float_list(dof_indices)
        if len(local_indices) != 1:
            continue
        indices[name] = int(local_indices[0])
    return indices


def configure_robot_position_controller(
    robot_entity: Any,
    joint_dof_indices: dict[str, int],
) -> int:
    if not joint_dof_indices:
        return 0
    dof_indices: list[int] = []
    kp_values: list[float] = []
    kv_values: list[float] = []
    force_lower: list[float] = []
    force_upper: list[float] = []
    for joint_name, dof_index in joint_dof_indices.items():
        dof_indices.append(dof_index)
        normalized_joint_name = joint_name.lower()
        is_gripper = any(
            term in normalized_joint_name
            for term in GENESIS_SCENE_PARAMS.controller_policy.gripper_name_terms
        )
        controller = (
            GENESIS_SCENE_PARAMS.gripper_controller
            if is_gripper
            else GENESIS_SCENE_PARAMS.arm_controller
        )
        kp_values.append(controller.kp)
        kv_values.append(controller.kv)
        force_limit = controller.force_limit
        force_lower.append(-force_limit)
        force_upper.append(force_limit)

    if hasattr(robot_entity, "set_dofs_kp"):
        robot_entity.set_dofs_kp(kp_values, dofs_idx_local=dof_indices)
    if hasattr(robot_entity, "set_dofs_kv"):
        robot_entity.set_dofs_kv(kv_values, dofs_idx_local=dof_indices)
    if hasattr(robot_entity, "set_dofs_force_range"):
        robot_entity.set_dofs_force_range(force_lower, force_upper, dofs_idx_local=dof_indices)
    return len(dof_indices)


def apply_joint_values(
    robot_entity: Any,
    joint_dof_indices: dict[str, int],
    joint_values: dict[str, Any],
) -> int:
    dof_indices: list[int] = []
    positions: list[float] = []
    for joint_name, value in joint_values.items():
        if joint_name not in joint_dof_indices or not is_finite_number(value):
            continue
        dof_indices.append(joint_dof_indices[joint_name])
        positions.append(float(value))
    if not dof_indices:
        return 0
    if hasattr(robot_entity, "set_dofs_position"):
        try:
            robot_entity.set_dofs_position(
                positions,
                dofs_idx_local=dof_indices,
                zero_velocity=True,
            )
        except TypeError:
            robot_entity.set_dofs_position(positions, dofs_idx_local=dof_indices)
    if hasattr(robot_entity, "control_dofs_position"):
        robot_entity.control_dofs_position(positions, dofs_idx_local=dof_indices)
    return len(dof_indices)


_ATTACHMENT_LINK_NAME_RE = re.compile(
    r"(camera|cam|sensor|tool|ee|eef|tcp|end[_-]?effector|gripper[_-]?frame)",
    re.IGNORECASE,
)


def links_to_keep_for_camera_attachment(cameras: Sequence[SimCameraSpec]) -> tuple[str, ...]:
    return tuple(sorted({camera.parent_link for camera in cameras if camera.parent_link}))


def links_to_keep_for_workspace_attachments(
    cameras: Sequence[SimCameraSpec],
    *,
    robot_urdf_path: Path,
) -> tuple[str, ...]:
    links = set(links_to_keep_for_camera_attachment(cameras))
    links.update(attachment_links_from_urdf(robot_urdf_path))
    return tuple(sorted(links))


def attachment_links_from_urdf(robot_urdf_path: Path) -> tuple[str, ...]:
    try:
        root = ET.parse(robot_urdf_path).getroot()
    except (OSError, ET.ParseError) as exc:
        print(
            "[genesis-workspace] warning: "
            f"could not inspect attachment links in URDF '{robot_urdf_path}': {exc}",
            flush=True,
        )
        return ()
    parent_links: set[str] = set()
    child_links: set[str] = set()
    for joint in root.findall("joint"):
        parent = joint.find("parent")
        child = joint.find("child")
        if parent is not None and parent.get("link"):
            parent_links.add(parent.get("link", ""))
        if child is not None and child.get("link"):
            child_links.add(child.get("link", ""))
    leaf_links = child_links - parent_links
    return tuple(
        sorted(
            link_name
            for link_name in leaf_links
            if link_name and _ATTACHMENT_LINK_NAME_RE.search(link_name)
        )
    )


def robot_urdf_morph_kwargs(
    robot_urdf_path: Path,
    *,
    links_to_keep: Sequence[str] = (),
) -> dict[str, Any]:
    return {
        "file": str(robot_urdf_path.resolve()),
        "pos": (0.0, 0.0, GENESIS_SCENE_PARAMS.robot_base_z_offset_m),
        "fixed": GENESIS_SCENE_PARAMS.fixed_base,
        "merge_fixed_links": GENESIS_SCENE_PARAMS.merge_fixed_links,
        "links_to_keep": tuple(links_to_keep),
        "prioritize_urdf_material": GENESIS_SCENE_PARAMS.prioritize_urdf_material,
        "collision": GENESIS_SCENE_PARAMS.enable_collision,
        "visualization": GENESIS_SCENE_PARAMS.visualization,
    }
