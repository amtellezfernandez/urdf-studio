from __future__ import annotations

from dataclasses import dataclass
import importlib
from pathlib import Path

import pytest

from backend.models.simulator_runtime import SimulatorWorkspacePrepareRequest
from backend.tests.simulator_adapter_test_utils import make_workspace_prepare_request
from backend.services.ilu_urdf import (
    BundleMeshAssetsResult,
    BundledMeshAsset,
    MjcfConversionDiagnostic,
    MjcfConversionResult,
    MjcfConversionStats,
)
from backend.services.simulator_adapters import mujoco as mujoco_adapter
from backend.services.simulator_adapters import workspace_process
from backend.services.simulator_adapters.mjlab import MJLAB_WORKSPACE_PROCESS_PARAMS
from backend.services.simulator_adapters.mujoco_scene import (
    configure_mujoco_passive_viewer,
    mujoco_scene_bounds,
)
from backend.services.simulator_adapters.params import (
    MUJOCO_SCENE_PARAMS,
    MUJOCO_WORKSPACE_PROCESS_PARAMS,
    WORKSPACE_LAUNCH_FRAME_MAP,
)
from backend.services.simulator_adapters.workspace_package import PreparedSimulatorWorkspace


DEMO_URDF = "<robot name=\"demo\"><link name=\"base\"/></robot>"
DEMO_MJCF = "<mujoco model=\"demo\"><worldbody/></mujoco>"


@dataclass(frozen=True)
class PreparedMujocoWorkspaceFixture:
    prepared: PreparedSimulatorWorkspace
    robot_dir: Path
    robot_urdf_path: Path
    bundled_mesh_path: Path | None = None


def _request() -> SimulatorWorkspacePrepareRequest:
    return make_workspace_prepare_request(DEMO_URDF)


def test_mjlab_workspace_prepare_imports_shared_mujoco_runner() -> None:
    module = importlib.import_module("backend.scripts.mjlab_workspace_prepare")
    mujoco_workspace_prepare = importlib.import_module(
        "backend.scripts.mujoco_workspace_prepare"
    )

    assert callable(module.main)
    assert (
        mujoco_workspace_prepare._workspace_ready_marker("mjlab")
        == MJLAB_WORKSPACE_PROCESS_PARAMS.ready_log_marker
    )


def _make_prepared_workspace_fixture(
    tmp_path: Path,
    *,
    robot_urdf_xml: str = DEMO_URDF,
    bundled_mesh_content: bytes | None = None,
) -> PreparedMujocoWorkspaceFixture:
    workspace_dir = tmp_path / "workspace"
    robot_dir = workspace_dir / "robot"
    robot_dir.mkdir(parents=True)
    world_package_path = workspace_dir / "world-package.json"
    robot_urdf_path = robot_dir / "robot.urdf"
    world_package_path.write_text("{}", encoding="utf-8")
    robot_urdf_path.write_text(robot_urdf_xml, encoding="utf-8")

    copied_files = 0
    bundled: tuple[BundledMeshAsset, ...] = ()
    bundled_mesh_path = None
    if bundled_mesh_content is not None:
        copied_files = 1
        bundled_mesh_path = robot_dir / "assets" / "demo_description" / "base.stl"
        bundled_mesh_path.parent.mkdir(parents=True)
        bundled_mesh_path.write_bytes(bundled_mesh_content)
        bundled = (
            BundledMeshAsset(
                original="package://demo_description/meshes/base.stl",
                rewritten="assets/demo_description/base.stl",
                source_path="/tmp/source/base.stl",
                target_path=str(bundled_mesh_path),
            ),
        )

    prepared = PreparedSimulatorWorkspace(
        workspace_dir=workspace_dir,
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        bundle_result=BundleMeshAssetsResult(
            success=True,
            content=robot_urdf_xml,
            out_path=str(robot_urdf_path),
            assets_root=str(robot_dir / "assets"),
            copied_files=copied_files,
            bundled=bundled,
            unresolved=(),
            error=None,
        ),
        robot_urdf_xml=robot_urdf_xml,
    )
    return PreparedMujocoWorkspaceFixture(
        prepared=prepared,
        robot_dir=robot_dir,
        robot_urdf_path=robot_urdf_path,
        bundled_mesh_path=bundled_mesh_path,
    )


def _conversion_result(mjcf_content: str, *, warnings: tuple[str, ...] = ()) -> MjcfConversionResult:
    return MjcfConversionResult(
        mjcf_content=mjcf_content,
        warnings=warnings,
        diagnostics=(
            MjcfConversionDiagnostic(
                code="mjcf.inertial.regularized",
                severity="warning",
                link_name="arm_link",
                message='Regularized invalid inertial for link "arm_link" during MJCF export.',
            ),
        ),
        stats=MjcfConversionStats(
            bodies_created=1,
            joints_converted=0,
            geometries_converted=0,
        ),
    )


def test_prepare_mujoco_workspace_converts_bundled_urdf_to_mjcf(
    monkeypatch,
    tmp_path: Path,
) -> None:
    fixture = _make_prepared_workspace_fixture(
        tmp_path,
        bundled_mesh_content=b"solid base\nendsolid base\n",
    )

    monkeypatch.setattr(
        mujoco_adapter,
        "prepare_simulator_workspace_package",
        lambda *args, **kwargs: fixture.prepared,
    )
    monkeypatch.setattr(
        mujoco_adapter,
        "convert_urdf_to_mjcf",
        lambda urdf_xml: _conversion_result(
            (
                "<?xml version=\"1.0\"?>\n"
                "<mujoco model=\"demo\"><compiler meshdir=\"meshes\"/></mujoco>\n"
            ),
        ),
    )

    result = mujoco_adapter.prepare_mujoco_workspace(_request(), simulator_id="mujoco")

    assert result.shared_workspace is fixture.prepared
    assert result.mjcf_path == fixture.robot_dir / "robot.xml"
    assert "<mujoco" in result.mjcf_path.read_text(encoding="utf-8")
    assert fixture.bundled_mesh_path is not None
    assert (
        fixture.robot_dir / "meshes" / "base.stl"
    ).read_bytes() == fixture.bundled_mesh_path.read_bytes()


def test_prepare_mujoco_workspace_stages_raw_converter_output(monkeypatch, tmp_path: Path) -> None:
    fixture = _make_prepared_workspace_fixture(tmp_path)

    monkeypatch.setattr(
        mujoco_adapter,
        "prepare_simulator_workspace_package",
        lambda *args, **kwargs: fixture.prepared,
    )
    monkeypatch.setattr(
        mujoco_adapter,
        "convert_urdf_to_mjcf",
        lambda urdf_xml: _conversion_result(
            DEMO_MJCF,
            warnings=("plain string warning",),
        ),
    )

    result = mujoco_adapter.prepare_mujoco_workspace(_request(), simulator_id="mujoco")

    assert result.mjcf_path.read_text(encoding="utf-8") == DEMO_MJCF


def test_prepare_mujoco_workspace_converts_materialized_robot_urdf_xml(
    monkeypatch,
    tmp_path: Path,
) -> None:
    materialized_urdf = """
    <robot name="demo">
      <link name="base">
        <visual>
          <geometry>
            <box size="0.1 0.1 0.1"/>
          </geometry>
          <material name="painted_red">
            <color rgba="0.8 0.1 0.1 1.0"/>
          </material>
        </visual>
      </link>
    </robot>
    """
    fixture = _make_prepared_workspace_fixture(tmp_path, robot_urdf_xml=materialized_urdf)
    observed: dict[str, str] = {}

    monkeypatch.setattr(
        mujoco_adapter,
        "prepare_simulator_workspace_package",
        lambda *args, **kwargs: fixture.prepared,
    )

    def _fake_convert_urdf_to_mjcf(urdf_xml: str) -> MjcfConversionResult:
        observed["urdf_xml"] = urdf_xml
        return _conversion_result(DEMO_MJCF)

    monkeypatch.setattr(mujoco_adapter, "convert_urdf_to_mjcf", _fake_convert_urdf_to_mjcf)

    mujoco_adapter.prepare_mujoco_workspace(_request(), simulator_id="mujoco")

    assert observed["urdf_xml"] == materialized_urdf
    assert 'rgba="0.8 0.1 0.1 1.0"' in observed["urdf_xml"]


@pytest.mark.parametrize(
    "simulator_id,simulator_label,expected_module_name",
    [
        ("mujoco", "MuJoCo", MUJOCO_WORKSPACE_PROCESS_PARAMS.module_name),
        ("mjlab", "MJLab", MJLAB_WORKSPACE_PROCESS_PARAMS.module_name),
    ],
)
def test_start_mujoco_workspace_passes_canonical_urdf_to_viewer(
    monkeypatch,
    tmp_path: Path,
    simulator_id: str,
    simulator_label: str,
    expected_module_name: str,
) -> None:
    fixture = _make_prepared_workspace_fixture(tmp_path)
    robot_mjcf_path = fixture.robot_dir / "robot.xml"
    robot_mjcf_path.write_text(DEMO_MJCF, encoding="utf-8")

    class _FakeProcess:
        pid = 4321

        def poll(self) -> None:
            return None

    monkeypatch.setattr(
        mujoco_adapter,
        "prepare_mujoco_workspace",
        lambda request, *, simulator_id: mujoco_adapter.PreparedMujocoWorkspace(
            shared_workspace=fixture.prepared,
            mjcf_path=robot_mjcf_path,
        ),
    )
    monkeypatch.setattr(
        workspace_process.subprocess,
        "Popen",
        lambda *args, **kwargs: _FakeProcess(),
    )
    monkeypatch.setattr(
        workspace_process.simulator_acceleration,
        "build_simulator_workspace_env",
        lambda cache_root, *, simulator_id=None: {},
    )
    monkeypatch.setattr(workspace_process, "wait_for_workspace_readiness", lambda *args, **kwargs: None)

    response = mujoco_adapter.start_mujoco_workspace(
        _request(),
        simulator_id=simulator_id,
        simulator_label=simulator_label,
    )

    assert response.simulator_id == simulator_id
    assert response.pid == 4321
    assert response.command[response.command.index("-m") + 1] == expected_module_name
    assert response.simulator_asset_path == str(robot_mjcf_path)
    assert "--robot-mjcf" in response.command
    assert "--robot-urdf" in response.command
    assert response.command[response.command.index("--simulator-id") + 1] == simulator_id
    assert response.command[response.command.index("--frame-map") + 1] == WORKSPACE_LAUNCH_FRAME_MAP
    assert str(fixture.robot_urdf_path) in response.command


def test_stage_mjcf_mesh_assets_disambiguates_duplicate_basenames(tmp_path: Path) -> None:
    first_mesh = tmp_path / "first" / "base.stl"
    second_mesh = tmp_path / "second" / "base.stl"
    first_mesh.parent.mkdir()
    second_mesh.parent.mkdir()
    first_mesh.write_bytes(b"solid first\nendsolid first\n")
    second_mesh.write_bytes(b"solid second\nendsolid second\n")

    mjcf_path = tmp_path / "robot.xml"
    mjcf_path.write_text(
        '<mujoco><asset>'
        '<mesh name="assets_first_base" file="base.stl"/>'
        '<mesh name="assets_second_base" file="base.stl"/>'
        '</asset></mujoco>',
        encoding="utf-8",
    )

    bundle_result = BundleMeshAssetsResult(
        success=True,
        content="<robot name=\"demo\"/>",
        out_path=str(tmp_path / "robot.urdf"),
        assets_root=str(tmp_path),
        copied_files=2,
        bundled=(
            BundledMeshAsset(
                original="first/base.stl",
                rewritten="assets/first/base.stl",
                source_path=str(first_mesh),
                target_path=str(first_mesh),
            ),
            BundledMeshAsset(
                original="second/base.stl",
                rewritten="assets/second/base.stl",
                source_path=str(second_mesh),
                target_path=str(second_mesh),
            ),
        ),
        unresolved=(),
        error=None,
    )

    mujoco_adapter._stage_mjcf_mesh_assets(bundle_result, mjcf_path)

    mesh_dir = mjcf_path.parent / "meshes"
    staged = sorted(p.name for p in mesh_dir.iterdir())
    assert staged == ["first__base.stl", "second__base.stl"]
    mjcf_content = mjcf_path.read_text(encoding="utf-8")
    assert 'name="assets_first_base" file="first__base.stl"' in mjcf_content
    assert 'name="assets_second_base" file="second__base.stl"' in mjcf_content


def test_build_staged_mesh_name_map_adds_suffix_for_duplicate_generated_names(tmp_path: Path) -> None:
    robot_dir = tmp_path / "robot"
    first_mesh = tmp_path / "first" / "shared" / "base.stl"
    second_mesh = tmp_path / "second" / "shared" / "base.stl"

    staged_name_by_source = mujoco_adapter._build_staged_mesh_name_map(
        {
            "base.stl": [first_mesh, second_mesh],
        },
        robot_dir=robot_dir,
    )

    assert staged_name_by_source[first_mesh] == "shared__base.stl"
    assert staged_name_by_source[second_mesh] == "shared__base__2.stl"


def test_plan_staged_mjcf_mesh_assets_builds_mesh_name_rewrite_map(tmp_path: Path) -> None:
    first_mesh = tmp_path / "first" / "base.stl"
    second_mesh = tmp_path / "second" / "base.stl"
    first_mesh.parent.mkdir()
    second_mesh.parent.mkdir()
    first_mesh.write_bytes(b"solid first\nendsolid first\n")
    second_mesh.write_bytes(b"solid second\nendsolid second\n")

    bundle_result = BundleMeshAssetsResult(
        success=True,
        content="<robot name=\"demo\"/>",
        out_path=str(tmp_path / "robot.urdf"),
        assets_root=str(tmp_path),
        copied_files=2,
        bundled=(
            BundledMeshAsset(
                original="first/base.stl",
                rewritten="assets/first/base.stl",
                source_path=str(first_mesh),
                target_path=str(first_mesh),
            ),
            BundledMeshAsset(
                original="second/base.stl",
                rewritten="assets/second/base.stl",
                source_path=str(second_mesh),
                target_path=str(second_mesh),
            ),
        ),
        unresolved=(),
        error=None,
    )

    plan = mujoco_adapter._plan_staged_mjcf_mesh_assets(
        bundle_result,
        robot_dir=tmp_path,
    )

    assert plan.staged_name_by_source[first_mesh] == "first__base.stl"
    assert plan.staged_name_by_source[second_mesh] == "second__base.stl"
    assert plan.staged_name_by_mjcf_mesh_name == {
        "assets_first_base": "first__base.stl",
        "assets_second_base": "second__base.stl",
    }


def test_apply_mjcf_workspace_repairs_removes_invalid_frame_body_inertial() -> None:
    mjcf = """
    <mujoco model="demo">
      <worldbody>
        <body name="gripper_frame_link">
          <inertial mass="0" fullinertia="0 0 0 0 0 0"/>
        </body>
      </worldbody>
    </mujoco>
    """

    sanitized, warnings = mujoco_adapter.apply_mjcf_workspace_repairs(mjcf)

    assert 'name="gripper_frame_link"' in sanitized
    assert "<inertial" not in sanitized
    assert warnings == ("Workspace repair removed invalid frame inertial from MJCF body 'gripper_frame_link'.",)


def test_apply_mjcf_workspace_repairs_regularizes_invalid_dynamic_body_inertial() -> None:
    mjcf = """
    <mujoco model="demo">
      <worldbody>
        <body name="dynamic_link">
          <joint name="hinge" type="hinge" axis="0 0 1"/>
          <geom type="box" size="0.01 0.01 0.01"/>
          <inertial mass="0" fullinertia="0 0 0 0 0 0"/>
        </body>
      </worldbody>
    </mujoco>
    """

    sanitized, warnings = mujoco_adapter.apply_mjcf_workspace_repairs(mjcf)

    assert 'mass="1e-09"' in sanitized
    assert 'diaginertia="1e-12 1e-12 1e-12"' in sanitized
    assert "fullinertia=" not in sanitized
    assert warnings == ("Workspace repair regularized invalid inertial on MJCF body 'dynamic_link'.",)


def test_apply_mjcf_workspace_repairs_preserves_or_defaults_inertial_pos() -> None:
    mjcf = """
    <mujoco model="demo">
      <worldbody>
        <body name="dynamic_link">
          <joint name="hinge" type="hinge" axis="0 0 1"/>
          <geom type="box" size="0.01 0.01 0.01"/>
          <inertial mass="0" fullinertia="0 0 0 0 0 0"/>
        </body>
        <body name="dynamic_link_with_pos">
          <joint name="hinge2" type="hinge" axis="0 0 1"/>
          <geom type="box" size="0.01 0.01 0.01"/>
          <inertial pos="0.1 0.2 0.3" mass="0" fullinertia="0 0 0 0 0 0"/>
        </body>
      </worldbody>
    </mujoco>
    """

    sanitized, _warnings = mujoco_adapter.apply_mjcf_workspace_repairs(mjcf)

    assert 'name="dynamic_link"' in sanitized
    assert 'pos="0 0 0"' in sanitized
    assert 'pos="0.1 0.2 0.3"' in sanitized


def test_mujoco_scene_bounds_fits_compiled_robot_and_workspace_objects() -> None:
    mujoco = pytest.importorskip("mujoco")
    model = mujoco.MjModel.from_xml_string(
        """
        <mujoco model="bounds">
          <worldbody>
            <geom name="robot" type="box" pos="0 0 0.2" size="0.1 0.1 0.2"/>
            <geom name="workspace_object" type="sphere" pos="1 0 0.2" size="0.15"/>
            <geom name="reference_floor" type="plane" pos="0 0 0" size="10 10 0.1"/>
          </worldbody>
        </mujoco>
        """
    )
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)

    bounds = mujoco_scene_bounds(mujoco, model, data)

    assert bounds.geom_count == 2
    assert bounds.center_xyz[0] > 0.3
    assert bounds.radius_m >= 0.35
    assert bounds.min_xyz[0] < 0.0
    assert bounds.max_xyz[0] > 1.0


def test_configure_mujoco_passive_viewer_sets_fit_camera_and_visual_groups() -> None:
    mujoco = pytest.importorskip("mujoco")
    model = mujoco.MjModel.from_xml_string(
        """
        <mujoco model="viewer">
          <worldbody>
            <geom name="robot_visual" group="1" type="box" pos="0.5 0 0.2" size="0.1 0.1 0.2"/>
          </worldbody>
        </mujoco>
        """
    )
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)

    class _Viewer:
        cam = mujoco.MjvCamera()
        opt = mujoco.MjvOption()

    viewer = _Viewer()
    viewer.opt.geomgroup[:] = 0

    bounds = configure_mujoco_passive_viewer(mujoco, model, data, viewer)

    assert tuple(float(value) for value in viewer.cam.lookat) == bounds.center_xyz
    assert viewer.cam.distance >= 1.0
    assert viewer.cam.azimuth == MUJOCO_SCENE_PARAMS.viewer.azimuth_deg
    assert viewer.cam.elevation == MUJOCO_SCENE_PARAMS.viewer.elevation_deg
    assert list(viewer.opt.geomgroup[:3]) == [1, 1, 1]
