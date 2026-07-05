from __future__ import annotations

import importlib
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

from backend.services.simulator_adapters.base import is_python_module_available
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
_MUJOCO_IMPORT_NAME = "mujoco"


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
    default_value: tuple[float, ...],
) -> tuple[float, ...]:
    if not raw_value:
        return default_value
    parts = raw_value.split()
    if len(parts) != component_count:
        return default_value
    try:
        parsed = tuple(float(part) for part in parts)
    except ValueError:
        return default_value
    if len(parsed) != component_count:
        return default_value
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


def _collect_urdf_mesh_sources_by_basename(urdf_path: Path) -> dict[str, Path]:
    document = ET.parse(urdf_path)
    root = document.getroot()
    mesh_sources: dict[str, Path] = {}

    for mesh in root.findall(".//mesh[@filename]"):
        mesh_reference = (mesh.get("filename") or "").strip()
        if not mesh_reference:
            continue

        mesh_file_path = _resolve_mesh_path(urdf_path, mesh_reference)
        if not mesh_file_path.exists():
            raise FileNotFoundError(f"Mesh reference '{mesh_reference}' resolved to missing path {mesh_file_path}.")

        mesh_file_name = mesh_file_path.name
        resolved_source = mesh_file_path.resolve()
        previous_source = mesh_sources.get(mesh_file_name)
        if previous_source is not None and previous_source != resolved_source:
            raise ValueError(
                "MuJoCo stages direct URDF meshes by basename. "
                f"Found conflicting sources for '{mesh_file_name}': "
                f"{previous_source} and {resolved_source}."
            )

        mesh_sources[mesh_file_name] = resolved_source

    return mesh_sources


@contextmanager
def prepare_mujoco_simulation_assets(urdf_path: Path) -> Iterator[PreparedMujocoSimulationAssets]:
    expectations = collect_urdf_collision_mesh_geometries(urdf_path)
    if not expectations:
        raise ValueError(f"{urdf_path} does not contain any collision mesh geometries to validate.")
    mesh_sources = _collect_urdf_mesh_sources_by_basename(urdf_path)

    with tempfile.TemporaryDirectory(prefix="simulation-prep-mujoco-") as workspace:
        workspace_dir = Path(workspace)
        staged_urdf_path = workspace_dir / SIMULATION_PREP_MUJOCO_STAGE_URDF_FILENAME
        mesh_validation_mjcf_path = workspace_dir / SIMULATION_PREP_MUJOCO_STAGE_MJCF_FILENAME

        staged_urdf_path.write_text(
            _rewrite_mesh_paths_to_basenames(urdf_path.read_text(encoding="utf-8")),
            encoding="utf-8",
        )

        for mesh_file_name, resolved_source in mesh_sources.items():
            staged_mesh_path = workspace_dir / mesh_file_name
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


def _extract_mesh_basename(mesh_reference: str) -> str:
    stripped = mesh_reference.strip()
    if MESH_REFERENCE_SCHEME_SEPARATOR in stripped:
        _, after_scheme = stripped.split(MESH_REFERENCE_SCHEME_SEPARATOR, 1)
        return Path(after_scheme).name
    return Path(stripped).name


def _rewrite_mesh_paths_to_basenames(urdf_content: str) -> str:
    root = ET.fromstring(urdf_content)
    for mesh in root.findall(".//mesh[@filename]"):
        ref = (mesh.get("filename") or "").strip()
        if ref:
            mesh.set("filename", _extract_mesh_basename(ref))
    return ET.tostring(root, encoding="unicode")


def _build_simulation_prep_geometry_result(
    expected_geometry: MujocoMeshGeometryExpectation,
    *,
    staged_basenames: set[str],
    mujoco_loaded: bool | None,
    compiled_geometry: CompiledMujocoMeshGeometry | None,
    error: str | None,
):
    from backend.models.simulation_prep import SimulationPrepGeometryResult

    return SimulationPrepGeometryResult(
        geom_name=expected_geometry.geom_name,
        mesh_file=expected_geometry.mesh_file_name,
        staged=expected_geometry.mesh_file_name in staged_basenames,
        mujoco_loaded=mujoco_loaded,
        authored_position=list(compiled_geometry.authored_position) if compiled_geometry else None,
        authored_quaternion=list(compiled_geometry.authored_quaternion) if compiled_geometry else None,
        scale=list(compiled_geometry.mesh_scale) if compiled_geometry else list(expected_geometry.scale),
        error=error,
    )


def _build_simulation_prep_report(
    *,
    success: bool,
    error: str | None,
    expectations: tuple[MujocoMeshGeometryExpectation, ...],
    geometry_results: list,
    smoke_simulation,
    mujoco_available: bool,
    warnings: list[str],
):
    from backend.models.simulation_prep import SimulationPrepValidationReport

    return SimulationPrepValidationReport(
        success=success,
        error=error,
        geometry_count=len(expectations),
        geometries=geometry_results,
        smoke_simulation=smoke_simulation,
        mujoco_available=mujoco_available,
        warnings=warnings,
    )


def _build_unavailable_mujoco_geometry_results(
    expectations: tuple[MujocoMeshGeometryExpectation, ...],
    staged_basenames: set[str],
) -> list:
    return [
        _build_simulation_prep_geometry_result(
            expected_geometry,
            staged_basenames=staged_basenames,
            mujoco_loaded=None,
            compiled_geometry=None,
            error=None,
        )
        for expected_geometry in expectations
    ]


def _build_compiled_mujoco_geometry_results(
    expectations: tuple[MujocoMeshGeometryExpectation, ...],
    staged_basenames: set[str],
    compiled_geometries: dict[str, CompiledMujocoMeshGeometry],
    mesh_load_error: str | None,
) -> list:
    geometry_results = []
    for expected_geometry in expectations:
        compiled_geometry = compiled_geometries.get(expected_geometry.validation_geom_name)
        geometry_error = mesh_load_error if (mesh_load_error and compiled_geometry is None) else None
        geometry_results.append(
            _build_simulation_prep_geometry_result(
                expected_geometry,
                staged_basenames=staged_basenames,
                mujoco_loaded=compiled_geometry is not None,
                compiled_geometry=compiled_geometry,
                error=geometry_error,
            )
        )
    return geometry_results


def _build_smoke_simulation_result(*, passed: bool, error: str | None):
    from backend.models.simulation_prep import SimulationPrepSmokeSimResult

    return SimulationPrepSmokeSimResult(
        ran=True,
        steps=SIMULATION_PREP_MUJOCO_SMOKE_STEP_COUNT,
        passed=passed,
        error=error,
    )


def _mujoco_dependency_available() -> bool:
    return is_python_module_available(_MUJOCO_IMPORT_NAME)


def _mujoco_validation_errors() -> tuple[type[BaseException], ...]:
    mujoco = importlib.import_module(_MUJOCO_IMPORT_NAME)
    return (
        AssertionError,
        ValueError,
        mujoco.FatalError,
        mujoco.UnexpectedError,
    )


def run_simulation_prep_validation(
    urdf_content: str,
    mesh_files_by_name: dict[str, bytes],
) -> "SimulationPrepValidationReport":
    from backend.models.simulation_prep import SimulationPrepValidationReport

    warnings: list[str] = []

    mujoco_available = _mujoco_dependency_available()
    if not mujoco_available:
        warnings.append("MuJoCo is not installed. Install with: uv pip install --python .venv/bin/python3 mujoco")

    try:
        rewritten_urdf = _rewrite_mesh_paths_to_basenames(urdf_content)
    except ET.ParseError as exc:
        return _build_simulation_prep_report(
            success=False,
            error=f"URDF XML parse error: {exc}",
            expectations=(),
            geometry_results=[],
            smoke_simulation=None,
            mujoco_available=mujoco_available,
            warnings=warnings,
        )

    with tempfile.TemporaryDirectory(prefix="simulation-prep-validate-") as workspace_raw:
        workspace = Path(workspace_raw)
        urdf_path = workspace / SIMULATION_PREP_MUJOCO_STAGE_URDF_FILENAME
        urdf_path.write_text(rewritten_urdf, encoding="utf-8")

        staged_basenames: set[str] = set()
        for name, data in mesh_files_by_name.items():
            basename = Path(name).name
            (workspace / basename).write_bytes(data)
            staged_basenames.add(basename)

        try:
            expectations = collect_urdf_collision_mesh_geometries(urdf_path)
        except ValueError:
            expectations = ()
        except FileNotFoundError as exc:
            return _build_simulation_prep_report(
                success=False,
                error=str(exc),
                expectations=(),
                geometry_results=[],
                smoke_simulation=None,
                mujoco_available=mujoco_available,
                warnings=warnings,
            )

        if not mujoco_available:
            geometry_results = _build_unavailable_mujoco_geometry_results(expectations, staged_basenames)
            return _build_simulation_prep_report(
                success=True,
                error=None,
                expectations=expectations,
                geometry_results=geometry_results,
                smoke_simulation=None,
                mujoco_available=False,
                warnings=warnings,
            )

        compiled_geometries: dict[str, CompiledMujocoMeshGeometry] = {}
        mesh_load_error: str | None = None
        mujoco_validation_errors = _mujoco_validation_errors()
        if expectations:
            mjcf_path = workspace / SIMULATION_PREP_MUJOCO_STAGE_MJCF_FILENAME
            mjcf_path.write_text(_build_mesh_validation_mjcf(expectations), encoding="utf-8")
            try:
                mesh_model = load_mujoco_model(mjcf_path)
                compiled_geometries = collect_compiled_mesh_geometries(mesh_model)
            except mujoco_validation_errors as exc:
                mesh_load_error = str(exc)

        geometry_results = _build_compiled_mujoco_geometry_results(
            expectations,
            staged_basenames,
            compiled_geometries,
            mesh_load_error,
        )

        try:
            full_model = load_mujoco_model(urdf_path)
            run_headless_smoke_simulation(full_model)
            smoke_result = _build_smoke_simulation_result(passed=True, error=None)
        except mujoco_validation_errors as exc:
            smoke_result = _build_smoke_simulation_result(passed=False, error=str(exc))

        meshes_ok = all(g.mujoco_loaded is not False for g in geometry_results)
        smoke_ok = smoke_result is None or smoke_result.passed

        return _build_simulation_prep_report(
            success=meshes_ok and smoke_ok,
            error=None,
            expectations=expectations,
            geometry_results=geometry_results,
            smoke_simulation=smoke_result,
            mujoco_available=True,
            warnings=warnings,
        )
