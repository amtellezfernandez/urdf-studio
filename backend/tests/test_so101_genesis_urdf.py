from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

from backend.services.so101_genesis_urdf import (
    SO101_FIXED_GRIPPER_BODY_NAME,
    SO101_FIXED_GRIPPER_PAD_NAME,
    SO101_MOVING_GRIPPER_PAD_NAME,
    materialize_so101_genesis_urdf,
)


def test_materialize_so101_genesis_urdf_adds_gripper_collision_pads(
    tmp_path: Path,
) -> None:
    asset_dir = tmp_path / "assets"
    asset_dir.mkdir()
    (asset_dir / "finger.stl").write_text("solid finger\nendsolid finger\n", encoding="utf-8")
    urdf_path = tmp_path / "so101.urdf"
    urdf_path.write_text(
        """
<robot name="so101">
  <link name="gripper_link">
    <visual>
      <geometry>
        <mesh filename="assets/finger.stl" />
      </geometry>
    </visual>
    <collision>
      <geometry>
        <mesh filename="assets/finger.stl" />
      </geometry>
    </collision>
  </link>
  <link name="moving_jaw_so101_v1_link" />
</robot>
""".strip(),
        encoding="utf-8",
    )

    output = materialize_so101_genesis_urdf(
        urdf_path,
        output_dir=tmp_path / "cache",
    )

    assert output != urdf_path
    root = ET.parse(output).getroot()
    collisions = {
        collision.get("name")
        for collision in root.findall(".//collision")
        if collision.get("name")
    }
    assert SO101_FIXED_GRIPPER_PAD_NAME in collisions
    assert SO101_FIXED_GRIPPER_BODY_NAME in collisions
    assert SO101_MOVING_GRIPPER_PAD_NAME in collisions
    fixed_pad = root.find(f".//collision[@name='{SO101_FIXED_GRIPPER_PAD_NAME}']")
    fixed_body = root.find(f".//collision[@name='{SO101_FIXED_GRIPPER_BODY_NAME}']")
    moving_pad = root.find(f".//collision[@name='{SO101_MOVING_GRIPPER_PAD_NAME}']")
    assert fixed_pad is not None
    assert fixed_body is not None
    assert moving_pad is not None
    assert fixed_pad.find("origin").attrib["xyz"] == "-0.0026 -0.0020 -0.0770"
    assert fixed_pad.find("geometry/box").attrib["size"] == "0.070 0.056 0.060"
    assert fixed_body.find("origin").attrib["xyz"] == "-0.0026 -0.0020 -0.0517"
    assert fixed_body.find("geometry/box").attrib["size"] == "0.068 0.056 0.108"
    assert moving_pad.find("origin").attrib["xyz"] == "-0.0012 -0.0360 0.0189"
    assert moving_pad.find("geometry/box").attrib["size"] == "0.030 0.095 0.052"
    gripper_link = root.find("link[@name='gripper_link']")
    assert gripper_link is not None
    assert gripper_link.findall("collision") == [fixed_pad, fixed_body]
    moving_jaw_link = root.find("link[@name='moving_jaw_so101_v1_link']")
    assert moving_jaw_link is not None
    assert moving_jaw_link.findall("collision") == [moving_pad]
    mesh = root.find(".//mesh")
    assert mesh is not None
    assert Path(mesh.attrib["filename"]).is_absolute()


def test_materialize_so101_genesis_urdf_leaves_other_urdfs_unchanged(
    tmp_path: Path,
) -> None:
    urdf_path = tmp_path / "other.urdf"
    urdf_path.write_text(
        """
<robot name="other">
  <link name="base_link" />
</robot>
""".strip(),
        encoding="utf-8",
    )

    output = materialize_so101_genesis_urdf(
        urdf_path,
        output_dir=tmp_path / "cache",
    )

    assert output == urdf_path.resolve()
