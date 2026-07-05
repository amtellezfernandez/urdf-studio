from __future__ import annotations

from pathlib import Path

import pytest

from backend.services.simulation_prep_mujoco import (
    collect_urdf_collision_mesh_geometries,
    prepare_mujoco_simulation_assets,
)
from backend.services.simulation_prep_mujoco_params import (
    SIMULATION_PREP_MUJOCO_DEFAULT_POSITION,
    SIMULATION_PREP_MUJOCO_DEFAULT_SCALE,
)


def _write_collision_mesh_urdf(
    tmp_path: Path,
    *,
    mesh_filename: str = "meshes/link.stl",
    origin_xyz: str = "0 0 0",
    origin_rpy: str = "0 0 0",
    mesh_scale: str = "1 1 1",
) -> Path:
    mesh_path = tmp_path / "meshes" / "link.stl"
    mesh_path.parent.mkdir(parents=True)
    mesh_path.write_text("solid link\nendsolid link\n", encoding="utf-8")

    urdf_path = tmp_path / "robot.urdf"
    urdf_path.write_text(
        f"""
<robot name="parser-test">
  <link name="base">
    <collision name="base_collision">
      <origin xyz="{origin_xyz}" rpy="{origin_rpy}" />
      <geometry>
        <mesh filename="{mesh_filename}" scale="{mesh_scale}" />
      </geometry>
    </collision>
  </link>
</robot>
""".strip(),
        encoding="utf-8",
    )
    return urdf_path


def test_collision_mesh_parser_uses_defaults_for_invalid_vectors(tmp_path: Path) -> None:
    urdf_path = _write_collision_mesh_urdf(
        tmp_path,
        origin_xyz="not a vector",
        origin_rpy="0 0",
        mesh_scale="bad scale",
    )

    geometry = collect_urdf_collision_mesh_geometries(urdf_path)[0]

    assert geometry.position == SIMULATION_PREP_MUJOCO_DEFAULT_POSITION
    assert geometry.quaternion == (1.0, 0.0, 0.0, 0.0)
    assert geometry.scale == SIMULATION_PREP_MUJOCO_DEFAULT_SCALE


def test_collision_mesh_parser_resolves_file_scheme_mesh_references(
    tmp_path: Path,
) -> None:
    mesh_path = tmp_path / "meshes" / "link.stl"
    urdf_path = _write_collision_mesh_urdf(
        tmp_path,
        mesh_filename=f"file://{mesh_path}",
    )

    geometry = collect_urdf_collision_mesh_geometries(urdf_path)[0]

    assert geometry.mesh_file_path == mesh_path.resolve()


def test_prepare_mujoco_simulation_assets_rejects_missing_collision_meshes(
    tmp_path: Path,
) -> None:
    urdf_path = tmp_path / "robot.urdf"
    urdf_path.write_text(
        """
<robot name="parser-test">
  <link name="base">
    <collision name="base_collision">
      <geometry>
        <box size="0.1 0.1 0.1" />
      </geometry>
    </collision>
  </link>
</robot>
""".strip(),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="does not contain any collision mesh geometries"):
        with prepare_mujoco_simulation_assets(urdf_path):
            pass
