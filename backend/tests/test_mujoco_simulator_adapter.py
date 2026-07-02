from __future__ import annotations

from dataclasses import dataclass
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
from backend.services.simulator_adapters.params import (
    MJLAB_WORKSPACE_PROCESS_PARAMS,
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


def _make_prepared_workspace_fixture(
    tmp_path: Path,
    *,
    bundled_mesh_content: bytes | None = None,
) -> PreparedMujocoWorkspaceFixture:
    workspace_dir = tmp_path / "workspace"
    robot_dir = workspace_dir / "robot"
    robot_dir.mkdir(parents=True)
    world_package_path = workspace_dir / "world-package.json"
    robot_urdf_path = robot_dir / "robot.urdf"
    world_package_path.write_text("{}", encoding="utf-8")
    robot_urdf_path.write_text(DEMO_URDF, encoding="utf-8")

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
            content=DEMO_URDF,
            out_path=str(robot_urdf_path),
            assets_root=str(robot_dir / "assets"),
            copied_files=copied_files,
            bundled=bundled,
            unresolved=(),
            error=None,
        ),
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
            warnings=("legacy string warning",),
        ),
    )

    result = mujoco_adapter.prepare_mujoco_workspace(_request(), simulator_id="mujoco")

    assert result.mjcf_path.read_text(encoding="utf-8") == DEMO_MJCF


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


def test_stage_mjcf_mesh_assets_rejects_duplicate_basenames(tmp_path: Path) -> None:
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

    with pytest.raises(mujoco_adapter.MujocoWorkspaceError, match="duplicate mesh basenames"):
        mujoco_adapter._stage_mjcf_mesh_assets(bundle_result, tmp_path / "robot.xml")


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
