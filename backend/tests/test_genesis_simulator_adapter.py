from __future__ import annotations

import base64
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import pytest

from backend.models.simulator_runtime import SimulatorMeshAssetUpload, SimulatorWorldOpenRequest
from backend.models.world_scene_package import (
    WorldInterfaceSpec,
    WorldScenePackageManifest,
    WorldSnapshot,
)
from backend.services.ilu_urdf import BundleMeshAssetsResult, BundledMeshAsset
from backend.services.simulator_adapters import genesis as genesis_adapter
from backend.services.simulator_adapters import launch_package


def _world_package(urdf_xml: str) -> WorldScenePackageManifest:
    return WorldScenePackageManifest(
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
            urdf_xml=urdf_xml,
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
            scenario_time_ms=0,
            scenario_duration_ms=0,
        ),
    )


def test_prepare_genesis_simulator_launch_bundles_uploaded_assets_and_package_roots(
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
    request = SimulatorWorldOpenRequest(
        world_package=_world_package(urdf_xml),
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
        genesis_adapter,
        "GENESIS_LAUNCH_PARAMS",
        replace(genesis_adapter.GENESIS_LAUNCH_PARAMS, launch_root=tmp_path),
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
        launch_package,
        "bundle_mesh_assets_for_urdf_file",
        _fake_bundle_mesh_assets_for_urdf_file,
    )

    prepared = genesis_adapter._prepare_genesis_launch(request)
    source_root = prepared.launch_dir / "source"

    assert prepared.world_package_path.exists()
    assert prepared.robot_urdf_path.exists()
    assert (source_root / "demo_description" / "package.xml").exists()
    assert (source_root / "demo_description" / "meshes" / "base.stl").read_bytes() == mesh_content
    assert prepared.bundle_result.copied_files == 1


def test_prepare_genesis_simulator_launch_rejects_failed_bundle(
    monkeypatch,
    tmp_path: Path,
) -> None:
    request = SimulatorWorldOpenRequest(
        world_package=_world_package("<robot name=\"demo\"><link name=\"base\"/></robot>"),
    )
    monkeypatch.setattr(
        genesis_adapter,
        "GENESIS_LAUNCH_PARAMS",
        replace(genesis_adapter.GENESIS_LAUNCH_PARAMS, launch_root=tmp_path),
    )

    def _fake_bundle_mesh_assets_for_urdf_file(**_kwargs) -> BundleMeshAssetsResult:
        return BundleMeshAssetsResult(
            success=False,
            content="",
            out_path="",
            assets_root="",
            copied_files=0,
            bundled=(),
            unresolved=(),
            error=None,
        )

    monkeypatch.setattr(
        launch_package,
        "bundle_mesh_assets_for_urdf_file",
        _fake_bundle_mesh_assets_for_urdf_file,
    )

    with pytest.raises(
        genesis_adapter.GenesisWorldLaunchError,
        match="could not bundle robot mesh assets",
    ):
        genesis_adapter._prepare_genesis_launch(request)
