from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
import xml.etree.ElementTree as ET

import pytest

from backend.services.simulation_prep_mujoco import (
    _rewrite_mesh_paths_to_basenames,
    run_simulation_prep_validation,
)
from backend.services.simulation_prep_mujoco_params import (
    SIMULATION_PREP_MUJOCO_DEFAULT_POSITION,
    SIMULATION_PREP_MUJOCO_STAGE_MJCF_FILENAME,
    SIMULATION_PREP_MUJOCO_STAGE_URDF_FILENAME,
)


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


def test_run_simulation_prep_validation_reports_expected_mujoco_validation_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.services import simulation_prep_mujoco

    class FakeFatalError(Exception):
        pass

    expectation = simulation_prep_mujoco.MujocoMeshGeometryExpectation(
        geom_name="base_collision",
        validation_geom_name="base_collision_validation",
        mesh_asset_name="base_collision_mesh",
        mesh_reference="meshes/base_collision.stl",
        mesh_file_name="base_collision.stl",
        mesh_file_path=Path("/tmp/base_collision.stl"),
        direct_mesh_name="base_collision_direct",
        position=SIMULATION_PREP_MUJOCO_DEFAULT_POSITION,
        quaternion=(1.0, 0.0, 0.0, 0.0),
        scale=(1.0, 1.0, 1.0),
    )

    monkeypatch.setitem(
        sys.modules,
        "mujoco",
        SimpleNamespace(FatalError=FakeFatalError, UnexpectedError=RuntimeError),
    )
    monkeypatch.setattr(
        simulation_prep_mujoco,
        "collect_urdf_collision_mesh_geometries",
        lambda _path: (expectation,),
    )
    monkeypatch.setattr(
        simulation_prep_mujoco,
        "load_mujoco_model",
        lambda path: (_ for _ in ()).throw(ValueError("invalid mesh asset"))
        if path.name == SIMULATION_PREP_MUJOCO_STAGE_MJCF_FILENAME
        else object(),
    )
    monkeypatch.setattr(
        simulation_prep_mujoco,
        "run_headless_smoke_simulation",
        lambda _model: (_ for _ in ()).throw(FakeFatalError("smoke simulation failed")),
    )

    report = run_simulation_prep_validation(
        "<robot name='demo'><link name='base'><collision><geometry><mesh filename='meshes/base_collision.stl'/></geometry></collision></link></robot>",
        {"base_collision.stl": b"solid base\nendsolid base\n"},
    )

    assert report.success is False
    assert report.mujoco_available is True
    assert report.geometry_count == 1
    assert report.geometries[0].error == "invalid mesh asset"
    assert report.smoke_simulation is not None
    assert report.smoke_simulation.passed is False
    assert report.smoke_simulation.error == "smoke simulation failed"


def test_run_simulation_prep_validation_propagates_unexpected_mujoco_runtime_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.services import simulation_prep_mujoco

    monkeypatch.setitem(
        sys.modules,
        "mujoco",
        SimpleNamespace(FatalError=ValueError, UnexpectedError=AssertionError),
    )
    monkeypatch.setattr(
        simulation_prep_mujoco,
        "collect_urdf_collision_mesh_geometries",
        lambda _path: (),
    )
    monkeypatch.setattr(
        simulation_prep_mujoco,
        "load_mujoco_model",
        lambda path: (_ for _ in ()).throw(RuntimeError(f"unexpected load failure: {path.name}"))
        if path.name == SIMULATION_PREP_MUJOCO_STAGE_URDF_FILENAME
        else object(),
    )

    with pytest.raises(RuntimeError, match="unexpected load failure"):
        run_simulation_prep_validation(
            "<robot name='demo'><link name='base'/></robot>",
            {},
        )


def test_run_simulation_prep_validation_reports_missing_mujoco_dependency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.services import simulation_prep_mujoco

    monkeypatch.setattr(
        simulation_prep_mujoco,
        "_mujoco_dependency_available",
        lambda: False,
    )
    monkeypatch.setattr(
        simulation_prep_mujoco,
        "collect_urdf_collision_mesh_geometries",
        lambda _path: (),
    )

    report = run_simulation_prep_validation(
        "<robot name='demo'><link name='base'/></robot>",
        {},
    )

    assert report.success is True
    assert report.mujoco_available is False
    assert report.warnings == [
        "MuJoCo is not installed. Install with: uv pip install --python .venv/bin/python3 mujoco"
    ]


def test_run_simulation_prep_validation_preserves_unexpected_mujoco_import_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.services import simulation_prep_mujoco

    monkeypatch.setattr(
        simulation_prep_mujoco,
        "_mujoco_dependency_available",
        lambda: True,
    )
    monkeypatch.setattr(
        simulation_prep_mujoco,
        "collect_urdf_collision_mesh_geometries",
        lambda _path: (),
    )
    monkeypatch.setattr(
        simulation_prep_mujoco.importlib,
        "import_module",
        lambda name: (_ for _ in ()).throw(ImportError("unexpected mujoco import failure")),
    )

    with pytest.raises(ImportError, match="unexpected mujoco import failure"):
        run_simulation_prep_validation(
            "<robot name='demo'><link name='base'/></robot>",
            {},
        )
