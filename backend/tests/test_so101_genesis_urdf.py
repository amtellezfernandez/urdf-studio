from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

from backend.services.so101_genesis_urdf import (
    SO101_FIXED_GRIPPER_PAD_NAME,
    materialize_so101_genesis_urdf_report,
)


def _write_gripper_urdf(tmp_path: Path, *, robot_name: str, mesh_filename: str) -> Path:
    urdf_path = tmp_path / "robot.urdf"
    urdf_path.write_text(
        f"""
<robot name="{robot_name}">
  <link name="gripper_link">
    <visual>
      <geometry>
        <mesh filename="{mesh_filename}"/>
      </geometry>
    </visual>
  </link>
  <link name="moving_jaw_so101_v1_link"/>
</robot>
""".strip(),
        encoding="utf-8",
    )
    return urdf_path


def test_so101_genesis_repair_requires_so101_identity(tmp_path: Path) -> None:
    urdf_path = _write_gripper_urdf(
        tmp_path,
        robot_name="custom_gripper",
        mesh_filename="assets/custom_gripper.stl",
    )

    result = materialize_so101_genesis_urdf_report(
        urdf_path,
        output_dir=tmp_path / "cache",
    )

    assert result.applied is False
    assert result.path == urdf_path.resolve()


def test_so101_genesis_repair_applies_to_identified_so101(tmp_path: Path) -> None:
    urdf_path = _write_gripper_urdf(
        tmp_path,
        robot_name="so101_new_calib",
        mesh_filename="assets/moving_jaw_so101_v1.stl",
    )

    result = materialize_so101_genesis_urdf_report(
        urdf_path,
        output_dir=tmp_path / "cache",
    )

    assert result.applied is True
    root = ET.parse(result.path).getroot()
    gripper_link = root.find("./link[@name='gripper_link']")
    assert gripper_link is not None
    assert gripper_link.find(f"./collision[@name='{SO101_FIXED_GRIPPER_PAD_NAME}']") is not None
