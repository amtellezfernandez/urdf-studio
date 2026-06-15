from __future__ import annotations

import pytest

from backend.services.simulator_adapters.workspace_request_sources import (
    MESH_ASSET_FIXTURE_PATH,
    WORKSPACE_SIMULATORS,
    build_demo_workspace_request,
    build_mesh_asset_workspace_request,
    build_studio_y_up_axis_workspace_request,
    build_workspace_request_from_files,
)
from backend.tests.simulator_adapter_test_utils import make_world_package, write_world_package_file


def test_demo_workspace_request_contains_robot_assets_objects_and_cameras() -> None:
    request = build_demo_workspace_request()

    assert request.urdf_asset_path == "robot.urdf"
    assert request.world_package.interface.frame_convention == "ros-rep-103"
    assert len(request.mesh_assets) > 0
    assert len(request.world_package.world_snapshot.objects) == 3
    assert len(request.world_package.world_snapshot.cameras) == 3
    assert [camera["id"] for camera in request.world_package.world_snapshot.cameras] == [
        "so101_overhead_scene",
        "so101_gripper_down",
        "so101_port_oblique",
    ]
    assert request.world_package.world_snapshot.cameras[0]["pose"] == {
        "xyz": [0.2, 0.02, 0.75],
        "rpy": [0.0, 1.3909428270024187, 0.0],
    }
    assert [target.name for target in request.world_package.runtime_targets] == list(
        WORKSPACE_SIMULATORS
    )


def test_studio_y_up_axis_workspace_request_contains_axis_probe() -> None:
    request = build_studio_y_up_axis_workspace_request()

    assert request.urdf_asset_path == "robot.urdf"
    assert request.world_package.package_id == "studio-y-up-axis-workspace-check"
    assert request.world_package.interface.frame_convention == "studio-y-up"
    assert request.world_package.interface.observation_modalities == ["state"]
    assert request.world_package.world_snapshot.cameras == []
    assert request.world_package.world_snapshot.objects == [
        {
            "id": "axis-box",
            "name": "Axis box",
            "type": "cube",
            "position_xyz": [1.0, 2.0, 3.0],
            "rotation_rpy_rad": [0.0, 0.0, 0.0],
            "size_xyz": [0.2, 0.4, 0.8],
            "color": "#22c55e",
            "source": "user",
        }
    ]
    assert request.world_package.provenance["workspace_check_fixture"] == "studio-y-up-axis"
    assert len(request.mesh_assets) > 0


def test_mesh_asset_workspace_request_contains_mesh_object_and_upload() -> None:
    request = build_mesh_asset_workspace_request()

    assert request.urdf_asset_path == "robot.urdf"
    assert request.world_package.package_id == "mesh-asset-workspace-check"
    assert request.world_package.interface.observation_modalities == ["state"]
    assert request.world_package.world_snapshot.cameras == []
    assert request.world_package.world_snapshot.objects == [
        {
            "id": "mesh-crate",
            "name": "Mesh crate",
            "type": "mesh",
            "position_xyz": [0.4, -0.2, 0.15],
            "rotation_rpy_rad": [0.0, 0.0, 0.0],
            "size_xyz": [0.3, 0.2, 0.2],
            "color": "#22c55e",
            "asset_ref": MESH_ASSET_FIXTURE_PATH,
            "source": "user",
        }
    ]
    assert request.world_package.provenance["workspace_check_fixture"] == "mesh-asset"
    assert MESH_ASSET_FIXTURE_PATH in {asset.path for asset in request.mesh_assets}


def test_workspace_request_from_files_loads_custom_package_assets(tmp_path) -> None:
    asset_root = tmp_path / "scene"
    mesh_path = asset_root / "assets" / "box.stl"
    material_path = asset_root / "assets" / "box.mtl"
    texture_path = asset_root / "textures" / "box.png"
    robot_urdf_path = asset_root / "robot.urdf"
    mesh_path.parent.mkdir(parents=True)
    texture_path.parent.mkdir(parents=True)
    (asset_root / "__pycache__").mkdir()
    (asset_root / "__pycache__" / "local.pyc").write_bytes(b"cache")
    (asset_root / "README.md").write_text("operator notes\n", encoding="utf-8")
    (asset_root / "run.log").write_text("local simulator output\n", encoding="utf-8")
    (asset_root / "package.xml").write_text(
        "<package><name>custom_robot_description</name></package>",
        encoding="utf-8",
    )
    mesh_path.write_text("solid box\nendsolid box\n", encoding="utf-8")
    material_path.write_text("newmtl box\nmap_Kd ../textures/box.png\n", encoding="utf-8")
    texture_path.write_bytes(b"\x89PNG\r\n\x1a\n")
    urdf_xml = """
<robot name="custom_robot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="assets/box.stl"/>
      </geometry>
    </visual>
  </link>
</robot>
""".strip()
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")
    world_package = make_world_package(
        urdf_xml,
        objects=[
            {
                "id": "crate",
                "name": "Crate",
                "type": "cube",
                "position_xyz": [0.0, 0.0, 0.0],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz": [0.1, 0.2, 0.3],
                "color": "#ff0000",
            }
        ],
    )
    world_package_path = tmp_path / "world-package.json"
    write_world_package_file(world_package_path, world_package)

    request = build_workspace_request_from_files(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        asset_roots=(asset_root,),
    )

    assert request.world_package.package_id == "demo_world"
    assert request.urdf_asset_path == "robot.urdf"
    assert [asset.path for asset in request.mesh_assets] == [
        "assets/box.mtl",
        "assets/box.stl",
        "package.xml",
        "textures/box.png",
    ]


def test_workspace_request_from_files_rejects_conflicting_asset_roots(tmp_path) -> None:
    asset_root_a = tmp_path / "scene_a"
    asset_root_b = tmp_path / "scene_b"
    robot_urdf_path = asset_root_a / "robot.urdf"
    mesh_path_a = asset_root_a / "assets" / "box.stl"
    mesh_path_b = asset_root_b / "assets" / "box.stl"
    mesh_path_a.parent.mkdir(parents=True)
    mesh_path_b.parent.mkdir(parents=True)
    mesh_path_a.write_text("solid box_a\nendsolid box_a\n", encoding="utf-8")
    mesh_path_b.write_text("solid box_b\nendsolid box_b\n", encoding="utf-8")
    urdf_xml = """
<robot name="custom_robot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="assets/box.stl"/>
      </geometry>
    </visual>
  </link>
</robot>
""".strip()
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")
    world_package_path = tmp_path / "world-package.json"
    write_world_package_file(world_package_path, make_world_package(urdf_xml))

    with pytest.raises(ValueError, match="Conflicting asset path"):
        build_workspace_request_from_files(
            world_package_path=world_package_path,
            robot_urdf_path=robot_urdf_path,
            asset_roots=(asset_root_a, asset_root_b),
        )


def test_workspace_request_from_files_ignores_conflicting_non_transfer_files(tmp_path) -> None:
    asset_root_a = tmp_path / "scene_a"
    asset_root_b = tmp_path / "scene_b"
    robot_urdf_path = asset_root_a / "robot.urdf"
    for root, note in ((asset_root_a, "first"), (asset_root_b, "second")):
        root.mkdir(parents=True)
        (root / "README.md").write_text(f"{note} notes\n", encoding="utf-8")
    urdf_xml = "<robot name=\"custom_robot\"><link name=\"base_link\"/></robot>"
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")
    world_package_path = tmp_path / "world-package.json"
    write_world_package_file(world_package_path, make_world_package(urdf_xml))

    request = build_workspace_request_from_files(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        asset_roots=(asset_root_a, asset_root_b),
    )

    assert request.mesh_assets == []


def test_workspace_request_from_files_accepts_xacro_source_path(tmp_path) -> None:
    asset_root = tmp_path / "scene"
    robot_source_path = asset_root / "robot.urdf.xacro"
    asset_root.mkdir()
    urdf_xml = "<robot name=\"custom_robot\"><link name=\"base_link\"/></robot>"
    robot_source_path.write_text(urdf_xml, encoding="utf-8")
    world_package_path = tmp_path / "world-package.json"
    write_world_package_file(world_package_path, make_world_package(urdf_xml))

    request = build_workspace_request_from_files(
        world_package_path=world_package_path,
        robot_urdf_path=robot_source_path,
        asset_roots=(asset_root,),
    )

    assert request.urdf_asset_path == "robot.urdf.xacro"
