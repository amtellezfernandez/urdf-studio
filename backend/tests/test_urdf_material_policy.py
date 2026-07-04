from __future__ import annotations

import xml.etree.ElementTree as ET

import pytest

from backend.services.simulator_adapters.urdf_material_policy import (
    UrdfMaterialPolicy,
    load_urdf_material_policy,
    materialize_urdf_visual_material_colors,
    stable_palette_index,
    synthetic_urdf_material_name,
    synthetic_urdf_visual_rgba,
    urdf_visual_fingerprint,
)


def test_synthetic_urdf_material_name_sanitizes_link_names() -> None:
    assert (
        synthetic_urdf_material_name(" left wheel/link ", 2)
        == "urdf_studio_left_wheel_link_2"
    )
    assert synthetic_urdf_material_name("  ", 0) == "urdf_studio_visual_0"


def test_materialize_urdf_visual_material_colors_inlines_named_materials(tmp_path) -> None:
    urdf_path = tmp_path / "robot.urdf"
    urdf_path.write_text(
        """
        <robot name="demo">
          <material name="painted_red">
            <color rgba="0.8 0.1 0.1 1.0"/>
          </material>
          <link name="base">
            <visual>
              <geometry>
                <box size="0.1 0.1 0.1"/>
              </geometry>
              <material name="painted_red"/>
            </visual>
          </link>
        </robot>
        """,
        encoding="utf-8",
    )

    assert materialize_urdf_visual_material_colors(urdf_path) == 1

    root = ET.parse(urdf_path).getroot()
    color = root.find("./link[@name='base']/visual/material/color")
    assert color is not None
    assert color.get("rgba") == "0.8 0.1 0.1 1.0"


def test_materialize_urdf_visual_material_colors_preserves_inline_colors(tmp_path) -> None:
    urdf_path = tmp_path / "robot.urdf"
    urdf_path.write_text(
        """
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
        """,
        encoding="utf-8",
    )

    assert materialize_urdf_visual_material_colors(urdf_path) == 0

    root = ET.parse(urdf_path).getroot()
    assert len(root.findall("./link/visual/material/color")) == 1


def test_materialize_urdf_visual_material_colors_accepts_injected_policy(tmp_path) -> None:
    urdf_path = tmp_path / "robot.urdf"
    urdf_path.write_text(
        """
        <robot name="demo">
          <link name="base">
            <visual>
              <geometry>
                <mesh filename="meshes/base.stl"/>
              </geometry>
            </visual>
          </link>
        </robot>
        """,
        encoding="utf-8",
    )
    policy = UrdfMaterialPolicy(
        synthetic_color_palette=("0.1 0.2 0.3 1.0",),
        semantic_synthetic_colors=(),
        fnv1a32_offset_basis=2166136261,
        fnv1a32_prime=16777619,
    )

    assert materialize_urdf_visual_material_colors(urdf_path, policy=policy) == 1

    root = ET.parse(urdf_path).getroot()
    color = root.find("./link[@name='base']/visual/material/color")
    assert color is not None
    assert color.get("rgba") == "0.1 0.2 0.3 1.0"


def test_synthetic_urdf_visual_rgba_uses_semantic_terms() -> None:
    assert (
        synthetic_urdf_visual_rgba(
            link_name="front_wheel",
            visual_name="",
            visual_index=0,
            mesh_filename="meshes/front_wheel.stl",
        )
        == "0.04 0.045 0.05 1.0"
    )
    assert (
        synthetic_urdf_visual_rgba(
            link_name="base_link",
            visual_name="shell",
            visual_index=0,
            mesh_filename="meshes/chassis/base_shell.stl",
        )
        == "0.66 0.69 0.64 1.0"
    )


def test_synthetic_urdf_visual_rgba_uses_stable_palette_for_unclassified_visuals() -> None:
    first = synthetic_urdf_visual_rgba(
        link_name="decor",
        visual_name="accent",
        visual_index=1,
        mesh_filename="meshes/accent.stl",
    )
    second = synthetic_urdf_visual_rgba(
        link_name="decor",
        visual_name="accent",
        visual_index=1,
        mesh_filename="meshes/accent.stl",
    )

    assert first == second


def test_synthetic_urdf_visual_rgba_accepts_injected_policy() -> None:
    policy = UrdfMaterialPolicy(
        synthetic_color_palette=("0.1 0.2 0.3 1.0",),
        semantic_synthetic_colors=((("special",), "0.9 0.8 0.7 1.0"),),
        fnv1a32_offset_basis=2166136261,
        fnv1a32_prime=16777619,
    )

    assert (
        synthetic_urdf_visual_rgba(
            link_name="special_link",
            visual_name="",
            visual_index=0,
            mesh_filename="meshes/base.stl",
            policy=policy,
        )
        == "0.9 0.8 0.7 1.0"
    )


def test_urdf_visual_fingerprint_omits_empty_fields() -> None:
    assert (
        urdf_visual_fingerprint(
            link_name="base",
            visual_name="",
            visual_index=0,
            mesh_filename="meshes/base.stl",
        )
        == "base 0 meshes/base.stl"
    )


def test_stable_palette_index_rejects_empty_palette() -> None:
    with pytest.raises(ValueError, match="palette_size must be positive"):
        stable_palette_index("base", 0)


def test_load_urdf_material_policy_rejects_empty_palette(tmp_path) -> None:
    policy_path = tmp_path / "policy.json"
    policy_path.write_text(
        """
        {
          "syntheticColorPalette": [],
          "semanticSyntheticColors": [
            {"terms": ["base"], "rgba": [0.1, 0.2, 0.3, 1.0]}
          ],
          "fnv1a32OffsetBasis": 2166136261,
          "fnv1a32Prime": 16777619
        }
        """,
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="syntheticColorPalette"):
        load_urdf_material_policy(policy_path)


def test_load_urdf_material_policy_rejects_non_object_root(tmp_path) -> None:
    policy_path = tmp_path / "policy.json"
    policy_path.write_text("[]", encoding="utf-8")

    with pytest.raises(ValueError, match="must be a JSON object"):
        load_urdf_material_policy(policy_path)


def test_load_urdf_material_policy_rejects_non_string_semantic_terms(tmp_path) -> None:
    policy_path = tmp_path / "policy.json"
    policy_path.write_text(
        """
        {
          "syntheticColorPalette": [[0.1, 0.2, 0.3, 1.0]],
          "semanticSyntheticColors": [
            {"terms": ["base", 42], "rgba": [0.1, 0.2, 0.3, 1.0]}
          ],
          "fnv1a32OffsetBasis": 2166136261,
          "fnv1a32Prime": 16777619
        }
        """,
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match=r"semanticSyntheticColors\[0\]\.terms\[1\]"):
        load_urdf_material_policy(policy_path)
