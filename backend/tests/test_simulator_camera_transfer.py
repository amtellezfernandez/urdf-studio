from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from backend.services.simulator_adapters.camera_transfer import (
    append_cameras_to_mujoco_mjcf,
    build_sim_camera_specs,
)
from backend.tests.simulator_adapter_test_utils import make_world_package


def test_build_sim_camera_specs_resolves_parent_joint_world_pose(tmp_path: Path) -> None:
    robot_urdf = tmp_path / "robot.urdf"
    robot_urdf.write_text(
        """
<robot name="camera_demo">
  <link name="base_link"/>
  <joint name="camera_mount_joint" type="revolute">
    <origin xyz="0 0 1" rpy="0 0 0"/>
    <parent link="base_link"/>
    <child link="camera_mount_link"/>
    <axis xyz="0 0 1"/>
  </joint>
  <link name="camera_mount_link"/>
</robot>
""".strip(),
        encoding="utf-8",
    )
    world_package = make_world_package(
        robot_urdf.read_text(encoding="utf-8"),
        joint_positions={"camera_mount_joint": math.pi / 2.0},
    )
    world_package.world_snapshot.cameras = [
        {
            "id": "cam-1",
            "name": "wrist camera",
            "parent_joint": "camera_mount_joint",
            "pose": {
                "xyz": [1.0, 0.0, 0.0],
                "rpy": [0.0, 0.0, 0.0],
            },
            "intrinsics": {
                "width": 1280,
                "height": 720,
                "fov_deg": 55,
            },
        }
    ]

    cameras, warnings = build_sim_camera_specs(world_package, robot_urdf_path=robot_urdf)

    assert warnings == ()
    assert len(cameras) == 1
    assert cameras[0].parent_link == "camera_mount_link"
    assert cameras[0].sim_name == "wrist_camera"
    assert cameras[0].width == 1280
    assert cameras[0].height == 720
    assert cameras[0].fov_deg == 55
    assert cameras[0].local_pose.position_xyz == (1.0, 0.0, 0.0)
    assert cameras[0].position_xyz[0] == pytest.approx(0.0, abs=1e-9)
    assert cameras[0].position_xyz[1] == pytest.approx(1.0, abs=1e-9)
    assert cameras[0].position_xyz[2] == pytest.approx(1.0, abs=1e-9)


def test_build_sim_camera_specs_warns_for_missing_parent(tmp_path: Path) -> None:
    robot_urdf = tmp_path / "robot.urdf"
    robot_urdf.write_text(
        "<robot name=\"camera_demo\"><link name=\"base_link\"/></robot>",
        encoding="utf-8",
    )
    world_package = make_world_package(robot_urdf.read_text(encoding="utf-8"))
    world_package.world_snapshot.cameras = [
        {
            "name": "orphan camera",
            "parent_joint": "missing_joint",
            "pose": {"xyz": [0, 0, 0], "rpy": [0, 0, 0]},
            "intrinsics": {"width": 640, "height": 480, "fov_deg": 60},
        }
    ]

    cameras, warnings = build_sim_camera_specs(world_package, robot_urdf_path=robot_urdf)

    assert cameras == ()
    assert len(warnings) == 1
    assert "missing_joint" in warnings[0]


def test_append_cameras_to_mujoco_mjcf_adds_native_camera_and_marker() -> None:
    world_package = make_world_package("<robot name=\"demo\"><link name=\"base_link\"/></robot>")
    world_package.world_snapshot.cameras = [
        {
            "id": "cam-1",
            "name": "scene camera",
            "parent_joint": "base_link",
            "pose": {"xyz": [0.1, 0.2, 0.3], "rpy": [0.0, 0.0, 0.0]},
            "intrinsics": {"width": 640, "height": 480, "fov_deg": 45},
        }
    ]
    cameras = build_sim_camera_specs_from_inline_urdf(
        world_package,
        "<robot name=\"demo\"><link name=\"base_link\"/></robot>",
    )

    mjcf = append_cameras_to_mujoco_mjcf(
        "<mujoco model=\"demo\"><worldbody/></mujoco>",
        cameras,
    )
    root = ET.fromstring(mjcf)

    camera = root.find("./worldbody/camera")
    marker = root.find("./worldbody/site")
    assert camera is not None
    assert camera.get("name") == "scene_camera"
    assert camera.get("pos") == "0.1 0.2 0.3"
    assert camera.get("fovy") == "45"
    assert marker is not None
    assert marker.get("name") == "scene_camera_marker"


def test_append_cameras_to_mujoco_mjcf_attaches_camera_to_parent_body() -> None:
    urdf_xml = """
<robot name="demo">
  <link name="base_link"/>
  <joint name="camera_mount_joint" type="fixed">
    <origin xyz="0 0 1" rpy="0 0 0"/>
    <parent link="base_link"/>
    <child link="camera_mount_link"/>
  </joint>
  <link name="camera_mount_link"/>
</robot>
""".strip()
    world_package = make_world_package(urdf_xml)
    world_package.world_snapshot.cameras = [
        {
            "id": "cam-1",
            "name": "mounted camera",
            "parent_joint": "camera_mount_joint",
            "pose": {"xyz": [0.1, 0.2, 0.3], "rpy": [0.0, 0.0, 0.0]},
            "intrinsics": {"width": 640, "height": 480, "fov_deg": 45},
        }
    ]
    cameras = build_sim_camera_specs_from_inline_urdf(world_package, urdf_xml)

    mjcf = append_cameras_to_mujoco_mjcf(
        """
<mujoco model="demo">
  <worldbody>
    <body name="base_link">
      <body name="camera_mount_link" pos="0 0 1"/>
    </body>
  </worldbody>
</mujoco>
""",
        cameras,
    )
    root = ET.fromstring(mjcf)

    camera = root.find("./worldbody/body/body/camera")
    marker = root.find("./worldbody/body/body/site")
    assert camera is not None
    assert camera.get("name") == "mounted_camera"
    assert camera.get("pos") == "0.1 0.2 0.3"
    assert marker is not None
    assert marker.get("pos") == "0.1 0.2 0.3"
    assert root.find("./worldbody/camera") is None


def build_sim_camera_specs_from_inline_urdf(world_package, urdf_xml: str):
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        robot_urdf = Path(directory) / "robot.urdf"
        robot_urdf.write_text(urdf_xml, encoding="utf-8")
        cameras, warnings = build_sim_camera_specs(world_package, robot_urdf_path=robot_urdf)
        assert warnings == ()
        return cameras
