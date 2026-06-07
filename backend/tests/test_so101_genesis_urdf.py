from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

from backend.services.so101_genesis_urdf import (
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
    assert SO101_MOVING_GRIPPER_PAD_NAME in collisions
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
