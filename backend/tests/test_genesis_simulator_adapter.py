from __future__ import annotations

import base64
import os
import shutil
from dataclasses import replace
from pathlib import Path
import xml.etree.ElementTree as ET

import pytest

from backend.core.paths import BASE_DIR
from backend.models.simulator_runtime import SimulatorMeshAssetUpload, SimulatorWorldOpenRequest
from backend.tests.simulator_adapter_test_utils import make_world_package
from backend.services.ilu_urdf import BundleMeshAssetsResult, BundledMeshAsset
from backend.services.simulator_adapters import genesis as genesis_adapter
from backend.services.simulator_adapters import launch_package
from backend.scripts.genesis_world_open import _robot_urdf_morph_kwargs


def test_genesis_robot_morph_prefers_staged_urdf_materials(tmp_path: Path) -> None:
    robot_urdf_path = tmp_path / "robot.urdf"
    robot_urdf_path.write_text("<robot name=\"demo\"><link name=\"base\"/></robot>", encoding="utf-8")

    kwargs = _robot_urdf_morph_kwargs(robot_urdf_path)

    assert kwargs["file"] == str(robot_urdf_path.resolve())
    assert kwargs["prioritize_urdf_material"] is True
    assert kwargs["merge_fixed_links"] is False


def test_prepare_genesis_launch_adds_fallback_visual_material_colors(
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
</robot>
""".strip()
    request = SimulatorWorldOpenRequest(
        world_package=make_world_package(urdf_xml),
    )
    monkeypatch.setattr(
        genesis_adapter,
        "GENESIS_LAUNCH_PARAMS",
        replace(genesis_adapter.GENESIS_LAUNCH_PARAMS, launch_root=tmp_path),
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
        launch_package,
        "bundle_mesh_assets_for_urdf_file",
        _fake_bundle_mesh_assets_for_urdf_file,
    )

    prepared = genesis_adapter.prepare_genesis_launch(request)
    root = ET.parse(prepared.robot_urdf_path).getroot()
    wheel_color = root.find("./link[@name='left_wheel']/visual/material/color")

    assert wheel_color is not None
    assert wheel_color.get("rgba") == "0.04 0.045 0.05 1.0"


@pytest.mark.skipif(
    os.getenv("URDF_STUDIO_RUN_GENESIS_TESTS") != "1",
    reason="Set URDF_STUDIO_RUN_GENESIS_TESTS=1 to run Genesis headless scene build.",
)
def test_genesis_renders_prepared_lekiwi_visual_material_colors(tmp_path: Path) -> None:
    pytest.importorskip("genesis")
    import genesis as gs

    demo_dir = BASE_DIR / "web" / "public" / "demo"
    robot_urdf_path = tmp_path / "lekiwi.urdf"
    mesh_dir = tmp_path / "meshes"
    robot_urdf_path.write_text((demo_dir / "lekiwi.urdf").read_text(encoding="utf-8"), encoding="utf-8")
    shutil.copytree(demo_dir / "meshes", mesh_dir)
    launch_package._prepare_urdf_visual_material_colors(robot_urdf_path)

    try:
        gs.init(backend=gs.cpu, logging_level="warning")
    except Exception as exc:
        if "already" not in str(exc).lower() and "initialized" not in str(exc).lower():
            raise

    scene = gs.Scene(show_viewer=False)
    entity = scene.add_entity(
        gs.morphs.URDF(**_robot_urdf_morph_kwargs(robot_urdf_path)),
        name="lekiwi_probe",
    )
    scene.build()
    visual_colors = {
        tuple(round(float(channel), 3) for channel in color[:3])
        for vgeom in getattr(entity, "vgeoms", [])
        for surface in [getattr(vgeom, "surface", None)]
        for texture in [getattr(surface, "diffuse_texture", None)]
        for color in [getattr(texture, "color", None)]
        if color is not None
    }

    assert (0.04, 0.045, 0.05) in visual_colors
    assert (0.45, 0.48, 0.52) in visual_colors
    assert (0.66, 0.69, 0.64) in visual_colors


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

    prepared = genesis_adapter.prepare_genesis_launch(request)
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
        world_package=make_world_package("<robot name=\"demo\"><link name=\"base\"/></robot>"),
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
        genesis_adapter.prepare_genesis_launch(request)
