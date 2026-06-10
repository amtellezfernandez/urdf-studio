from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np
import yourdfpy  # type: ignore
from scipy.spatial.transform import Rotation

from backend.models.world_scene_package import WorldScenePackageManifest
from backend.services.simulator_adapters.numeric import is_finite_number


CAMERA_MARKER_RGBA = (1.0, 0.82, 0.12, 1.0)
CAMERA_MARKER_SIZE_XYZ = (0.05, 0.035, 0.025)
DEFAULT_CAMERA_FOV_DEG = 70.0
DEFAULT_CAMERA_WIDTH = 640
DEFAULT_CAMERA_HEIGHT = 480
CAMERA_FORWARD_LOCAL_XYZ = (0.0, 0.0, -1.0)
CAMERA_UP_LOCAL_XYZ = (0.0, 1.0, 0.0)


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
    local_pose: Transform
    world_pose: Transform
    fov_deg: float
    width: int
    height: int

    @property
    def position_xyz(self) -> tuple[float, float, float]:
        return self.world_pose.position_xyz

    @property
    def quat_wxyz(self) -> tuple[float, float, float, float]:
        return self.world_pose.quat_wxyz

    @property
    def quat_xyzw(self) -> tuple[float, float, float, float]:
        return self.world_pose.quat_xyzw

    @property
    def forward_xyz(self) -> tuple[float, float, float]:
        return _tuple3(self.world_pose.rotation.apply(CAMERA_FORWARD_LOCAL_XYZ))

    @property
    def up_xyz(self) -> tuple[float, float, float]:
        return _tuple3(self.world_pose.rotation.apply(CAMERA_UP_LOCAL_XYZ))

    @property
    def rotation(self) -> Rotation:
        return self.world_pose.rotation


def build_sim_camera_specs(
    world_package: WorldScenePackageManifest,
    *,
    robot_urdf_path: Path,
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
        return (), (f"Camera transfer could not load robot URDF: {exc}",)

    joint_child_link_by_name = {
        name: str(joint.child)
        for name, joint in robot.joint_map.items()
        if getattr(joint, "child", None)
    }
    link_names = set(robot.link_map.keys())
    link_transforms = _build_link_transforms(robot)
    camera_specs: list[SimCameraSpec] = []
    warnings: list[str] = []

    for index, camera in enumerate(cameras):
        camera_record = camera if isinstance(camera, dict) else {}
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
            camera_specs.append(spec)

    return tuple(camera_specs), tuple(warnings)


def _build_camera_spec(
    *,
    camera_record: dict[str, Any],
    index: int,
    link_names: set[str],
    link_transforms: Mapping[str, Transform],
    joint_child_link_by_name: Mapping[str, str],
) -> tuple[SimCameraSpec | None, str | None]:
    name = _read_string(camera_record.get("name")) or f"camera_{index + 1}"
    camera_id = _read_string(camera_record.get("id")) or name
    parent_joint = _read_string(camera_record.get("parent_joint"))
    if not parent_joint:
        return None, f"Camera '{name}' has no parent_joint; skipping simulator camera."

    parent_link = joint_child_link_by_name.get(parent_joint)
    if parent_link is None and parent_joint in link_names:
        parent_link = parent_joint
    if parent_link is None:
        return (
            None,
            f"Camera '{name}' parent '{parent_joint}' was not found in robot links or joints; "
            "skipping simulator camera.",
        )

    base_transform = link_transforms.get(parent_link)
    if base_transform is None:
        return (
            None,
            f"Camera '{name}' parent link '{parent_link}' has no forward-kinematics transform; "
            "skipping simulator camera.",
        )

    local_transform = _read_camera_local_transform(camera_record)
    world_transform = _compose_transform(base_transform, local_transform)
    return (
        SimCameraSpec(
            camera_id=camera_id,
            name=name,
            sim_name=_safe_sim_name(name or camera_id, fallback=f"camera_{index + 1}"),
            parent_joint=parent_joint,
            parent_link=parent_link,
            local_pose=local_transform,
            world_pose=world_transform,
            fov_deg=_read_camera_fov_deg(camera_record),
            width=_read_camera_dimension(camera_record, "width", DEFAULT_CAMERA_WIDTH),
            height=_read_camera_dimension(camera_record, "height", DEFAULT_CAMERA_HEIGHT),
        ),
        None,
    )


def _load_robot_for_camera_transfer(robot_urdf_path: Path) -> yourdfpy.URDF:
    return yourdfpy.URDF.load(  # type: ignore[attr-defined]
        str(robot_urdf_path.resolve()),
        load_meshes=False,
        load_collision_meshes=False,
    )


def _apply_camera_transfer_joint_positions(
    robot: yourdfpy.URDF,
    joint_positions: Mapping[str, Any],
) -> None:
    config = {
        name: _finite_joint_position(joint_positions.get(name, 0.0))
        for name in robot.actuated_joint_names
    }
    robot.update_cfg(config)


def _finite_joint_position(value: Any) -> float:
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
    for camera in cameras:
        parent, pose = _mujoco_camera_parent_and_pose(worldbody, camera)
        ET.SubElement(
            parent,
            "camera",
            {
                "name": camera.sim_name,
                "pos": _format_vector(pose.position_xyz),
                "quat": _format_vector(pose.quat_wxyz),
                "fovy": f"{camera.fov_deg:.12g}",
            },
        )
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


def _mujoco_camera_parent_and_pose(
    worldbody: ET.Element,
    camera: SimCameraSpec,
) -> tuple[ET.Element, Transform]:
    parent_body = _find_mujoco_body(worldbody, camera.parent_link)
    if parent_body is not None:
        return parent_body, camera.local_pose
    return worldbody, camera.world_pose


def _find_mujoco_body(worldbody: ET.Element, body_name: str) -> ET.Element | None:
    for body in worldbody.iter("body"):
        if body.get("name") == body_name:
            return body
    return None


def _read_camera_local_transform(camera: dict[str, Any]) -> Transform:
    pose = camera.get("pose")
    if isinstance(pose, dict):
        xyz = _read_vector3(pose.get("xyz"))
        rpy = _read_vector3(pose.get("rpy"))
        return _transform_from_xyz_rpy(xyz, rpy)
    if isinstance(pose, list | tuple) and len(pose) >= 6:
        return _transform_from_xyz_rpy(
            _read_vector3(pose[:3]),
            _read_vector3(pose[3:6]),
        )
    return Transform(position_xyz=(0.0, 0.0, 0.0), rotation=Rotation.identity())


def _read_camera_fov_deg(camera: dict[str, Any]) -> float:
    intrinsics = camera.get("intrinsics")
    if isinstance(intrinsics, dict) and is_finite_number(intrinsics.get("fov_deg")):
        return max(1.0, min(179.0, float(intrinsics["fov_deg"])))
    return DEFAULT_CAMERA_FOV_DEG


def _read_camera_dimension(camera: dict[str, Any], key: str, fallback: int) -> int:
    intrinsics = camera.get("intrinsics")
    if isinstance(intrinsics, dict) and is_finite_number(intrinsics.get(key)):
        return max(1, int(float(intrinsics[key])))
    return fallback


def _transform_from_xyz_rpy(
    xyz: tuple[float, float, float],
    rpy: tuple[float, float, float],
) -> Transform:
    return Transform(
        position_xyz=xyz,
        rotation=Rotation.from_euler("xyz", rpy),
    )


def _compose_transform(parent: Transform, child: Transform) -> Transform:
    return Transform(
        position_xyz=_tuple3(
            np.array(parent.position_xyz, dtype=float) + parent.rotation.apply(child.position_xyz)
        ),
        rotation=parent.rotation * child.rotation,
    )


def _read_vector3(
    value: Any,
    fallback: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> tuple[float, float, float]:
    if isinstance(value, str):
        parts: Sequence[Any] = value.split()
    elif isinstance(value, list | tuple):
        parts = value
    else:
        return fallback
    if len(parts) < 3:
        return fallback
    result: list[float] = []
    for item in parts[:3]:
        try:
            parsed = float(item)
        except (TypeError, ValueError):
            return fallback
        if not is_finite_number(parsed):
            return fallback
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


def _read_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _safe_sim_name(value: str, *, fallback: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip()).strip("_")
    return normalized or fallback
