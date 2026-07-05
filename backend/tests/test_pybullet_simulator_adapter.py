from __future__ import annotations

import base64
from dataclasses import replace
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

import pytest
from scipy.spatial.transform import Rotation

from backend.models.simulator_runtime import SimulatorMeshAssetUpload, SimulatorWorkspacePrepareRequest
from backend.tests.simulator_adapter_test_utils import make_world_package
from backend.services.ilu_urdf import BundleMeshAssetsResult, BundledMeshAsset
from backend.services.simulator_adapters import pybullet as pybullet_adapter
from backend.services.simulator_adapters import workspace_package
from backend.services.simulator_adapters import workspace_process
from backend.services.simulator_adapters.camera_intrinsics import PinholeCameraIntrinsics
from backend.services.simulator_adapters.camera_transfer import SimCameraSpec, Transform
from backend.services.simulator_adapters.params import WORKSPACE_LAUNCH_FRAME_MAP
from backend.services.simulator_adapters.plugin import get_plugin
from backend.services.simulator_adapters.pybullet_camera import (
    pybullet_camera_projection_matrix,
    pybullet_camera_view_matrix,
)
from backend.services.simulator_adapters.workspace_expectations import WorkspaceExpectations
from backend.services.simulator_adapters.workspace_diagnostics import (
    pybullet_glxinfo_warnings,
    pybullet_opengl_warnings,
    pybullet_runtime_opengl_warnings,
    read_workspace_launch_warnings,
)
from backend.services.simulator_adapters.workspace_package import PreparedSimulatorWorkspace


def test_pybullet_opengl_diagnostic_warns_for_software_renderer() -> None:
    warnings = pybullet_opengl_warnings(
        "GL_RENDERER=llvmpipe (LLVM 20.1.2, 256 bits)\n"
    )

    assert len(warnings) == 1
    assert "software OpenGL" in warnings[0]
    assert "Mouse and camera interaction" in warnings[0]


def test_pybullet_opengl_diagnostic_accepts_gpu_renderer() -> None:
    assert pybullet_opengl_warnings("GL_RENDERER=NVIDIA GPU Renderer\n") == ()


def test_pybullet_opengl_diagnostic_accepts_glxinfo_renderer_line() -> None:
    warnings = pybullet_opengl_warnings(
        "OpenGL renderer string: llvmpipe (LLVM 20.1.2, 256 bits)\n"
    )

    assert len(warnings) == 1
    assert "software OpenGL" in warnings[0]


def test_pybullet_opengl_diagnostic_accepts_indented_renderer_lines() -> None:
    warnings = pybullet_opengl_warnings(
        "    OpenGL renderer string: llvmpipe (LLVM 20.1.2, 256 bits)\n"
    )

    assert len(warnings) == 1
    assert "software OpenGL" in warnings[0]


def test_pybullet_glxinfo_diagnostic_is_nonfatal_when_probe_missing(monkeypatch) -> None:
    def fake_run(*_args, **_kwargs):
        raise OSError("glxinfo missing")

    monkeypatch.setattr(subprocess, "run", fake_run)

    assert pybullet_glxinfo_warnings() == ()


def test_pybullet_glxinfo_diagnostic_warns_for_software_renderer(monkeypatch) -> None:
    def fake_run(*args, **_kwargs):
        return subprocess.CompletedProcess(
            args=args,
            returncode=0,
            stdout="OpenGL renderer string: llvmpipe (LLVM 20.1.2, 256 bits)\n",
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    warnings = pybullet_glxinfo_warnings()

    assert len(warnings) == 1
    assert "software OpenGL" in warnings[0]


def test_pybullet_glxinfo_diagnostic_accepts_indented_renderer_output(monkeypatch) -> None:
    def fake_run(*args, **_kwargs):
        return subprocess.CompletedProcess(
            args=args,
            returncode=0,
            stdout="    OpenGL renderer string: llvmpipe (LLVM 20.1.2, 256 bits)\n",
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    warnings = pybullet_glxinfo_warnings()

    assert len(warnings) == 1
    assert "software OpenGL" in warnings[0]


def test_pybullet_runtime_diagnostic_prefers_current_glxinfo_over_stale_log(
    monkeypatch,
    tmp_path: Path,
) -> None:
    workspace_dir = tmp_path / "workspace-1"
    workspace_dir.mkdir()
    (workspace_dir / "pybullet.log").write_text(
        "GL_RENDERER=llvmpipe (LLVM 20.1.2, 256 bits)\n",
        encoding="utf-8",
    )

    def fake_run(*args, **_kwargs):
        return subprocess.CompletedProcess(
            args=args,
            returncode=0,
            stdout="OpenGL renderer string: NVIDIA GPU Renderer\n",
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    assert (
        pybullet_runtime_opengl_warnings(
            workspace_root=tmp_path,
            log_name="pybullet.log",
        )
        == ()
    )


def test_pybullet_runtime_diagnostic_uses_latest_workspace_log_when_glxinfo_is_unavailable(
    monkeypatch,
    tmp_path: Path,
) -> None:
    older_workspace_dir = tmp_path / "workspace-1"
    older_workspace_dir.mkdir()
    older_log_path = older_workspace_dir / "pybullet.log"
    older_log_path.write_text("GL_RENDERER=NVIDIA GPU Renderer\n", encoding="utf-8")

    latest_workspace_dir = tmp_path / "workspace-2"
    latest_workspace_dir.mkdir()
    latest_log_path = latest_workspace_dir / "pybullet.log"
    latest_log_path.write_text(
        "GL_RENDERER=llvmpipe (LLVM 20.1.2, 256 bits)\n",
        encoding="utf-8",
    )
    latest_log_path.touch()

    def fake_run(*_args, **_kwargs):
        raise OSError("glxinfo missing")

    monkeypatch.setattr(subprocess, "run", fake_run)

    warnings = pybullet_runtime_opengl_warnings(
        workspace_root=tmp_path,
        log_name="pybullet.log",
    )

    assert len(warnings) == 1
    assert "software OpenGL" in warnings[0]


def test_read_workspace_launch_warnings_ignores_non_pybullet_logs(tmp_path: Path) -> None:
    log_path = tmp_path / "simulator.log"
    log_path.write_text("GL_RENDERER=llvmpipe (LLVM 20.1.2, 256 bits)\n", encoding="utf-8")

    assert read_workspace_launch_warnings("mujoco", log_path) == []


def test_read_workspace_launch_warnings_reads_pybullet_log_tail(tmp_path: Path) -> None:
    log_path = tmp_path / "pybullet.log"
    log_path.write_text("GL_RENDERER=llvmpipe (LLVM 20.1.2, 256 bits)\n", encoding="utf-8")

    warnings = read_workspace_launch_warnings("pybullet", log_path)

    assert len(warnings) == 1
    assert "software OpenGL" in warnings[0]


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


def test_pybullet_plugin_build_check_command_uses_expected_artifact_paths(
    monkeypatch,
    tmp_path: Path,
) -> None:
    prepared = PreparedSimulatorWorkspace(
        workspace_dir=tmp_path / "workspace",
        world_package_path=tmp_path / "workspace" / "world-package.json",
        robot_urdf_path=tmp_path / "workspace" / "robot" / "robot.urdf",
        bundle_result=BundleMeshAssetsResult(
            success=True,
            content="<robot name='demo'/>",
            out_path=str(tmp_path / "workspace" / "robot" / "robot.urdf"),
            assets_root=str(tmp_path / "workspace" / "robot" / "assets"),
            copied_files=0,
            bundled=(),
            unresolved=(),
            error=None,
        ),
        world_object_count=1,
        camera_count=2,
    )
    prepared.world_package_path.parent.mkdir(parents=True, exist_ok=True)
    prepared.robot_urdf_path.parent.mkdir(parents=True, exist_ok=True)
    prepared.world_package_path.write_text("{}", encoding="utf-8")
    prepared.robot_urdf_path.write_text("<robot name='demo'/>", encoding="utf-8")

    monkeypatch.setattr(pybullet_adapter, "prepare_pybullet_workspace", lambda request: prepared)

    command = pybullet_adapter.PyBulletPlugin().build_check_command(
        SimulatorWorkspacePrepareRequest(
            world_package=make_world_package("<robot name='demo'><link name='base'/></robot>"),
        ),
        WorkspaceExpectations(
            duration_sec=0.25,
            frame_map="auto",
            resolved_frame_map="urdf_studio/v1",
            object_count=1,
            camera_count=2,
            object_positions_xyz={},
            object_sizes_xyz={},
            object_asset_refs={},
            object_contracts={},
            joint_positions={},
            camera_ids=(),
            camera_contracts={},
        ),
    )

    assert str(prepared.workspace_dir / "artifacts" / "cameras") in command.command
    assert command.expected_report_path == prepared.workspace_dir / "artifacts" / "report.json"
