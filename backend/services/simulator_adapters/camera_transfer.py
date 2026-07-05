from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

import numpy as np
import yourdfpy  # type: ignore
from scipy.spatial.transform import Rotation

from backend.models.world_scene_package import WorldScenePackageManifest, WorldScenePayload
from backend.services.simulator_adapters.camera_conventions import (
    OPENGL_CAMERA_FORWARD_LOCAL_XYZ,
    OPENGL_CAMERA_UP_LOCAL_XYZ,
    WORLD_CAMERA_FORWARD_LOCAL_XYZ,
    WORLD_CAMERA_TO_OPENGL_CAMERA_MATRIX,
    WORLD_CAMERA_UP_LOCAL_XYZ,
    world_camera_to_opengl_camera_rotation,
)
from backend.services.simulator_adapters.camera_intrinsics import (
    PinholeCameraIntrinsics,
    pinhole_camera_intrinsics_from_record,
)
from backend.services.simulator_adapters.numeric import is_finite_number
from backend.services.world_layout_transfer_types import WorldLayoutTransferError


CAMERA_MARKER_RGBA = (1.0, 0.82, 0.12, 1.0)
CAMERA_MARKER_SIZE_XYZ = (0.05, 0.035, 0.025)

# Studio camera poses follow the same canonical camera frame as RoboVerse
# MetaSim: +X forward and +Z up. Simulator render cameras use the OpenGL camera
# frame: -Z forward and +Y up.
STUDIO_CAMERA_FORWARD_LOCAL_XYZ = WORLD_CAMERA_FORWARD_LOCAL_XYZ
STUDIO_CAMERA_UP_LOCAL_XYZ = WORLD_CAMERA_UP_LOCAL_XYZ
RENDER_CAMERA_FORWARD_LOCAL_XYZ = OPENGL_CAMERA_FORWARD_LOCAL_XYZ
RENDER_CAMERA_UP_LOCAL_XYZ = OPENGL_CAMERA_UP_LOCAL_XYZ
STUDIO_CAMERA_TO_RENDER_VIEW_MATRIX = WORLD_CAMERA_TO_OPENGL_CAMERA_MATRIX


@dataclass(frozen=True)
class Transform:
    position_xyz: tuple[float, float, float]
    rotation: Rotation

    @property
    def quat_wxyz(self) -> tuple[float, float, float, float]:
        return _quat_wxyz(self.rotation)

    @property
    def quat_xyzw(self) -> tuple[float, float, float, float]:
        quat_wxyz = self.quat_wxyz
        return (quat_wxyz[1], quat_wxyz[2], quat_wxyz[3], quat_wxyz[0])


@dataclass(frozen=True)
class SimCameraSpec:
    camera_id: str
    name: str
    sim_name: str
    parent_joint: str
    parent_link: str
    render_local_pose: Transform
    render_world_pose: Transform
    fov_deg: float
    width: int
    height: int
    intrinsics: PinholeCameraIntrinsics | None = None

    @property
    def position_xyz(self) -> tuple[float, float, float]:
        return self.render_world_pose.position_xyz

    @property
    def quat_wxyz(self) -> tuple[float, float, float, float]:
        return self.render_world_pose.quat_wxyz

    @property
    def quat_xyzw(self) -> tuple[float, float, float, float]:
        return self.render_world_pose.quat_xyzw

    @property
    def render_forward_xyz(self) -> tuple[float, float, float]:
        return _tuple3(self.render_world_pose.rotation.apply(RENDER_CAMERA_FORWARD_LOCAL_XYZ))

    @property
    def render_up_xyz(self) -> tuple[float, float, float]:
        return _tuple3(self.render_world_pose.rotation.apply(RENDER_CAMERA_UP_LOCAL_XYZ))

    @property
    def rotation(self) -> Rotation:
        return self.render_world_pose.rotation


def build_sim_camera_specs(
    world_package: WorldScenePackageManifest,
    *,
    robot_urdf_path: Path,
    strict: bool = True,
) -> tuple[tuple[SimCameraSpec, ...], tuple[str, ...]]:
    cameras = world_package.world_snapshot.cameras
    if not cameras:
        return (), ()

    try:
        robot = _load_robot_for_camera_transfer(robot_urdf_path)
        _apply_camera_transfer_joint_positions(
            robot,
            world_package.world_snapshot.joint_positions,
        )
    except Exception as exc:
        warnings = (f"Camera transfer could not load robot URDF: {exc}",)
        if strict:
            raise _camera_transfer_error(warnings)
        return (), warnings

    joint_child_link_by_name = {
        name: str(joint.child)
        for name, joint in robot.joint_map.items()
        if getattr(joint, "child", None)
    }
    link_names = set(robot.link_map.keys())
    link_transforms = _build_link_transforms(robot)
    camera_specs: list[SimCameraSpec] = []
    warnings: list[str] = []
    used_camera_ids: set[str] = set()
    used_sim_names: set[str] = set()

    for index, camera_record in enumerate(cameras):
        spec, warning = _build_camera_spec(
            camera_record=camera_record,
            index=index,
            link_names=link_names,
            link_transforms=link_transforms,
            joint_child_link_by_name=joint_child_link_by_name,
        )
        if warning:
            warnings.append(warning)
        if spec is not None:
            if spec.camera_id in used_camera_ids:
                warnings.append(
                    f"Camera '{spec.name}' id '{spec.camera_id}' duplicates another camera; "
                    "camera ids must be unique."
                )
                continue
            if spec.sim_name in used_sim_names:
                warnings.append(
                    f"Camera '{spec.name}' simulator name '{spec.sim_name}' duplicates another camera; "
                    "camera simulator names must be unique."
                )
                continue
            used_camera_ids.add(spec.camera_id)
            used_sim_names.add(spec.sim_name)
            camera_specs.append(spec)

    if strict and warnings:
        raise _camera_transfer_error(tuple(warnings))
    return tuple(camera_specs), tuple(warnings)


def _camera_transfer_error(warnings: tuple[str, ...]) -> WorldLayoutTransferError:
    return WorldLayoutTransferError(f"Camera transfer failed: {'; '.join(warnings)}")


def _build_camera_spec(
    *,
    camera_record: WorldScenePayload,
    index: int,
    link_names: set[str],
    link_transforms: Mapping[str, Transform],
    joint_child_link_by_name: Mapping[str, str],
) -> tuple[SimCameraSpec | None, str | None]:
    camera_identity, warning = _camera_identity(camera_record, index=index)
    if warning:
        return None, warning
    assert camera_identity is not None

    parent_link, warning = _resolve_camera_parent_link(
        camera_name=camera_identity.name,
        parent_joint=camera_identity.parent_joint,
        link_names=link_names,
        joint_child_link_by_name=joint_child_link_by_name,
    )
    if warning:
        return None, warning
    assert parent_link is not None

    base_transform = link_transforms.get(parent_link)
    if base_transform is None:
        return (
            None,
            f"Camera '{camera_identity.name}' parent link '{parent_link}' has no forward-kinematics transform; "
            "camera parent must have a forward-kinematics transform.",
        )

    render_local_transform, pose_warning = _read_render_camera_local_transform(
        camera_record,
        camera_identity.name,
    )
    if render_local_transform is None:
        return None, pose_warning
    intrinsics = pinhole_camera_intrinsics_from_record(camera_record.get("intrinsics"))
    if intrinsics is None:
        return None, f"Camera '{camera_identity.name}' has invalid pinhole intrinsics."
    render_world_transform = _compose_transform(base_transform, render_local_transform)
    return (
        SimCameraSpec(
            camera_id=camera_identity.camera_id,
            name=camera_identity.name,
            sim_name=_safe_sim_name(
                camera_identity.name or camera_identity.camera_id,
                default_name=f"camera_{index + 1}",
            ),
            parent_joint=camera_identity.parent_joint,
            parent_link=parent_link,
            render_local_pose=render_local_transform,
            render_world_pose=render_world_transform,
            fov_deg=intrinsics.vertical_fov_deg,
            width=intrinsics.width,
            height=intrinsics.height,
            intrinsics=intrinsics,
        ),
        None,
    )


@dataclass(frozen=True)
class _CameraIdentity:
    camera_id: str
    name: str
    parent_joint: str


def _camera_identity(
    camera_record: WorldScenePayload,
    *,
    index: int,
) -> tuple[_CameraIdentity | None, str | None]:
    name = _camera_name_or_id(camera_record)
    if not name:
        return None, f"Camera at index {index} has no id or name."
    parent_joint = _read_string(camera_record.get("parent_joint"))
    if not parent_joint:
        return None, f"Camera '{name}' has no parent_joint."
    return (
        _CameraIdentity(
            camera_id=_read_string(camera_record.get("id")) or name,
            name=name,
            parent_joint=parent_joint,
        ),
        None,
    )


def _camera_name_or_id(camera_record: WorldScenePayload) -> str:
    return _read_string(camera_record.get("name")) or _read_string(camera_record.get("id"))


def _resolve_camera_parent_link(
    *,
    camera_name: str,
    parent_joint: str,
    link_names: set[str],
    joint_child_link_by_name: Mapping[str, str],
) -> tuple[str | None, str | None]:
    parent_link = joint_child_link_by_name.get(parent_joint)
    if parent_link is None and parent_joint in link_names:
        parent_link = parent_joint
    if parent_link is not None:
        return parent_link, None
    return (
        None,
        f"Camera '{camera_name}' parent '{parent_joint}' was not found in robot links or joints; "
        "camera parent must resolve before simulator transfer.",
    )


def _load_robot_for_camera_transfer(robot_urdf_path: Path) -> yourdfpy.URDF:
    return yourdfpy.URDF.load(  # type: ignore[attr-defined]
        str(robot_urdf_path.resolve()),
        load_meshes=False,
        load_collision_meshes=False,
    )


def _apply_camera_transfer_joint_positions(
    robot: yourdfpy.URDF,
    joint_positions: Mapping[str, float],
) -> None:
    config = {
        name: _finite_joint_position(joint_positions.get(name, 0.0))
        for name in robot.actuated_joint_names
    }
    robot.update_cfg(config)


def _finite_joint_position(value: object) -> float:
    return float(value) if is_finite_number(value) else 0.0


def _build_link_transforms(robot: yourdfpy.URDF) -> dict[str, Transform]:
    transforms: dict[str, Transform] = {}
    for link_name in robot.link_map.keys():
        matrix = np.asarray(robot.get_transform(link_name), dtype=np.float64)
        if matrix.shape != (4, 4):
            continue
        transforms[link_name] = Transform(
            position_xyz=_tuple3(matrix[:3, 3]),
            rotation=Rotation.from_matrix(matrix[:3, :3]),
        )
    return transforms


def append_cameras_to_mujoco_mjcf(
    mjcf_text: str,
    cameras: Sequence[SimCameraSpec],
    *,
    include_markers: bool = False,
) -> str:
    if not cameras:
        return mjcf_text
    try:
        root = ET.fromstring(mjcf_text)
    except ET.ParseError as exc:
        raise ValueError(f"Invalid MuJoCo MJCF XML: {exc}") from exc
    if root.tag != "mujoco":
        raise ValueError("MuJoCo MJCF root element must be <mujoco>")

    worldbody = root.find("worldbody")
    if worldbody is None:
        worldbody = ET.SubElement(root, "worldbody")
    _ensure_mujoco_offscreen_framebuffer(root, cameras)
    for camera in cameras:
        parent, pose = _mujoco_camera_parent_and_pose(worldbody, camera)
        ET.SubElement(
            parent,
            "camera",
            _mujoco_camera_attrs(camera, pose),
        )
        if include_markers:
            ET.SubElement(
                parent,
                "site",
                {
                    "name": f"{camera.sim_name}_marker",
                    "type": "box",
                    "pos": _format_vector(pose.position_xyz),
                    "quat": _format_vector(pose.quat_wxyz),
                    "size": _format_vector(tuple(value * 0.5 for value in CAMERA_MARKER_SIZE_XYZ)),
                    "rgba": _format_vector(CAMERA_MARKER_RGBA),
                },
            )
    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="unicode")


def _mujoco_camera_attrs(camera: SimCameraSpec, pose: Transform) -> dict[str, str]:
    return {
        "name": camera.sim_name,
        "pos": _format_vector(pose.position_xyz),
        "quat": _format_vector(pose.quat_wxyz),
        "fovy": f"{camera.fov_deg:.12g}",
    }


def _ensure_mujoco_offscreen_framebuffer(
    root: ET.Element,
    cameras: Sequence[SimCameraSpec],
) -> None:
    width = max((camera.width for camera in cameras), default=0)
    height = max((camera.height for camera in cameras), default=0)
    if width <= 0 or height <= 0:
        return
    visual = root.find("visual")
    if visual is None:
        visual = ET.SubElement(root, "visual")
    global_element = visual.find("global")
    if global_element is None:
        global_element = ET.SubElement(visual, "global")
    _set_mujoco_dimension_min(global_element, "offwidth", width)
    _set_mujoco_dimension_min(global_element, "offheight", height)


def _set_mujoco_dimension_min(element: ET.Element, attr_name: str, minimum: int) -> None:
    try:
        current = int(element.get(attr_name) or "0")
    except ValueError:
        current = 0
    if current < minimum:
        element.set(attr_name, str(minimum))


def _mujoco_camera_parent_and_pose(
    worldbody: ET.Element,
    camera: SimCameraSpec,
) -> tuple[ET.Element, Transform]:
    parent_body = _find_mujoco_body(worldbody, camera.parent_link)
    if parent_body is not None:
        return parent_body, camera.render_local_pose
    return worldbody, camera.render_world_pose


def _find_mujoco_body(worldbody: ET.Element, body_name: str) -> ET.Element | None:
    for body in worldbody.iter("body"):
        if body.get("name") == body_name:
            return body
    return None


def _read_render_camera_local_transform(
    camera: WorldScenePayload,
    name: str,
) -> tuple[Transform | None, str | None]:
    pose = camera.get("pose")
    if isinstance(pose, dict):
        return _render_camera_local_transform_from_pose_parts(
            xyz_value=pose.get("xyz"),
            rpy_value=pose.get("rpy"),
            error_message=f"Camera '{name}' has invalid pose.xyz or pose.rpy.",
        )
    if isinstance(pose, list | tuple) and len(pose) >= 6:
        return _render_camera_local_transform_from_pose_parts(
            xyz_value=pose[:3],
            rpy_value=pose[3:6],
            error_message=f"Camera '{name}' has invalid pose values.",
        )
    return None, f"Camera '{name}' has no pose."


def _render_camera_local_transform_from_pose_parts(
    *,
    xyz_value: object,
    rpy_value: object,
    error_message: str,
) -> tuple[Transform | None, str | None]:
    xyz = _read_vector3(xyz_value)
    rpy = _read_vector3(rpy_value)
    if xyz is None or rpy is None:
        return None, error_message
    return _render_camera_transform_from_studio_xyz_rpy(xyz, rpy), None


def _transform_from_xyz_rpy(
    xyz: tuple[float, float, float],
    rpy: tuple[float, float, float],
) -> Transform:
    return Transform(
        position_xyz=xyz,
        rotation=Rotation.from_euler("xyz", rpy),
    )


def _render_camera_transform_from_studio_xyz_rpy(
    xyz: tuple[float, float, float],
    rpy: tuple[float, float, float],
) -> Transform:
    studio_camera_transform = _transform_from_xyz_rpy(xyz, rpy)
    return camera_render_transform_from_studio_transform(studio_camera_transform)


def camera_render_transform_from_studio_transform(studio_camera_transform: Transform) -> Transform:
    return Transform(
        position_xyz=studio_camera_transform.position_xyz,
        rotation=studio_camera_transform.rotation * studio_camera_to_render_view_rotation(),
    )


def studio_camera_to_render_view_rotation() -> Rotation:
    return world_camera_to_opengl_camera_rotation()


def _compose_transform(parent: Transform, child: Transform) -> Transform:
    return Transform(
        position_xyz=_tuple3(
            np.array(parent.position_xyz, dtype=float) + parent.rotation.apply(child.position_xyz)
        ),
        rotation=parent.rotation * child.rotation,
    )


def _read_vector3(value: object) -> tuple[float, float, float] | None:
    if isinstance(value, str):
        parts: Sequence[object] = value.split()
    elif isinstance(value, list | tuple):
        parts = value
    else:
        return None
    if len(parts) < 3:
        return None
    result: list[float] = []
    for item in parts[:3]:
        try:
            parsed = float(item)
        except (TypeError, ValueError):
            return None
        if not is_finite_number(parsed):
            return None
        result.append(parsed)
    return (result[0], result[1], result[2])


def _quat_wxyz(rotation: Rotation) -> tuple[float, float, float, float]:
    quat_xyzw = rotation.as_quat()
    return (
        float(quat_xyzw[3]),
        float(quat_xyzw[0]),
        float(quat_xyzw[1]),
        float(quat_xyzw[2]),
    )


def _tuple3(value: Sequence[float] | np.ndarray) -> tuple[float, float, float]:
    return (float(value[0]), float(value[1]), float(value[2]))


def _format_vector(values: Sequence[float]) -> str:
    return " ".join(f"{float(value):.12g}" for value in values)


def _read_string(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _safe_sim_name(value: str, *, default_name: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip()).strip("_")
    return normalized or default_name
