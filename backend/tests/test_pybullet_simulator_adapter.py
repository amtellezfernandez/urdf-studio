from __future__ import annotations

import base64
from dataclasses import replace
from pathlib import Path
import xml.etree.ElementTree as ET

import pytest
from scipy.spatial.transform import Rotation

from backend.models.simulator_runtime import SimulatorMeshAssetUpload, SimulatorWorkspacePrepareRequest
from backend.tests.simulator_adapter_test_utils import make_world_package
from backend.services.ilu_urdf import BundleMeshAssetsResult, BundledMeshAsset
from backend.services.simulator_adapters import workspace_package
from backend.services.simulator_adapters import pybullet as pybullet_adapter
from backend.services.simulator_adapters import workspace_process
from backend.services.simulator_adapters.camera_intrinsics import PinholeCameraIntrinsics
from backend.services.simulator_adapters.camera_transfer import SimCameraSpec, Transform
from backend.services.simulator_adapters.params import WORKSPACE_LAUNCH_FRAME_MAP
from backend.services.simulator_adapters.plugin import get_plugin
from backend.services.simulator_adapters.pybullet_camera import (
    pybullet_camera_projection_matrix,
    pybullet_camera_view_matrix,
)
from backend.services.simulator_adapters.workspace_package import PreparedSimulatorWorkspace
from backend.services.world_layout_static_transfer import SimPrimitive
from backend.scripts import pybullet_workspace_prepare as pybullet_prepare
from backend.scripts.pybullet_workspace_prepare import (
    PYBULLET_STATIC_JOINT_HOLD_FORCE,
    _add_primitive,
    _configure_static_debug_viewer,
    _require_pybullet_gui_environment,
    _hold_robot_current_joint_positions,
    _is_pybullet_connected,
    _primitive_shape,
    _should_step_workspace_once,
)


class _FakePybullet:
    GEOM_BOX = 1
    GEOM_SPHERE = 2
    GEOM_CYLINDER = 3
    GEOM_MESH = 4


def test_simulator_workspace_normalizes_expanded_xacro_paths_to_urdf() -> None:
    assert (
        workspace_package._normalize_resolved_urdf_asset_path("pkg/urdf/robot.urdf.xacro")
        == "pkg/urdf/robot.urdf"
    )
    assert (
        workspace_package._normalize_resolved_urdf_asset_path("pkg/urdf/robot.xacro")
        == "pkg/urdf/robot.urdf"
    )
    assert (
        workspace_package._normalize_resolved_urdf_asset_path("pkg/urdf/robot.urdf")
        == "pkg/urdf/robot.urdf"
    )


def test_pybullet_cylinder_uses_distinct_collision_and_visual_height_keywords() -> None:
    primitive = SimPrimitive(
        source_id="column",
        source_name="Column",
        sim_name="wl_column",
        source_type="cylinder",
        sim_type="cylinder",
        position_xyz=(0.0, 0.0, 0.0),
        quat_wxyz=(1.0, 0.0, 0.0, 0.0),
        size_xyz=(0.2, 0.2, 0.8),
        rgba=(0.1, 0.2, 0.3, 1.0),
        collision=True,
    )

    shape_type, collision_kwargs, visual_kwargs = _primitive_shape(_FakePybullet, primitive)

    assert shape_type == _FakePybullet.GEOM_CYLINDER
    assert collision_kwargs == {"radius": 0.1, "height": 0.8}
    assert visual_kwargs == {"radius": 0.1, "length": 0.8}


def test_pybullet_primitive_shape_uses_mesh_asset_when_available(tmp_path: Path) -> None:
    mesh_path = tmp_path / "assets" / "crate.obj"
    mesh_path.parent.mkdir()
    mesh_path.write_text("o crate\n", encoding="utf-8")
    primitive = SimPrimitive(
        source_id="crate",
        source_name="Crate",
        sim_name="wl_crate",
        source_type="mesh",
        sim_type="box",
        position_xyz=(0.0, 0.0, 0.0),
        quat_wxyz=(1.0, 0.0, 0.0, 0.0),
        size_xyz=(0.2, 0.3, 0.4),
        rgba=(0.1, 0.2, 0.3, 1.0),
        collision=True,
        asset_ref="assets/crate.obj",
        asset_scale_xyz=(1.0, 1.2, 1.4),
    )

    shape_type, collision_kwargs, visual_kwargs = _primitive_shape(
        _FakePybullet,
        primitive,
        asset_roots=(tmp_path,),
    )

    assert shape_type == _FakePybullet.GEOM_MESH
    assert collision_kwargs == {
        "fileName": str(mesh_path),
        "meshScale": (1.0, 1.2, 1.4),
    }
    assert visual_kwargs == collision_kwargs


def test_pybullet_primitive_shape_rejects_unresolved_mesh_asset(tmp_path: Path) -> None:
    primitive = SimPrimitive(
        source_id="crate",
        source_name="Crate",
        sim_name="wl_crate",
        source_type="mesh",
        sim_type="box",
        position_xyz=(0.0, 0.0, 0.0),
        quat_wxyz=(1.0, 0.0, 0.0, 0.0),
        size_xyz=(0.2, 0.3, 0.4),
        rgba=(0.1, 0.2, 0.3, 1.0),
        collision=True,
        asset_ref="assets/missing.obj",
    )

    with pytest.raises(ValueError, match="PyBullet mesh object 'crate' asset_ref does not resolve"):
        _primitive_shape(_FakePybullet, primitive, asset_roots=(tmp_path,))


def test_pybullet_primitive_uses_canonical_dynamic_material_fields() -> None:
    class _FakeRuntime(_FakePybullet):
        collision_kwargs = None
        visual_kwargs = None
        multibody_kwargs = None
        dynamics_kwargs = None

        @classmethod
        def createCollisionShape(cls, shape_type, **kwargs):
            cls.collision_kwargs = {"shape_type": shape_type, **kwargs}
            return 10

        @classmethod
        def createVisualShape(cls, shape_type, **kwargs):
            cls.visual_kwargs = {"shape_type": shape_type, **kwargs}
            return 11

        @classmethod
        def createMultiBody(cls, **kwargs):
            cls.multibody_kwargs = kwargs
            return 12

        @classmethod
        def changeDynamics(cls, body_id, link_id, **kwargs):
            cls.dynamics_kwargs = {"body_id": body_id, "link_id": link_id, **kwargs}

    primitive = SimPrimitive(
        source_id="container",
        source_name="Container",
        sim_name="wl_container",
        source_type="cube",
        sim_type="box",
        position_xyz=(0.0, 0.0, 0.0),
        quat_wxyz=(1.0, 0.0, 0.0, 0.0),
        size_xyz=(0.2, 0.3, 0.4),
        rgba=(0.1, 0.2, 0.3, 1.0),
        collision=True,
        fixed=False,
        mass_kg=2.5,
        friction=0.7,
        restitution=0.2,
    )

    body_id = _add_primitive(_FakeRuntime, primitive)

    assert body_id == 12
    assert _FakeRuntime.multibody_kwargs["baseMass"] == 2.5
    assert _FakeRuntime.dynamics_kwargs == {
        "body_id": 12,
        "link_id": -1,
        "lateralFriction": 0.7,
        "restitution": 0.2,
    }


def test_pybullet_gui_static_viewer_disables_mouse_picking_and_realtime() -> None:
    class _FakeRuntime:
        COV_ENABLE_MOUSE_PICKING = 42
        realtime_values: list[int] = []
        debug_visualizer_calls: list[tuple[int, int]] = []

        @classmethod
        def setRealTimeSimulation(cls, value: int) -> None:
            cls.realtime_values.append(value)

        @classmethod
        def configureDebugVisualizer(cls, flag: int, value: int) -> None:
            cls.debug_visualizer_calls.append((flag, value))

    _configure_static_debug_viewer(_FakeRuntime, no_viewer=False)

    assert _FakeRuntime.realtime_values == [0]
    assert _FakeRuntime.debug_visualizer_calls == [(42, 0)]


def test_pybullet_gui_launch_requires_display(monkeypatch) -> None:
    monkeypatch.setattr(pybullet_prepare.sys, "platform", "linux")
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)

    with pytest.raises(RuntimeError, match="no GUI display is available"):
        _require_pybullet_gui_environment(no_viewer=False)

    _require_pybullet_gui_environment(no_viewer=True)


def test_pybullet_static_robot_holds_current_non_fixed_joint_positions() -> None:
    class _FakeRuntime:
        JOINT_FIXED = 4
        POSITION_CONTROL = 7
        control_calls: list[dict[str, object]] = []

        @classmethod
        def getNumJoints(cls, _robot_id: int) -> int:
            return 3

        @classmethod
        def getJointInfo(cls, _robot_id: int, joint_index: int):
            if joint_index == 0:
                return (0, b"shoulder", 0, 0, 0, 0, 0, 0, -1.0, 1.0, 12.0)
            if joint_index == 1:
                return (1, b"fixed_mount", cls.JOINT_FIXED, -1, -1, 0, 0, 0, 0, 0, 0)
            return (2, b"elbow", 0, 0, 0, 0, 0, 0, -1.0, 1.0, 0.0)

        @classmethod
        def getJointState(cls, _robot_id: int, joint_index: int):
            return (0.25 if joint_index == 0 else -0.5, 0.0, (0.0, 0.0, 0.0), 0.0)

        @classmethod
        def setJointMotorControl2(cls, robot_id: int, jointIndex: int, **kwargs) -> None:
            cls.control_calls.append({"robot_id": robot_id, "joint_index": jointIndex, **kwargs})

    held_count = _hold_robot_current_joint_positions(_FakeRuntime, robot_id=99)

    assert held_count == 2
    assert _FakeRuntime.control_calls == [
        {
            "robot_id": 99,
            "joint_index": 0,
            "controlMode": 7,
            "targetPosition": 0.25,
            "targetVelocity": 0.0,
            "force": 12.0,
        },
        {
            "robot_id": 99,
            "joint_index": 2,
            "controlMode": 7,
            "targetPosition": -0.5,
            "targetVelocity": 0.0,
            "force": PYBULLET_STATIC_JOINT_HOLD_FORCE,
        },
    ]


def test_pybullet_default_gui_workspace_does_not_step_static_debug_view() -> None:
    assert _should_step_workspace_once(
        no_viewer=False,
        free_base=False,
        camera_screenshot_dir=None,
        report_path=None,
    ) is False
    assert _should_step_workspace_once(
        no_viewer=False,
        free_base=True,
        camera_screenshot_dir=None,
        report_path=None,
    ) is True
    assert _should_step_workspace_once(
        no_viewer=True,
        free_base=False,
        camera_screenshot_dir=None,
        report_path=None,
    ) is True


def test_pybullet_connection_probe_supports_client_id_and_legacy_signatures() -> None:
    class _ClientIdRuntime:
        seen_client_id = None

        @classmethod
        def isConnected(cls, client_id: int) -> bool:
            cls.seen_client_id = client_id
            return True

    class _LegacyRuntime:
        @classmethod
        def isConnected(cls) -> bool:
            return False

    assert _is_pybullet_connected(_ClientIdRuntime, client_id=17) is True
    assert _ClientIdRuntime.seen_client_id == 17
    assert _is_pybullet_connected(_LegacyRuntime, client_id=17) is False


def test_pybullet_camera_projection_uses_pinhole_intrinsics() -> None:
    class _FakeRuntime:
        projection_kwargs = None

        @classmethod
        def computeProjectionMatrix(cls, **kwargs):
            cls.projection_kwargs = kwargs
            return [1.0] * 16

        @classmethod
        def computeProjectionMatrixFOV(cls, **_kwargs):
            raise AssertionError("fov-only projection should not be used")

    pose = Transform(position_xyz=(0.0, 0.0, 0.0), rotation=Rotation.identity())
    camera = SimCameraSpec(
        camera_id="cam-1",
        name="Calibrated camera",
        sim_name="calibrated_camera",
        parent_joint="base_link",
        parent_link="base_link",
        render_local_pose=pose,
        render_world_pose=pose,
        fov_deg=70.0,
        width=640,
        height=480,
        intrinsics=PinholeCameraIntrinsics(
            width=640,
            height=480,
            vertical_fov_deg=70.0,
            matrix=((500.0, 0.0, 319.5), (0.0, 510.0, 241.25), (0.0, 0.0, 1.0)),
        ),
    )

    projection = pybullet_camera_projection_matrix(
        _FakeRuntime,
        camera,
        near_m=0.1,
        far_m=12.0,
    )

    assert projection == [1.0] * 16
    assert _FakeRuntime.projection_kwargs == {
        "left": -319.5 * 0.1 / 500.0,
        "right": (640.0 - 319.5) * 0.1 / 500.0,
        "bottom": -(480.0 - 241.25) * 0.1 / 510.0,
        "top": 241.25 * 0.1 / 510.0,
        "nearVal": 0.1,
        "farVal": 12.0,
    }


def test_pybullet_camera_view_uses_camera_forward_and_up_vectors() -> None:
    class _FakeRuntime:
        view_kwargs = None

        @classmethod
        def computeViewMatrix(cls, **kwargs):
            cls.view_kwargs = kwargs
            return [1.0] * 16

    pose = Transform(position_xyz=(1.0, 2.0, 3.0), rotation=Rotation.identity())
    camera = SimCameraSpec(
        camera_id="cam-1",
        name="Base camera",
        sim_name="base_camera",
        parent_joint="base_link",
        parent_link="base_link",
        render_local_pose=pose,
        render_world_pose=pose,
        fov_deg=70.0,
        width=640,
        height=480,
    )

    view = pybullet_camera_view_matrix(_FakeRuntime, camera)

    assert view == [1.0] * 16
    assert _FakeRuntime.view_kwargs == {
        "cameraEyePosition": (1.0, 2.0, 3.0),
        "cameraTargetPosition": (1.0, 2.0, 2.0),
        "cameraUpVector": (0.0, 1.0, 0.0),
    }


def test_simulator_workspace_process_uses_repo_local_runtime_cache(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("XDG_CACHE_HOME", "/var/tmp/existing-cache")
    cache_root = tmp_path / "runtime-cache"

    env = workspace_process.build_simulator_workspace_env(cache_root)

    assert env["XDG_CACHE_HOME"] == str(cache_root / "xdg")
    assert env["MPLCONFIGDIR"] == str(cache_root / "matplotlib")
    assert env["NUMBA_CACHE_DIR"] == str(cache_root / "numba")
    assert env["TI_CACHE_HOME"] == str(cache_root / "taichi")
    assert env["TAICHI_CACHE_HOME"] == str(cache_root / "taichi")
    assert env["QUADRANTS_CACHE_DIR"] == str(cache_root / "quadrants")
    assert env["QDCACHE_DIR"] == str(cache_root / "quadrants")
    cache_paths = [Path(value) for value in env.values() if value.startswith(str(cache_root))]
    assert cache_paths
    assert all(path.exists() for path in cache_paths)


def test_prepare_pybullet_simulator_workspace_bundles_uploaded_assets_and_package_roots(
    monkeypatch,
    tmp_path: Path,
) -> None:
    urdf_xml = """
<robot name="demo">
  <link name="base">
    <visual>
      <geometry>
        <mesh filename="package://demo_description/meshes/base.stl"/>
      </geometry>
    </visual>
  </link>
</robot>
""".strip()
    mesh_content = b"solid mesh\nendsolid mesh\n"
    request = SimulatorWorkspacePrepareRequest(
        world_package=make_world_package(
            urdf_xml,
            joint_positions={"joint_1": 0.25},
            objects=[
                {
                    "id": "box-1",
                    "name": "box-1",
                    "type": "cube",
                    "position_xyz": [0.0, 0.1, 0.0],
                    "rotation_rpy_rad": [0.0, 0.0, 0.0],
                    "size_xyz": [0.2, 0.2, 0.2],
                    "color": "#22c55e",
                }
            ],
        ),
        urdf_asset_path="demo_description/robot.urdf",
        mesh_assets=[
            SimulatorMeshAssetUpload(
                path="meshes/base.stl",
                aliases=["demo_description/meshes/base.stl"],
                content_base64=base64.b64encode(mesh_content).decode("ascii"),
                mime="model/stl",
            )
        ],
        package_roots={"demo_description": ["demo_description"]},
    )

    monkeypatch.setattr(
        pybullet_adapter,
        "PYBULLET_WORKSPACE_PROCESS_PARAMS",
        replace(pybullet_adapter.PYBULLET_WORKSPACE_PROCESS_PARAMS, workspace_root=tmp_path),
    )

    def _fake_bundle_mesh_assets_for_urdf_file(
        *,
        urdf_path: str,
        urdf_xml: str,
        out_path: str,
        extra_search_roots: list[str] | None = None,
    ) -> BundleMeshAssetsResult:
        assert Path(urdf_path).name == "robot.urdf"
        assert extra_search_roots is not None
        assert any(Path(root).name == "demo_description" for root in extra_search_roots)
        output_path = Path(out_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(urdf_xml, encoding="utf-8")
        return BundleMeshAssetsResult(
            success=True,
            content=urdf_xml,
            out_path=out_path,
            assets_root=str(output_path.parent / "assets"),
            copied_files=1,
            bundled=(
                BundledMeshAsset(
                    original="package://demo_description/meshes/base.stl",
                    rewritten="assets/demo_description/meshes/base.stl",
                    source_path="/tmp/source/base.stl",
                    target_path="/tmp/out/base.stl",
                ),
            ),
            unresolved=(),
            error=None,
        )

    monkeypatch.setattr(
        workspace_package,
        "bundle_mesh_assets_for_urdf_file",
        _fake_bundle_mesh_assets_for_urdf_file,
    )

    prepared = pybullet_adapter.prepare_pybullet_workspace(request)
    source_root = prepared.workspace_dir / "source"

    assert prepared.world_package_path.exists()
    assert prepared.robot_urdf_path.exists()
    assert (source_root / "demo_description" / "package.xml").exists()
    assert (source_root / "demo_description" / "meshes" / "base.stl").read_bytes() == mesh_content
    assert prepared.bundle_result.copied_files == 1


def test_prepare_pybullet_workspace_stages_expanded_xacro_as_urdf(
    monkeypatch,
    tmp_path: Path,
) -> None:
    urdf_xml = "<robot name=\"demo\"><link name=\"base\"/></robot>"
    request = SimulatorWorkspacePrepareRequest(
        world_package=make_world_package(urdf_xml),
        urdf_asset_path="demo_description/urdf/robot.urdf.xacro",
        mesh_assets=[],
        package_roots={"demo_description": ["demo_description"]},
    )

    monkeypatch.setattr(
        pybullet_adapter,
        "PYBULLET_WORKSPACE_PROCESS_PARAMS",
        replace(pybullet_adapter.PYBULLET_WORKSPACE_PROCESS_PARAMS, workspace_root=tmp_path),
    )

    def _fake_bundle_mesh_assets_for_urdf_file(
        *,
        urdf_path: str,
        urdf_xml: str,
        out_path: str,
        extra_search_roots: list[str] | None = None,
    ) -> BundleMeshAssetsResult:
        assert urdf_path.endswith("demo_description/urdf/robot.urdf")
        assert not urdf_path.endswith(".xacro")
        assert extra_search_roots is not None
        assert any(Path(root).name == "urdf" for root in extra_search_roots)
        output_path = Path(out_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(urdf_xml, encoding="utf-8")
        return BundleMeshAssetsResult(
            success=True,
            content=urdf_xml,
            out_path=out_path,
            assets_root=str(output_path.parent / "assets"),
            copied_files=0,
            bundled=(),
            unresolved=(),
            error=None,
        )

    monkeypatch.setattr(
        workspace_package,
        "bundle_mesh_assets_for_urdf_file",
        _fake_bundle_mesh_assets_for_urdf_file,
    )

    prepared = pybullet_adapter.prepare_pybullet_workspace(request)
    staged_source_path = (
        prepared.workspace_dir / "source" / "demo_description" / "urdf" / "robot.urdf"
    )

    assert staged_source_path.exists()
    assert not staged_source_path.with_suffix(".urdf.xacro").exists()
    assert prepared.robot_urdf_path.name == "robot.urdf"


def test_prepare_pybullet_workspace_inlines_named_visual_material_colors(
    monkeypatch,
    tmp_path: Path,
) -> None:
    urdf_xml = """
<robot name="demo">
  <material name="printed_yellow">
    <color rgba="1.0 0.82 0.12 1.0"/>
  </material>
  <link name="base">
    <visual>
      <geometry>
        <box size="0.1 0.1 0.1"/>
      </geometry>
      <material name="printed_yellow"/>
    </visual>
  </link>
</robot>
""".strip()
    request = SimulatorWorkspacePrepareRequest(
        world_package=make_world_package(urdf_xml),
    )

    monkeypatch.setattr(
        pybullet_adapter,
        "PYBULLET_WORKSPACE_PROCESS_PARAMS",
        replace(pybullet_adapter.PYBULLET_WORKSPACE_PROCESS_PARAMS, workspace_root=tmp_path),
    )

    def _fake_bundle_mesh_assets_for_urdf_file(
        *,
        urdf_xml: str,
        out_path: str,
        **_kwargs,
    ) -> BundleMeshAssetsResult:
        output_path = Path(out_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(urdf_xml, encoding="utf-8")
        return BundleMeshAssetsResult(
            success=True,
            content=urdf_xml,
            out_path=out_path,
            assets_root=str(output_path.parent / "assets"),
            copied_files=0,
            bundled=(),
            unresolved=(),
            error=None,
        )

    monkeypatch.setattr(
        workspace_package,
        "bundle_mesh_assets_for_urdf_file",
        _fake_bundle_mesh_assets_for_urdf_file,
    )

    prepared = pybullet_adapter.prepare_pybullet_workspace(request)
    root = ET.parse(prepared.robot_urdf_path).getroot()
    visual_material = root.find("./link/visual/material")
    assert visual_material is not None
    visual_color = visual_material.find("color")

    assert visual_color is not None
    assert visual_color.get("rgba") == "1.0 0.82 0.12 1.0"


def test_prepare_pybullet_workspace_adds_fallback_visual_material_colors(
    monkeypatch,
    tmp_path: Path,
) -> None:
    urdf_xml = """
<robot name="demo">
  <link name="left_wheel">
    <visual>
      <geometry>
        <mesh filename="meshes/left_wheel.stl"/>
      </geometry>
    </visual>
  </link>
  <link name="painted_cover">
    <visual>
      <geometry>
        <box size="0.1 0.1 0.1"/>
      </geometry>
      <material name="painted_cover">
        <color rgba="0.1 0.2 0.3 1.0"/>
      </material>
    </visual>
  </link>
</robot>
""".strip()
    request = SimulatorWorkspacePrepareRequest(
        world_package=make_world_package(urdf_xml),
    )

    monkeypatch.setattr(
        pybullet_adapter,
        "PYBULLET_WORKSPACE_PROCESS_PARAMS",
        replace(pybullet_adapter.PYBULLET_WORKSPACE_PROCESS_PARAMS, workspace_root=tmp_path),
    )

    def _fake_bundle_mesh_assets_for_urdf_file(
        *,
        urdf_xml: str,
        out_path: str,
        **_kwargs,
    ) -> BundleMeshAssetsResult:
        output_path = Path(out_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(urdf_xml, encoding="utf-8")
        return BundleMeshAssetsResult(
            success=True,
            content=urdf_xml,
            out_path=out_path,
            assets_root=str(output_path.parent / "assets"),
            copied_files=0,
            bundled=(),
            unresolved=(),
            error=None,
        )

    monkeypatch.setattr(
        workspace_package,
        "bundle_mesh_assets_for_urdf_file",
        _fake_bundle_mesh_assets_for_urdf_file,
    )

    prepared = pybullet_adapter.prepare_pybullet_workspace(request)
    root = ET.parse(prepared.robot_urdf_path).getroot()
    wheel_material = root.find("./link[@name='left_wheel']/visual/material")
    cover_color = root.find("./link[@name='painted_cover']/visual/material/color")

    assert wheel_material is not None
    wheel_color = wheel_material.find("color")
    assert wheel_material.get("name") == "urdf_studio_left_wheel_0"
    assert wheel_color is not None
    assert wheel_color.get("rgba") == "0.04 0.045 0.05 1.0"
    assert cover_color is not None
    assert cover_color.get("rgba") == "0.1 0.2 0.3 1.0"


def test_pybullet_plugin_reports_direct_urdf_transfer(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("URDF_STUDIO_DISABLE_SIMULATOR_ACCELERATION", "1")
    workspace_dir = tmp_path / "workspace"
    robot_dir = workspace_dir / "robot"
    robot_dir.mkdir(parents=True)
    world_package_path = workspace_dir / "world-package.json"
    robot_urdf_path = robot_dir / "robot.urdf"
    world_package_path.write_text("{}", encoding="utf-8")
    robot_urdf_path.write_text("<robot name=\"demo\"><link name=\"base\"/></robot>", encoding="utf-8")

    prepared = PreparedSimulatorWorkspace(
        workspace_dir=workspace_dir,
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        bundle_result=BundleMeshAssetsResult(
            success=True,
            content=robot_urdf_path.read_text(encoding="utf-8"),
            out_path=str(robot_urdf_path),
            assets_root=str(robot_dir / "assets"),
            copied_files=0,
            bundled=(),
            unresolved=(),
            error=None,
        ),
    )

    class _FakeProcess:
        pid = 4321

        def poll(self) -> None:
            return None

    monkeypatch.setattr(
        workspace_package,
        "prepare_simulator_workspace_package",
        lambda _request, **_kwargs: prepared,
    )
    popen_calls = []

    def _fake_popen(*args, **kwargs):
        popen_calls.append((args, kwargs))
        return _FakeProcess()

    monkeypatch.setattr(workspace_process.subprocess, "Popen", _fake_popen)
    monkeypatch.setattr(workspace_process, "wait_for_workspace_readiness", lambda *args, **kwargs: None)

    response = get_plugin("pybullet").prepare_workspace(
        SimulatorWorkspacePrepareRequest(
            world_package=make_world_package("<robot name=\"demo\"><link name=\"base\"/></robot>"),
        )
    )

    assert response.simulator_id == "pybullet"
    assert response.pid == 4321
    assert response.launch_mode == "interactive_viewer"
    assert response.simulator_asset_path == str(robot_urdf_path)
    assert response.simulator_asset_format == "urdf"
    assert "--robot-urdf" in response.command
    assert "--no-viewer" not in response.command
    assert response.command[response.command.index("--frame-map") + 1] == WORKSPACE_LAUNCH_FRAME_MAP
    assert popen_calls
    _args, kwargs = popen_calls[0]
    assert kwargs["stdin"] == workspace_process.subprocess.DEVNULL
    assert kwargs["start_new_session"] is True
    assert kwargs["close_fds"] is True
