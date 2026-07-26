from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, TypedDict

from backend.services.simulator_adapters.camera_transfer import SimCameraSpec
from backend.services.simulator_adapters.numeric import is_finite_number
from backend.services.simulator_adapters.params import (
    GENESIS_SCENE_PARAMS,
    GenesisControllerGroupParams,
)


class GenesisRobotUrdfMorphKwargs(TypedDict):
    file: str
    pos: tuple[float, float, float]
    fixed: bool
    merge_fixed_links: bool
    links_to_keep: tuple[str, ...]
    prioritize_urdf_material: bool
    collision: bool
    visualization: bool


def _flatten_finite_floats(value: object) -> list[float]:
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "numpy"):
        value = value.numpy()
    if hasattr(value, "tolist"):
        value = value.tolist()
    if is_finite_number(value):
        return [float(value)]
    if not isinstance(value, list | tuple):
        return []
    flattened: list[float] = []
    for component in value:
        if isinstance(component, list | tuple):
            flattened.extend(_flatten_finite_floats(component))
        elif is_finite_number(component):
            flattened.append(float(component))
    return flattened


def _joint_dof_index(joint: Any) -> int | None:
    local_indices = _flatten_finite_floats(getattr(joint, "dofs_idx_local", None))
    if len(local_indices) != 1:
        return None
    dof_index = local_indices[0]
    if not dof_index.is_integer():
        return None
    return int(dof_index)


def joint_dof_indices_by_name(robot_entity: Any) -> dict[str, int]:
    indices: dict[str, int] = {}
    for joint in getattr(robot_entity, "joints", []):
        name = getattr(joint, "name", "")
        if not isinstance(name, str) or not name:
            continue
        dof_index = _joint_dof_index(joint)
        if dof_index is None:
            continue
        indices[name] = dof_index
    return indices


def controller_group_for_joint(joint_name: str) -> GenesisControllerGroupParams:
    normalized_joint_name = joint_name.lower()
    is_gripper = any(
        term in normalized_joint_name
        for term in GENESIS_SCENE_PARAMS.controller_policy.gripper_name_terms
    )
    return (
        GENESIS_SCENE_PARAMS.gripper_controller
        if is_gripper
        else GENESIS_SCENE_PARAMS.arm_controller
    )


def joint_controller_gains(
    joint_dof_indices: dict[str, int],
) -> dict[str, dict[str, float]]:
    """Per-joint kp/kv the position controller was configured with.

    Mirrors the grouping ``configure_robot_position_controller`` applies, so
    callers (e.g. a cross-sim dynamics-parity check) see the gains actually
    in effect without re-deriving the gripper/arm split themselves.
    """
    return {
        joint_name: {
            "kp": controller_group_for_joint(joint_name).kp,
            "kv": controller_group_for_joint(joint_name).kv,
        }
        for joint_name in joint_dof_indices
    }


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
        controller = controller_group_for_joint(joint_name)
        kp_values.append(controller.kp)
        kv_values.append(controller.kv)
        force_limit = controller.force_limit
        force_lower.append(-force_limit)
        force_upper.append(force_limit)

    if hasattr(robot_entity, "set_dofs_kp"):
        _call_dof_setter(robot_entity.set_dofs_kp, (kp_values,), dof_indices=dof_indices)
    if hasattr(robot_entity, "set_dofs_kv"):
        _call_dof_setter(robot_entity.set_dofs_kv, (kv_values,), dof_indices=dof_indices)
    if hasattr(robot_entity, "set_dofs_force_range"):
        _call_dof_setter(
            robot_entity.set_dofs_force_range,
            (force_lower, force_upper),
            dof_indices=dof_indices,
        )
    return len(dof_indices)


def apply_joint_values(
    robot_entity: Any,
    joint_dof_indices: dict[str, int],
    joint_values: Mapping[str, object],
) -> int:
    dof_indices, positions = _joint_position_targets(
        joint_dof_indices,
        joint_values,
    )
    if not dof_indices:
        return 0
    _apply_joint_position_targets(
        robot_entity,
        dof_indices=dof_indices,
        positions=positions,
    )
    return len(dof_indices)


def _joint_position_targets(
    joint_dof_indices: dict[str, int],
    joint_values: Mapping[str, object],
) -> tuple[list[int], list[float]]:
    dof_indices: list[int] = []
    positions: list[float] = []
    for joint_name, value in joint_values.items():
        dof_index = joint_dof_indices.get(joint_name)
        if dof_index is None or not is_finite_number(value):
            continue
        dof_indices.append(dof_index)
        positions.append(float(value))
    return dof_indices, positions


def _apply_joint_position_targets(
    robot_entity: Any,
    *,
    dof_indices: list[int],
    positions: list[float],
) -> None:
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


def _call_dof_setter(
    setter: Any,
    args: tuple[object, ...],
    *,
    dof_indices: list[int],
) -> None:
    try:
        setter(*args, dofs_idx_local=dof_indices)
    except TypeError:
        setter(*args, dof_indices)


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
    return _merged_attachment_links(
        links_to_keep_for_camera_attachment(cameras),
        attachment_links_from_urdf(robot_urdf_path),
    )


def _merged_attachment_links(
    camera_links: Sequence[str],
    urdf_attachment_links: Sequence[str],
) -> tuple[str, ...]:
    links = set(camera_links)
    links.update(urdf_attachment_links)
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
) -> GenesisRobotUrdfMorphKwargs:
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
