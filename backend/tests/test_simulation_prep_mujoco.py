from __future__ import annotations

import math
import os
import tempfile
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import pytest

from backend.core.paths import BASE_DIR
from backend.services.simulation_prep_mujoco import (
    collect_compiled_mesh_geometries,
    load_mujoco_model,
    prepare_mujoco_simulation_assets,
    quaternion_has_unit_norm,
    quaternions_match,
    run_headless_smoke_simulation,
    vectors_match,
)
from backend.services.simulation_prep_mujoco_params import (
    SIMULATION_PREP_MUJOCO_POSE_TOLERANCE,
    SIMULATION_PREP_MUJOCO_QUATERNION_NORM_TOLERANCE,
    SIMULATION_PREP_MUJOCO_SCALE_TOLERANCE,
    SIMULATION_PREP_MUJOCO_TEST_ENV,
)


if os.getenv(SIMULATION_PREP_MUJOCO_TEST_ENV) != "1":
    pytest.skip(
        f"Set {SIMULATION_PREP_MUJOCO_TEST_ENV}=1 to run MuJoCo simulation prep tests.",
        allow_module_level=True,
    )

pytest.importorskip("mujoco")


REPEATED_OMNI_WHEEL_FIXTURES = {
    "4-Omni-Directional-Wheel_Single_Body-v1-2": {
        "mass": "1.354285",
        "origin_xyz": "0 0.015875 0",
        "origin_rpy": "0 0 0",
        "inertia": {
            "ixx": "0.001264",
            "iyy": "0.001562",
            "izz": "0.001241",
            "ixy": "-0.000283",
            "iyz": "-0.000263",
            "ixz": "0.000159",
        },
    },
    "4-Omni-Directional-Wheel_Single_Body-v1-1": {
        "mass": "1.354285",
        "origin_xyz": "0.013748 -0.007938 0",
        "origin_rpy": "0 0 0",
        "inertia": {
            "ixx": "0.001683",
            "iyy": "0.00129",
            "izz": "0.001094",
            "ixy": "-0.00034",
            "iyz": "0",
            "ixz": "0",
        },
    },
    "4-Omni-Directional-Wheel_Single_Body-v1": {
        "mass": "1.354285",
        "origin_xyz": "-0.013748 -0.007938 0",
        "origin_rpy": "0 0 0",
        "inertia": {
            "ixx": "0.001827",
            "iyy": "0.001146",
            "izz": "0.001094",
            "ixy": "-0.000197",
            "iyz": "0",
            "ixz": "0",
        },
    },
}
DEMO_FIXTURE_URDF_PATH = BASE_DIR / "web" / "public" / "demo" / "lekiwi.urdf"


@contextmanager
def write_demo_urdf_with_replaced_inertials(
    replacements: dict[str, dict[str, object]],
) -> Iterator[Path]:
    document = ET.parse(DEMO_FIXTURE_URDF_PATH)
    root = document.getroot()

    for mesh in root.findall(".//mesh[@filename]"):
        mesh_reference = mesh.get("filename")
        if not mesh_reference:
            continue
        resolved_mesh_path = (DEMO_FIXTURE_URDF_PATH.parent / mesh_reference).resolve()
        mesh.set("filename", f"file://{resolved_mesh_path}")

    for link_name, replacement in replacements.items():
        link = root.find(f"./link[@name='{link_name}']")
        assert link is not None, f"Link '{link_name}' must exist in the demo URDF fixture."

        inertial = link.find("./inertial")
        assert inertial is not None, f"Link '{link_name}' must have an inertial block."

        origin = inertial.find("./origin")
        assert origin is not None, f"Link '{link_name}' inertial block must have an origin."
        origin.set("xyz", str(replacement["origin_xyz"]))
        origin.set("rpy", str(replacement["origin_rpy"]))

        mass = inertial.find("./mass")
        assert mass is not None, f"Link '{link_name}' inertial block must have a mass."
        mass.set("value", str(replacement["mass"]))

        inertia = inertial.find("./inertia")
        assert inertia is not None, f"Link '{link_name}' inertial block must have an inertia tensor."
        for attribute_name, attribute_value in replacement["inertia"].items():
            inertia.set(attribute_name, str(attribute_value))

    with tempfile.TemporaryDirectory(prefix="simulation-prep-mujoco-wheel-fix-") as temporary_dir_raw:
        temporary_dir = Path(temporary_dir_raw)
        temporary_urdf_path = temporary_dir / DEMO_FIXTURE_URDF_PATH.name
        document.write(temporary_urdf_path, encoding="utf-8", xml_declaration=True)
        yield temporary_urdf_path


def test_mesh_validation_mjcf_preserves_collision_mesh_names_authored_transforms_and_scales() -> None:
    with prepare_mujoco_simulation_assets(DEMO_FIXTURE_URDF_PATH) as prepared:
        model = load_mujoco_model(prepared.mesh_validation_mjcf_path)
        compiled_geometries = collect_compiled_mesh_geometries(model)
        expected_geom_names = {geometry.validation_geom_name for geometry in prepared.collision_mesh_geometries}

        assert set(compiled_geometries) == expected_geom_names

        for expected_geometry in prepared.collision_mesh_geometries:
            compiled_geometry = compiled_geometries[expected_geometry.validation_geom_name]
            assert compiled_geometry.mesh_name == expected_geometry.mesh_asset_name
            assert vectors_match(
                compiled_geometry.authored_position,
                expected_geometry.position,
                SIMULATION_PREP_MUJOCO_POSE_TOLERANCE,
            )
            assert quaternions_match(
                compiled_geometry.authored_quaternion,
                expected_geometry.quaternion,
                SIMULATION_PREP_MUJOCO_POSE_TOLERANCE,
            )
            assert all(math.isfinite(component) for component in compiled_geometry.raw_position)
            assert all(math.isfinite(component) for component in compiled_geometry.raw_quaternion)
            assert quaternion_has_unit_norm(
                compiled_geometry.raw_quaternion,
                SIMULATION_PREP_MUJOCO_QUATERNION_NORM_TOLERANCE,
            )
            assert vectors_match(
                compiled_geometry.mesh_scale,
                expected_geometry.scale,
                SIMULATION_PREP_MUJOCO_SCALE_TOLERANCE,
            )


def test_demo_urdf_compiles_with_meshes_and_runs_headlessly_without_non_finite_state() -> None:
    with prepare_mujoco_simulation_assets(DEMO_FIXTURE_URDF_PATH) as prepared:
        model = load_mujoco_model(prepared.staged_urdf_path)
        compiled_geometries = collect_compiled_mesh_geometries(model)
        expected_geom_names = {geometry.geom_name for geometry in prepared.collision_mesh_geometries}
        expected_mesh_names = {geometry.direct_mesh_name for geometry in prepared.collision_mesh_geometries}
        compiled_mesh_names = {geometry.mesh_name for geometry in compiled_geometries.values()}

        assert expected_geom_names.issubset(compiled_geometries)
        assert expected_mesh_names.issubset(compiled_mesh_names)

        expected_scale_by_mesh_name: dict[str, tuple[float, float, float]] = {}
        for expected_geometry in prepared.collision_mesh_geometries:
            existing_scale = expected_scale_by_mesh_name.setdefault(
                expected_geometry.direct_mesh_name,
                expected_geometry.scale,
            )
            assert vectors_match(existing_scale, expected_geometry.scale, SIMULATION_PREP_MUJOCO_SCALE_TOLERANCE)

        compiled_scale_by_mesh_name: dict[str, tuple[float, float, float]] = {}
        for compiled_geometry in compiled_geometries.values():
            compiled_scale_by_mesh_name.setdefault(compiled_geometry.mesh_name, compiled_geometry.mesh_scale)
            assert quaternion_has_unit_norm(
                compiled_geometry.raw_quaternion,
                SIMULATION_PREP_MUJOCO_QUATERNION_NORM_TOLERANCE,
            )
            assert all(math.isfinite(component) for component in compiled_geometry.raw_position)
            assert all(math.isfinite(component) for component in compiled_geometry.mesh_position)
            assert all(math.isfinite(component) for component in compiled_geometry.mesh_quaternion)

        for mesh_name, expected_scale in expected_scale_by_mesh_name.items():
            assert mesh_name in compiled_scale_by_mesh_name
            assert vectors_match(
                compiled_scale_by_mesh_name[mesh_name],
                expected_scale,
                SIMULATION_PREP_MUJOCO_SCALE_TOLERANCE,
            )

        run_headless_smoke_simulation(model)


def test_demo_repeated_omni_wheel_fix_output_compiles_and_runs_headlessly() -> None:
    with write_demo_urdf_with_replaced_inertials(REPEATED_OMNI_WHEEL_FIXTURES) as patched_urdf_path:
        with prepare_mujoco_simulation_assets(patched_urdf_path) as prepared:
            model = load_mujoco_model(prepared.staged_urdf_path)
            run_headless_smoke_simulation(model)


def test_demo_repeated_omni_wheel_fix_output_preserves_wheel_mesh_poses_and_equal_body_masses() -> None:
    import mujoco

    expected_wheel_geom_names = {
        "4-Omni-Directional-Wheel_Single_Body-v1-2_collision",
        "4-Omni-Directional-Wheel_Single_Body-v1-1_collision",
        "4-Omni-Directional-Wheel_Single_Body-v1_collision",
    }

    with write_demo_urdf_with_replaced_inertials(REPEATED_OMNI_WHEEL_FIXTURES) as patched_urdf_path:
        with prepare_mujoco_simulation_assets(patched_urdf_path) as prepared:
            validation_model = load_mujoco_model(prepared.mesh_validation_mjcf_path)
            validation_geometries = collect_compiled_mesh_geometries(validation_model)

            for expected_geometry in prepared.collision_mesh_geometries:
                if expected_geometry.geom_name not in expected_wheel_geom_names:
                    continue
                compiled_geometry = validation_geometries[expected_geometry.validation_geom_name]
                assert vectors_match(
                    compiled_geometry.authored_position,
                    expected_geometry.position,
                    SIMULATION_PREP_MUJOCO_POSE_TOLERANCE,
                )
                assert quaternions_match(
                    compiled_geometry.authored_quaternion,
                    expected_geometry.quaternion,
                    SIMULATION_PREP_MUJOCO_POSE_TOLERANCE,
                )
                assert vectors_match(
                    compiled_geometry.mesh_scale,
                    expected_geometry.scale,
                    SIMULATION_PREP_MUJOCO_SCALE_TOLERANCE,
                )

            model = load_mujoco_model(prepared.staged_urdf_path)

            wheel_body_masses: list[float] = []
            for wheel_geom_name in expected_wheel_geom_names:
                geom_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM, wheel_geom_name)
                assert geom_id >= 0
                body_id = int(model.geom_bodyid[geom_id])
                wheel_body_masses.append(float(model.body_mass[body_id]))
                wheel_body_inertia = tuple(float(value) for value in model.body_inertia[body_id])
                assert all(math.isfinite(component) and component > 0 for component in wheel_body_inertia)

            reference_mass = wheel_body_masses[0]
            for wheel_body_mass in wheel_body_masses[1:]:
                assert abs(wheel_body_mass - reference_mass) <= SIMULATION_PREP_MUJOCO_POSE_TOLERANCE
