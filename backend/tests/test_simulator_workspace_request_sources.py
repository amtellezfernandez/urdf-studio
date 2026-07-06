from __future__ import annotations

import pytest

from backend.models.world_scene_package import WorldArtifactRef
from backend.services.simulator_adapters.workspace_request_sources import (
    MESH_ASSET_FIXTURE_PATH,
    _build_fixture_request,
    _resolve_workspace_asset_roots,
    build_demo_workspace_request,
    build_hidden_object_workspace_request,
    build_mesh_asset_workspace_request,
    build_studio_y_up_axis_workspace_request,
    build_workspace_request_from_files,
)
from backend.services.world_scene_package_digest import (
    declared_world_scene_registry_envelope_digests,
    world_scene_registry_envelope_digest,
)
from backend.tests.simulator_adapter_test_utils import make_world_package, write_world_package_file


def test_demo_workspace_request_contains_robot_assets_objects_and_cameras() -> None:
    request = build_demo_workspace_request()

    assert request.urdf_asset_path == "robot.urdf"
    assert request.world_package.world.environment == {"frame_convention": "ros-rep-103"}
    assert len(request.mesh_assets) > 0
    assert len(request.world_package.world.objects) == 3
    assert len(request.world_package.world.cameras or []) == 3
    assert [camera["id"] for camera in request.world_package.world.cameras or []] == [
        "so101_overhead_scene",
        "so101_gripper_down",
        "so101_port_oblique",
    ]
    assert (request.world_package.world.cameras or [])[0]["pose"] == {
        "xyz": [0.2, 0.02, 0.75],
        "rpy": [0.0, 1.3909428270024187, 0.0],
    }
    assert request.world_package.package_id == "so101-simulator-workspaces-check"


def test_studio_y_up_axis_workspace_request_contains_axis_probe() -> None:
    request = build_studio_y_up_axis_workspace_request()

    assert request.urdf_asset_path == "robot.urdf"
    assert request.world_package.package_id == "studio-y-up-axis-workspace-check"
    assert request.world_package.world.environment == {"frame_convention": "studio-y-up"}
    assert request.world_package.world.cameras == []
    assert request.world_package.world.objects == [
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
    assert request.world_package.world.cameras == []
    assert request.world_package.world.objects == [
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


def test_hidden_object_workspace_request_keeps_hidden_source_but_active_count_stays_demo() -> None:
    request = build_hidden_object_workspace_request()

    assert request.urdf_asset_path == "robot.urdf"
    assert request.world_package.package_id == "hidden-object-workspace-check"
    assert request.world_package.provenance["workspace_check_fixture"] == "hidden-object"
    assert len(request.world_package.world.objects) == 4
    hidden_objects = [
        item
        for item in request.world_package.world.objects
        if item.get("is_hidden") is True
    ]
    assert [item["id"] for item in hidden_objects] == ["hidden-transfer-probe"]
    assert len(request.mesh_assets) > 0


def test_build_fixture_request_does_not_mutate_input_world_package_provenance() -> None:
    base_request = build_demo_workspace_request()
    world_package = base_request.world_package.model_copy(deep=True)
    original_provenance = dict(world_package.provenance)

    request = _build_fixture_request(
        fixture_name="custom-fixture",
        world_package=world_package,
    )

    assert request.world_package.provenance["workspace_check_fixture"] == "custom-fixture"
    assert world_package.provenance == original_provenance
    assert world_package.package_id == base_request.world_package.package_id


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


def test_workspace_request_from_files_keeps_robot_directory_when_extra_asset_root_is_passed(
    tmp_path,
) -> None:
    robot_root = tmp_path / "robot_scene"
    extra_root = tmp_path / "extra_assets"
    robot_urdf_path = robot_root / "robot.urdf"
    robot_mesh_path = robot_root / "meshes" / "arm.stl"
    extra_mesh_path = extra_root / "props" / "crate.obj"
    robot_mesh_path.parent.mkdir(parents=True)
    extra_mesh_path.parent.mkdir(parents=True)
    robot_mesh_path.write_text("solid arm\nendsolid arm\n", encoding="utf-8")
    extra_mesh_path.write_text("o crate\nv 0 0 0\n", encoding="utf-8")
    urdf_xml = """
<robot name="custom_robot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/arm.stl"/>
      </geometry>
    </visual>
  </link>
</robot>
""".strip()
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")
    world_package_path = tmp_path / "world-package.json"
    write_world_package_file(world_package_path, make_world_package(urdf_xml))

    request = build_workspace_request_from_files(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        asset_roots=(extra_root,),
    )

    assert request.urdf_asset_path == "robot.urdf"
    assert [asset.path for asset in request.mesh_assets] == [
        "meshes/arm.stl",
        "props/crate.obj",
    ]


def test_workspace_request_from_files_rejects_invalid_world_package_json(
    tmp_path,
) -> None:
    robot_urdf_path = tmp_path / "robot.urdf"
    world_package_path = tmp_path / "world-package.json"
    robot_urdf_path.write_text("<robot name='demo'/>", encoding="utf-8")
    world_package_path.write_text("{", encoding="utf-8")

    with pytest.raises(ValueError, match=r"Failed to read JSON object:"):
        build_workspace_request_from_files(
            world_package_path=world_package_path,
            robot_urdf_path=robot_urdf_path,
        )


def test_workspace_request_from_files_rejects_invalid_world_package_encoding(
    tmp_path,
) -> None:
    robot_urdf_path = tmp_path / "robot.urdf"
    world_package_path = tmp_path / "world-package.json"
    robot_urdf_path.write_text("<robot name='demo'/>", encoding="utf-8")
    world_package_path.write_bytes(b"\xff\xfe\x00")

    with pytest.raises(ValueError, match=r"Failed to read JSON object:"):
        build_workspace_request_from_files(
            world_package_path=world_package_path,
            robot_urdf_path=robot_urdf_path,
        )


def test_resolve_workspace_asset_roots_dedupes_robot_root_and_extra_roots(tmp_path) -> None:
    robot_root = tmp_path / "robot_scene"
    robot_urdf_path = robot_root / "robot.urdf"
    extra_root = tmp_path / "extra_assets"
    robot_root.mkdir()
    extra_root.mkdir()
    robot_urdf_path.write_text("<robot name='demo'/>", encoding="utf-8")

    roots = _resolve_workspace_asset_roots(
        robot_urdf_path=robot_urdf_path,
        asset_roots=(robot_root, extra_root, robot_root),
    )

    assert roots == (robot_root.resolve(), extra_root.resolve())


def test_workspace_request_from_files_repairs_stale_world_snapshot_artifact_digest(
    tmp_path,
) -> None:
    asset_root = tmp_path / "scene"
    robot_urdf_path = asset_root / "robot.urdf"
    asset_root.mkdir()
    urdf_xml = "<robot name=\"custom_robot\"><link name=\"base_link\"/></robot>"
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")
    world_package = make_world_package(urdf_xml)
    world_package.artifacts = [
        WorldArtifactRef(
            kind="world_snapshot",
            digest_sha256="0" * 64,
            uri="inline://snapshot",
        )
    ]
    world_package_path = tmp_path / "world-package.json"
    write_world_package_file(world_package_path, world_package)

    request = build_workspace_request_from_files(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        asset_roots=(asset_root,),
    )

    assert declared_world_scene_registry_envelope_digests(request.world_package) == (
        world_scene_registry_envelope_digest(request.world_package),
    )


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


def test_workspace_request_from_files_preserves_nested_urdf_source_path_with_explicit_asset_root(
    tmp_path,
) -> None:
    asset_root = tmp_path / "scene"
    robot_urdf_path = asset_root / "demo_description" / "urdf" / "robot.urdf"
    mesh_path = asset_root / "demo_description" / "meshes" / "arm.stl"
    robot_urdf_path.parent.mkdir(parents=True)
    mesh_path.parent.mkdir(parents=True)
    mesh_path.write_text("solid arm\nendsolid arm\n", encoding="utf-8")
    urdf_xml = """
<robot name="custom_robot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="../meshes/arm.stl"/>
      </geometry>
    </visual>
  </link>
</robot>
""".strip()
    robot_urdf_path.write_text(urdf_xml, encoding="utf-8")
    world_package_path = tmp_path / "world-package.json"
    write_world_package_file(world_package_path, make_world_package(urdf_xml))

    request = build_workspace_request_from_files(
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        asset_roots=(asset_root,),
    )

    assert request.urdf_asset_path == "demo_description/urdf/robot.urdf"
    assert [asset.path for asset in request.mesh_assets] == [
        "demo_description/meshes/arm.stl",
    ]


def test_workspace_request_from_files_preserves_nested_xacro_source_path_with_explicit_asset_root(
    tmp_path,
) -> None:
    asset_root = tmp_path / "scene"
    robot_source_path = asset_root / "demo_description" / "urdf" / "robot.urdf.xacro"
    robot_source_path.parent.mkdir(parents=True)
    urdf_xml = "<robot name=\"custom_robot\"><link name=\"base_link\"/></robot>"
    robot_source_path.write_text(urdf_xml, encoding="utf-8")
    world_package_path = tmp_path / "world-package.json"
    write_world_package_file(world_package_path, make_world_package(urdf_xml))

    request = build_workspace_request_from_files(
        world_package_path=world_package_path,
        robot_urdf_path=robot_source_path,
        asset_roots=(asset_root,),
    )

    assert request.urdf_asset_path == "demo_description/urdf/robot.urdf.xacro"
