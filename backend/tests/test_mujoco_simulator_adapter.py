from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from backend.models.simulator_runtime import SimulatorWorldOpenRequest
from backend.models.world_scene_package import (
    WorldInterfaceSpec,
    WorldScenePackageManifest,
    WorldSnapshot,
)
from backend.services.ilu_urdf import (
    BundleMeshAssetsResult,
    BundledMeshAsset,
    MjcfConversionResult,
    MjcfConversionStats,
)
from backend.services.simulator_adapters import mujoco as mujoco_adapter
from backend.services.simulator_adapters.launch_package import PreparedSimulatorLaunch


def _request() -> SimulatorWorldOpenRequest:
    return SimulatorWorldOpenRequest(
        world_package=WorldScenePackageManifest(
            package_id="demo_world",
            version="1.0.0",
            title="Demo World",
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            interface=WorldInterfaceSpec(
                observation_modalities=["state"],
                action_semantics="joint_position",
                timestep_ms=10,
                frame_convention="ros-rep-103",
            ),
            world_snapshot=WorldSnapshot(
                urdf_xml="<robot name=\"demo\"><link name=\"base\"/></robot>",
                joint_positions={},
                objects=[],
                scenario_time_ms=0,
                scenario_duration_ms=0,
            ),
        )
    )


def test_prepare_mujoco_launch_converts_bundled_urdf_to_mjcf(
    monkeypatch,
    tmp_path: Path,
) -> None:
    launch_dir = tmp_path / "launch"
    robot_dir = launch_dir / "robot"
    robot_dir.mkdir(parents=True)
    world_package_path = launch_dir / "world-package.json"
    world_package_path.write_text("{}", encoding="utf-8")
    robot_urdf_path = robot_dir / "robot.urdf"
    robot_urdf_path.write_text("<robot name=\"demo\"><link name=\"base\"/></robot>", encoding="utf-8")
    bundled_mesh_path = robot_dir / "assets" / "demo_description" / "base.stl"
    bundled_mesh_path.parent.mkdir(parents=True)
    bundled_mesh_path.write_bytes(b"solid base\nendsolid base\n")

    prepared = PreparedSimulatorLaunch(
        launch_dir=launch_dir,
        world_package_path=world_package_path,
        robot_urdf_path=robot_urdf_path,
        bundle_result=BundleMeshAssetsResult(
            success=True,
            content=robot_urdf_path.read_text(encoding="utf-8"),
            out_path=str(robot_urdf_path),
            assets_root=str(robot_dir / "assets"),
            copied_files=1,
            bundled=(
                BundledMeshAsset(
                    original="package://demo_description/meshes/base.stl",
                    rewritten="assets/demo_description/base.stl",
                    source_path="/tmp/source/base.stl",
                    target_path=str(bundled_mesh_path),
                ),
            ),
            unresolved=(),
            error=None,
        ),
    )

    monkeypatch.setattr(
        mujoco_adapter,
        "prepare_simulator_launch_package",
        lambda *args, **kwargs: prepared,
    )
    monkeypatch.setattr(
        mujoco_adapter,
        "convert_urdf_to_mjcf",
        lambda urdf_xml: MjcfConversionResult(
            mjcf_content=(
                "<?xml version=\"1.0\"?>\n"
                "<mujoco model=\"demo\"><compiler meshdir=\"meshes\"/></mujoco>\n"
            ),
            warnings=(),
            stats=MjcfConversionStats(
                bodies_created=1,
                joints_converted=0,
                geometries_converted=0,
            ),
        ),
    )

    result = mujoco_adapter._prepare_mujoco_launch(_request(), simulator_id="mujoco")

    assert result.shared_launch is prepared
    assert result.mjcf_path == robot_dir / "robot.xml"
    assert result.mjcf_path.read_text(encoding="utf-8").startswith("<mujoco")
    assert (robot_dir / "meshes" / "base.stl").read_bytes() == bundled_mesh_path.read_bytes()


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

    with pytest.raises(mujoco_adapter.MujocoWorldLaunchError, match="duplicate mesh basenames"):
        mujoco_adapter._stage_mjcf_mesh_assets(bundle_result, tmp_path / "robot.xml")


def test_sanitize_mjcf_inertials_removes_invalid_frame_body_inertial() -> None:
    mjcf = """
    <mujoco model="demo">
      <worldbody>
        <body name="gripper_frame_link">
          <inertial mass="0" fullinertia="0 0 0 0 0 0"/>
        </body>
      </worldbody>
    </mujoco>
    """

    sanitized, warnings = mujoco_adapter.sanitize_mjcf_inertials(mjcf)

    assert 'name="gripper_frame_link"' in sanitized
    assert "<inertial" not in sanitized
    assert warnings == ("Removed invalid frame inertial from MJCF body 'gripper_frame_link'.",)


def test_sanitize_mjcf_inertials_regularizes_invalid_dynamic_body_inertial() -> None:
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

    sanitized, warnings = mujoco_adapter.sanitize_mjcf_inertials(mjcf)

    assert 'mass="1e-09"' in sanitized
    assert 'diaginertia="1e-12 1e-12 1e-12"' in sanitized
    assert "fullinertia=" not in sanitized
    assert warnings == ("Regularized invalid inertial on MJCF body 'dynamic_link'.",)
