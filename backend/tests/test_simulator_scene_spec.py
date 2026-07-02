from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.models.world_scene_package import WorldArtifactRef
from backend.services.simulator_adapters.world_scene import (
    prepare_simulator_scene,
    write_simulator_validation_report,
)
from backend.services.world_scene_package_digest import (
    computed_world_snapshot_digest,
    declared_world_snapshot_digests,
)
from backend.tests.simulator_adapter_test_utils import make_world_package, write_world_package_file


def test_prepare_simulator_scene_builds_canonical_scene_spec(tmp_path: Path) -> None:
    urdf_xml = """
<robot name="scene_spec_demo">
  <link name="base_link"/>
</robot>
""".strip()
    world_package = make_world_package(
        urdf_xml,
        joint_positions={"joint_1": 0.25},
        objects=[
            {
                "id": "crate",
                "name": "Crate",
                "type": "cube",
                "position_xyz": [0.1, 0.2, 0.3],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz": [0.2, 0.3, 0.4],
                "color": "#22c55e",
            }
        ],
    )
    world_package.world_snapshot.cameras = [
        {
            "id": "cam-1",
            "name": "base camera",
            "parent_joint": "base_link",
            "pose": {"xyz": [0.0, 0.0, 0.0], "rpy": [0.0, 0.0, 0.0]},
            "intrinsics": {
                "width": 640,
                "height": 480,
                "fov_deg": 70,
                "fx": 500.0,
                "fy": 510.0,
                "cx": 319.5,
                "cy": 241.25,
            },
        }
    ]
    world_package_path = tmp_path / "world-package.json"
    robot_urdf_path = tmp_path / "robot.urdf"
    write_world_package_file(world_package_path, world_package)
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")

    scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map="identity",
        include_hidden=False,
    )
    report = scene.validation_report()

    assert scene.world_package.package_id == "demo_world"
    assert scene.robot.urdf_path == robot_urdf_path
    assert scene.robot.joint_positions == {"joint_1": 0.25}
    assert scene.robot.asset_roots == (tmp_path / "source", tmp_path)
    assert [primitive.sim_name for primitive in scene.primitives] == ["wl_crate"]
    assert [camera.sim_name for camera in scene.cameras] == ["base_camera"]
    assert scene.warnings == ()
    assert report["package_id"] == "demo_world"
    assert report["frame_map"] == "identity"
    assert report["primitive_count"] == 1
    assert report["camera_count"] == 1
    assert report["joint_position_count"] == 1
    assert report["joint_positions"] == {"joint_1": 0.25}
    assert report["cameras"][0]["intrinsics"]["matrix"] == [
        [500.0, 0.0, 319.5],
        [0.0, 510.0, 241.25],
        [0.0, 0.0, 1.0],
    ]

    report_path = tmp_path / "report.json"
    written_report = write_simulator_validation_report(
        scene,
        report_path,
        simulator_id="pybullet",
        simulator_label="PyBullet",
        runtime={"camera_screenshots": 1},
        artifacts={"camera_dir": tmp_path / "cameras"},
    )
    persisted_report = json.loads(report_path.read_text(encoding="utf-8"))

    assert written_report == persisted_report
    assert persisted_report["simulator"] == {
        "id": "pybullet",
        "label": "PyBullet",
        "runtime": {"camera_screenshots": 1},
    }
    assert persisted_report["artifacts"]["camera_dir"] == str(tmp_path / "cameras")


def test_prepare_simulator_scene_rejects_invalid_declared_camera(tmp_path: Path) -> None:
    urdf_xml = "<robot name=\"scene_spec_demo\"><link name=\"base_link\"/></robot>"
    world_package = make_world_package(
        urdf_xml,
        objects=[
            {
                "id": "hidden-crate",
                "name": "Hidden crate",
                "type": "cube",
                "position_xyz": [0.0, 0.0, 0.0],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz": [0.1, 0.1, 0.1],
                "color": "#22c55e",
                "is_hidden": True,
            }
        ],
    )
    world_package.world_snapshot.cameras = [
        {
            "id": "cam-1",
            "name": "orphan camera",
            "parent_joint": "missing_link",
            "pose": {"xyz": [0.0, 0.0, 0.0], "rpy": [0.0, 0.0, 0.0]},
            "intrinsics": {"width": 640, "height": 480, "fov_deg": 70},
        }
    ]
    world_package_path = tmp_path / "world-package.json"
    robot_urdf_path = tmp_path / "robot.urdf"
    write_world_package_file(world_package_path, world_package)
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")

    with pytest.raises(ValueError, match="missing_link"):
        prepare_simulator_scene(
            world_package_path=world_package_path,
            robot_urdf_path=robot_urdf_path,
            frame_map="identity",
            include_hidden=False,
        )


def test_prepare_simulator_scene_repairs_stale_world_snapshot_artifact_digest(
    tmp_path: Path,
) -> None:
    urdf_xml = "<robot name=\"scene_spec_demo\"><link name=\"base_link\"/></robot>"
    world_package = make_world_package(urdf_xml)
    world_package.artifacts = [
        WorldArtifactRef(
            kind="world_snapshot",
            digest_sha256="0" * 64,
            uri="inline://snapshot",
        )
    ]
    world_package_path = tmp_path / "world-package.json"
    robot_urdf_path = tmp_path / "robot.urdf"
    write_world_package_file(world_package_path, world_package)
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")

    scene = prepare_simulator_scene(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        frame_map="identity",
        include_hidden=False,
    )

    assert declared_world_snapshot_digests(scene.world_package) == (
        computed_world_snapshot_digest(scene.world_package),
    )
