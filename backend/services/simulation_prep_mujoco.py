from __future__ import annotations

import math
import re
import shutil
import tempfile
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import numpy as np

from backend.services.simulation_prep_mujoco_params import (
    SIMULATION_PREP_MUJOCO_DEFAULT_POSITION,
    SIMULATION_PREP_MUJOCO_DEFAULT_RPY,
    SIMULATION_PREP_MUJOCO_DEFAULT_SCALE,
    SIMULATION_PREP_MUJOCO_MODEL_NAME,
    SIMULATION_PREP_MUJOCO_SCALE_TOLERANCE,
    SIMULATION_PREP_MUJOCO_SMOKE_STEP_COUNT,
    SIMULATION_PREP_MUJOCO_STAGE_BODY_NAME,
    SIMULATION_PREP_MUJOCO_STAGE_MJCF_FILENAME,
    SIMULATION_PREP_MUJOCO_STAGE_URDF_FILENAME,
    SIMULATION_PREP_MUJOCO_VECTOR_COMPONENT_COUNT,
)


Float3 = tuple[float, float, float]
Float4 = tuple[float, float, float, float]
MESH_REFERENCE_SCHEME_SEPARATOR = "://"
FILE_REFERENCE_SCHEME = "file"
INVALID_MJCF_NAME_PATTERN = re.compile(r"[^A-Za-z0-9_.-]")


@dataclass(frozen=True)
class MujocoMeshGeometryExpectation:
    geom_name: str
    validation_geom_name: str
    mesh_asset_name: str
    mesh_reference: str
    mesh_file_name: str
    mesh_file_path: Path
    direct_mesh_name: str
    position: Float3
    quaternion: Float4
    scale: Float3


@dataclass(frozen=True)
class CompiledMujocoMeshGeometry:
    geom_name: str
    mesh_name: str
    raw_position: Float3
    raw_quaternion: Float4
    mesh_position: Float3
    mesh_quaternion: Float4
    authored_position: Float3
    authored_quaternion: Float4
    mesh_scale: Float3


@dataclass(frozen=True)
class PreparedMujocoSimulationAssets:
    workspace_dir: Path
    staged_urdf_path: Path
    mesh_validation_mjcf_path: Path
    collision_mesh_geometries: tuple[MujocoMeshGeometryExpectation, ...]


def _format_float_vector(values: tuple[float, ...]) -> str:
    return " ".join(f"{value:.12g}" for value in values)


def _parse_float_vector(
    raw_value: str | None,
    component_count: int,
    fallback: tuple[float, ...],
) -> tuple[float, ...]:
    if not raw_value:
        return fallback
    parts = raw_value.split()
    if len(parts) != component_count:
        return fallback
    try:
        parsed = tuple(float(part) for part in parts)
    except ValueError:
        return fallback
    if len(parsed) != component_count:
        return fallback
    return parsed


def _rpy_to_quaternion(rpy: Float3) -> Float4:
    roll, pitch, yaw = rpy
    half_roll = roll / 2.0
    half_pitch = pitch / 2.0
    half_yaw = yaw / 2.0

    cos_roll = math.cos(half_roll)
    sin_roll = math.sin(half_roll)
    cos_pitch = math.cos(half_pitch)
    sin_pitch = math.sin(half_pitch)
    cos_yaw = math.cos(half_yaw)
    sin_yaw = math.sin(half_yaw)

    return (
        cos_roll * cos_pitch * cos_yaw + sin_roll * sin_pitch * sin_yaw,
        sin_roll * cos_pitch * cos_yaw - cos_roll * sin_pitch * sin_yaw,
        cos_roll * sin_pitch * cos_yaw + sin_roll * cos_pitch * sin_yaw,
        cos_roll * cos_pitch * sin_yaw - sin_roll * sin_pitch * cos_yaw,
    )


def _sanitize_mjcf_name(name: str) -> str:
    sanitized = INVALID_MJCF_NAME_PATTERN.sub("_", name.strip())
    return sanitized or "unnamed_mesh"


def _to_float3(values: tuple[float, ...]) -> Float3:
    return (values[0], values[1], values[2])


def _to_float4(values: tuple[float, ...]) -> Float4:
    return (values[0], values[1], values[2], values[3])


def _resolve_mesh_path(urdf_path: Path, mesh_reference: str) -> Path:
    stripped_reference = mesh_reference.strip()
    if not stripped_reference:
        raise ValueError(f"{urdf_path} contains an empty mesh reference.")
    if stripped_reference.startswith(f"{FILE_REFERENCE_SCHEME}{MESH_REFERENCE_SCHEME_SEPARATOR}"):
        return Path(stripped_reference.split(MESH_REFERENCE_SCHEME_SEPARATOR, 1)[1]).expanduser().resolve()
    if MESH_REFERENCE_SCHEME_SEPARATOR in stripped_reference:
        raise ValueError(
            f"Unsupported mesh reference scheme '{stripped_reference}' in {urdf_path}. "
            "Only relative, absolute, and file:// references are currently supported."
        )
    reference_path = Path(stripped_reference).expanduser()
    if reference_path.is_absolute():
        return reference_path.resolve()
    return (urdf_path.parent / reference_path).resolve()


def collect_urdf_collision_mesh_geometries(
    urdf_path: Path,
) -> tuple[MujocoMeshGeometryExpectation, ...]:
    document = ET.parse(urdf_path)
    root = document.getroot()
    if root.tag != "robot":
        raise ValueError(f"{urdf_path} does not have a <robot> root element.")

    expectations: list[MujocoMeshGeometryExpectation] = []
    for link in root.findall("./link"):
        link_name = (link.get("name") or "unnamed_link").strip() or "unnamed_link"
        collisions = link.findall("./collision")
        for collision_index, collision in enumerate(collisions, start=1):
            mesh = collision.find("./geometry/mesh")
            if mesh is None:
                continue
            mesh_reference = (mesh.get("filename") or "").strip()
            if not mesh_reference:
                continue

            mesh_file_path = _resolve_mesh_path(urdf_path, mesh_reference)
            if not mesh_file_path.exists():
                raise FileNotFoundError(f"Mesh reference '{mesh_reference}' resolved to missing path {mesh_file_path}.")

            origin = collision.find("./origin")
            position = _parse_float_vector(
                origin.get("xyz") if origin is not None else None,
                SIMULATION_PREP_MUJOCO_VECTOR_COMPONENT_COUNT,
                SIMULATION_PREP_MUJOCO_DEFAULT_POSITION,
            )
            rpy = _parse_float_vector(
                origin.get("rpy") if origin is not None else None,
                SIMULATION_PREP_MUJOCO_VECTOR_COMPONENT_COUNT,
                SIMULATION_PREP_MUJOCO_DEFAULT_RPY,
            )
            scale = _parse_float_vector(
                mesh.get("scale"),
                SIMULATION_PREP_MUJOCO_VECTOR_COMPONENT_COUNT,
                SIMULATION_PREP_MUJOCO_DEFAULT_SCALE,
            )

            raw_geom_name = (collision.get("name") or f"{link_name}_collision_{collision_index}").strip()
            geom_name = raw_geom_name or f"{link_name}_collision_{collision_index}"
            mesh_file_name = mesh_file_path.name
            expectations.append(
                MujocoMeshGeometryExpectation(
                    geom_name=geom_name,
                    validation_geom_name=f"{_sanitize_mjcf_name(geom_name)}_geom",
                    mesh_asset_name=f"{_sanitize_mjcf_name(geom_name)}_mesh",
                    mesh_reference=mesh_reference,
                    mesh_file_name=mesh_file_name,
                    mesh_file_path=mesh_file_path,
                    direct_mesh_name=Path(mesh_file_name).stem,
                    position=_to_float3(position),
                    quaternion=_rpy_to_quaternion(_to_float3(rpy)),
                    scale=_to_float3(scale),
                )
            )

    return tuple(expectations)


def _build_mesh_validation_mjcf(
    expectations: tuple[MujocoMeshGeometryExpectation, ...],
) -> str:
    asset_lines = [
        f'    <mesh name="{expectation.mesh_asset_name}" '
        f'file="{expectation.mesh_file_name}" '
        f'scale="{_format_float_vector(expectation.scale)}"/>'
        for expectation in expectations
    ]
    geom_lines = [
        f'      <geom name="{expectation.validation_geom_name}" '
        f'type="mesh" '
        f'mesh="{expectation.mesh_asset_name}" '
        f'pos="{_format_float_vector(expectation.position)}" '
        f'quat="{_format_float_vector(expectation.quaternion)}"/>'
        for expectation in expectations
    ]
    return "\n".join(
        [
            '<?xml version="1.0"?>',
            f'<mujoco model="{SIMULATION_PREP_MUJOCO_MODEL_NAME}">',
            '  <compiler angle="radian" meshdir="."/>',
            '  <asset>',
            *asset_lines,
            '  </asset>',
            '  <worldbody>',
            f'    <body name="{SIMULATION_PREP_MUJOCO_STAGE_BODY_NAME}">',
            *geom_lines,
            '    </body>',
            '  </worldbody>',
            '</mujoco>',
            '',
        ]
    )


def _stage_mesh_file(source: Path, destination: Path) -> None:
    try:
        destination.symlink_to(source)
    except OSError:
        shutil.copy2(source, destination)


@contextmanager
def prepare_mujoco_simulation_assets(urdf_path: Path) -> Iterator[PreparedMujocoSimulationAssets]:
    expectations = collect_urdf_collision_mesh_geometries(urdf_path)
    if len(expectations) == 0:
        raise ValueError(f"{urdf_path} does not contain any collision mesh geometries to validate.")

    with tempfile.TemporaryDirectory(prefix="simulation-prep-mujoco-") as workspace:
        workspace_dir = Path(workspace)
        staged_urdf_path = workspace_dir / SIMULATION_PREP_MUJOCO_STAGE_URDF_FILENAME
        mesh_validation_mjcf_path = workspace_dir / SIMULATION_PREP_MUJOCO_STAGE_MJCF_FILENAME

        shutil.copy2(urdf_path, staged_urdf_path)

        staged_mesh_sources: dict[str, Path] = {}
        for expectation in expectations:
            previous_source = staged_mesh_sources.get(expectation.mesh_file_name)
            resolved_source = expectation.mesh_file_path.resolve()
            if previous_source is not None and previous_source != resolved_source:
                raise ValueError(
                    "MuJoCo stages direct URDF meshes by basename. "
                    f"Found conflicting sources for '{expectation.mesh_file_name}': "
                    f"{previous_source} and {resolved_source}."
                )

            staged_mesh_sources[expectation.mesh_file_name] = resolved_source
            staged_mesh_path = workspace_dir / expectation.mesh_file_name
            if not staged_mesh_path.exists():
                _stage_mesh_file(resolved_source, staged_mesh_path)

        mesh_validation_mjcf_path.write_text(
            _build_mesh_validation_mjcf(expectations),
            encoding="utf-8",
        )

        yield PreparedMujocoSimulationAssets(
            workspace_dir=workspace_dir,
            staged_urdf_path=staged_urdf_path,
            mesh_validation_mjcf_path=mesh_validation_mjcf_path,
            collision_mesh_geometries=expectations,
        )


def load_mujoco_model(xml_path: Path):
    import mujoco

    return mujoco.MjModel.from_xml_path(str(xml_path))


def _recover_authored_mesh_pose(model, geom_id: int) -> tuple[Float3, Float4]:
    import mujoco

    mesh_id = int(model.geom_dataid[geom_id])
    if mesh_id < 0:
        raise ValueError(f"Geometry {geom_id} is not backed by a mesh asset.")

    raw_position = np.array(model.geom_pos[geom_id], dtype=float)
    raw_quaternion = np.array(model.geom_quat[geom_id], dtype=float)
    mesh_position = np.array(model.mesh_pos[mesh_id], dtype=float)
    mesh_quaternion = np.array(model.mesh_quat[mesh_id], dtype=float)

    inverse_mesh_position = np.zeros(3)
    inverse_mesh_quaternion = np.zeros(4)
    mujoco.mju_negPose(
        inverse_mesh_position,
        inverse_mesh_quaternion,
        mesh_position,
        mesh_quaternion,
    )

    authored_position = np.zeros(3)
    authored_quaternion = np.zeros(4)
    mujoco.mju_mulPose(
        authored_position,
        authored_quaternion,
        raw_position,
        raw_quaternion,
        inverse_mesh_position,
        inverse_mesh_quaternion,
    )
    return _to_float3(tuple(float(value) for value in authored_position)), _to_float4(
        tuple(float(value) for value in authored_quaternion)
    )


def collect_compiled_mesh_geometries(model) -> dict[str, CompiledMujocoMeshGeometry]:
    import mujoco

    compiled: dict[str, CompiledMujocoMeshGeometry] = {}
    for geom_id in range(model.ngeom):
        geom_name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_GEOM, geom_id)
        mesh_id = int(model.geom_dataid[geom_id])
        if not geom_name or mesh_id < 0:
            continue
        mesh_name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_MESH, mesh_id)
        if not mesh_name:
            continue
        authored_position, authored_quaternion = _recover_authored_mesh_pose(model, geom_id)
        compiled[geom_name] = CompiledMujocoMeshGeometry(
            geom_name=geom_name,
            mesh_name=mesh_name,
            raw_position=_to_float3(tuple(float(value) for value in model.geom_pos[geom_id])),
            raw_quaternion=_to_float4(tuple(float(value) for value in model.geom_quat[geom_id])),
            mesh_position=_to_float3(tuple(float(value) for value in model.mesh_pos[mesh_id])),
            mesh_quaternion=_to_float4(tuple(float(value) for value in model.mesh_quat[mesh_id])),
            authored_position=authored_position,
            authored_quaternion=authored_quaternion,
            mesh_scale=_to_float3(tuple(float(value) for value in model.mesh_scale[mesh_id])),
        )
    return compiled


def _assert_simulation_data_is_finite(data) -> None:
    arrays = {
        "qpos": data.qpos,
        "qvel": data.qvel,
        "qacc": data.qacc,
        "act": data.act,
        "ctrl": data.ctrl,
        "xpos": data.xpos,
        "xquat": data.xquat,
        "cvel": data.cvel,
    }
    for array_name, values in arrays.items():
        if values.size == 0:
            continue
        if not np.isfinite(values).all():
            raise AssertionError(f"MuJoCo produced non-finite values in '{array_name}'.")


def run_headless_smoke_simulation(model, step_count: int = SIMULATION_PREP_MUJOCO_SMOKE_STEP_COUNT) -> None:
    import mujoco

    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    _assert_simulation_data_is_finite(data)

    for _ in range(step_count):
        mujoco.mj_step(model, data)
        _assert_simulation_data_is_finite(data)


def vectors_match(
    actual: tuple[float, ...],
    expected: tuple[float, ...],
    tolerance: float = SIMULATION_PREP_MUJOCO_SCALE_TOLERANCE,
) -> bool:
    if len(actual) != len(expected):
        return False
    return all(abs(actual_value - expected_value) <= tolerance for actual_value, expected_value in zip(actual, expected))


def quaternions_match(actual: Float4, expected: Float4, tolerance: float) -> bool:
    direct_match = vectors_match(actual, expected, tolerance)
    negated_match = vectors_match(actual, tuple(-value for value in expected), tolerance)
    return direct_match or negated_match


def quaternion_has_unit_norm(quaternion: Float4, tolerance: float) -> bool:
    norm = math.sqrt(sum(component * component for component in quaternion))
    return abs(norm - 1.0) <= tolerance
