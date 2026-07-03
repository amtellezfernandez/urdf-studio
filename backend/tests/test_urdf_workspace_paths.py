from __future__ import annotations

import pytest

from backend.services.simulator_adapters.urdf_workspace_paths import (
    normalize_resolved_urdf_asset_path,
    normalize_root_relative_urdf_mesh_filenames,
)


@pytest.mark.parametrize(
    ("source_path", "expected_path"),
    (
        ("pkg/urdf/robot.urdf.xacro", "pkg/urdf/robot.urdf"),
        ("pkg/urdf/robot.xacro", "pkg/urdf/robot.urdf"),
        ("pkg/urdf/robot.urdf", "pkg/urdf/robot.urdf"),
        (None, "robot.urdf"),
    ),
)
def test_normalize_resolved_urdf_asset_path(source_path: str | None, expected_path: str) -> None:
    assert normalize_resolved_urdf_asset_path(source_path) == expected_path


def test_normalize_root_relative_urdf_mesh_filenames_rewrites_portable_refs() -> None:
    urdf_xml = """
    <robot name="demo">
      <link name="base">
        <visual><geometry><mesh filename="/meshes/base.stl"/></geometry></visual>
        <visual><geometry><mesh filename="/mesh/gripper.stl"/></geometry></visual>
        <visual><geometry><mesh filename="/models/bracket.stl"/></geometry></visual>
        <visual><geometry><mesh filename="/model/spacer.stl"/></geometry></visual>
        <visual><geometry><mesh filename="/assets/base.obj"/></geometry></visual>
        <visual><geometry><mesh filename="/cover.dae"/></geometry></visual>
        <visual><geometry><mesh filename="\\meshes\\wheel.stl"/></geometry></visual>
      </link>
    </robot>
    """

    normalized = normalize_root_relative_urdf_mesh_filenames(urdf_xml)

    assert 'filename="meshes/base.stl"' in normalized
    assert 'filename="mesh/gripper.stl"' in normalized
    assert 'filename="models/bracket.stl"' in normalized
    assert 'filename="model/spacer.stl"' in normalized
    assert 'filename="assets/base.obj"' in normalized
    assert 'filename="cover.dae"' in normalized
    assert 'filename="meshes/wheel.stl"' in normalized
    assert 'filename="/meshes/base.stl"' not in normalized


def test_normalize_root_relative_urdf_mesh_filenames_leaves_host_like_refs_unchanged() -> None:
    urdf_xml = """
    <robot name="demo">
      <link name="base">
        <visual><geometry><mesh filename="/workspace/base.stl"/></geometry></visual>
        <visual><geometry><mesh filename="package://demo/meshes/base.stl"/></geometry></visual>
        <visual><geometry><mesh filename="meshes/base.stl"/></geometry></visual>
      </link>
    </robot>
    """

    normalized = normalize_root_relative_urdf_mesh_filenames(urdf_xml)

    assert 'filename="/workspace/base.stl"' in normalized
    assert 'filename="package://demo/meshes/base.stl"' in normalized
    assert 'filename="meshes/base.stl"' in normalized


def test_normalize_root_relative_urdf_mesh_filenames_returns_invalid_xml_unchanged() -> None:
    urdf_xml = "<robot><link>"

    assert normalize_root_relative_urdf_mesh_filenames(urdf_xml) == urdf_xml
