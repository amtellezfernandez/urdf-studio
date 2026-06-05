from __future__ import annotations

import xml.etree.ElementTree as ET

from backend.services.simulation_prep_mujoco import _rewrite_mesh_paths_to_basenames


def test_rewrite_mesh_paths_to_basenames_covers_visual_and_collision_meshes() -> None:
    rewritten = _rewrite_mesh_paths_to_basenames(
        """
        <robot name="demo">
          <link name="base">
            <visual>
              <geometry>
                <mesh filename="package://demo/meshes/base_visual.stl"/>
              </geometry>
            </visual>
            <collision>
              <geometry>
                <mesh filename="meshes/base_collision.stl"/>
              </geometry>
            </collision>
          </link>
        </robot>
        """
    )

    root = ET.fromstring(rewritten)
    filenames = [mesh.get("filename") for mesh in root.findall(".//mesh")]

    assert filenames == ["base_visual.stl", "base_collision.stl"]
