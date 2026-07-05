from __future__ import annotations

import re
import shutil
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from backend.models.simulator_runtime import (
    SIMULATOR_MUJOCO_ID,
    SimulatorDependencySpec,
    SimulatorId,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapterError,
)
from backend.services.simulator_adapters.params import (
    MUJOCO_SCENE_PARAMS,
    MUJOCO_WORKSPACE_PROCESS_PARAMS,
    MUJOCO_WORKSPACE_REPAIR_PARAMS,
)
from backend.services.simulator_adapters.plugin import MjcfSimulatorPlugin
from backend.services.simulator_adapters.workspace_package import (
    PreparedSimulatorWorkspace,
    prepare_simulator_workspace_package,
)
from backend.services.simulator_adapters.workspace_process import start_prepared_workspace_process
from backend.services.ilu_urdf import (
    BundleMeshAssetsResult,
    IluUrdfBridgeError,
    convert_urdf_to_mjcf,
)


class MujocoWorkspaceError(SimulatorAdapterError):
    pass


@dataclass(frozen=True)
class PreparedMujocoWorkspace:
    shared_workspace: PreparedSimulatorWorkspace
    mjcf_path: Path


def _mujoco_error(message: str) -> MujocoWorkspaceError:
    return MujocoWorkspaceError(message)


def _parse_float_attr(element: ET.Element, attr_name: str) -> float | None:
    raw = element.get(attr_name)
    if raw is None:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _ensure_inertial_pose_attrs(inertial: ET.Element) -> None:
    if not (inertial.get("pos") or "").strip():
        inertial.set("pos", "0 0 0")


def _has_positive_diagonal_inertia(inertial: ET.Element) -> bool:
    diaginertia = inertial.get("diaginertia")
    if not diaginertia:
        return False
    try:
        values = [float(value) for value in diaginertia.split()]
    except ValueError:
        return False
    return len(values) == 3 and all(
        value > MUJOCO_WORKSPACE_REPAIR_PARAMS.min_inertia_diagonal for value in values
    )


def _has_positive_full_inertia(inertial: ET.Element) -> bool:
    fullinertia = inertial.get("fullinertia")
    if not fullinertia:
        return False
    try:
        ixx, iyy, izz, ixy, ixz, iyz = [float(value) for value in fullinertia.split()]
    except ValueError:
        return False
    if ixx <= MUJOCO_WORKSPACE_REPAIR_PARAMS.min_inertia_diagonal:
        return False
    determinant_2x2 = (ixx * iyy) - (ixy * ixy)
    if determinant_2x2 <= MUJOCO_WORKSPACE_REPAIR_PARAMS.min_inertia_diagonal:
        return False
    determinant_3x3 = (
        ixx * ((iyy * izz) - (iyz * iyz))
        - ixy * ((ixy * izz) - (ixz * iyz))
        + ixz * ((ixy * iyz) - (ixz * iyy))
    )
    return determinant_3x3 > MUJOCO_WORKSPACE_REPAIR_PARAMS.min_inertia_diagonal


def _parse_full_inertia(inertial: ET.Element) -> tuple[float, float, float, float, float, float] | None:
    fullinertia = inertial.get("fullinertia")
    if not fullinertia:
        return None
    try:
        values = [float(value) for value in fullinertia.split()]
    except ValueError:
        return None
    if len(values) != 6:
        return None
    return (
        values[0],
        values[1],
        values[2],
        values[3],
        values[4],
        values[5],
    )


def _regularize_full_inertia(
    values: tuple[float, float, float, float, float, float]
) -> tuple[float, float, float, float, float, float] | None:
    ixx, iyy, izz, ixy, ixz, iyz = values
    base_scale = max(abs(value) for value in values) or MUJOCO_WORKSPACE_REPAIR_PARAMS.min_inertia_diagonal

    for attempt in range(MUJOCO_WORKSPACE_REPAIR_PARAMS.inertia_shift_attempts):
        diagonal_shift = (10**attempt) * base_scale * 1e-9
        candidate = (
            max(ixx, MUJOCO_WORKSPACE_REPAIR_PARAMS.min_inertia_diagonal) + diagonal_shift,
            max(iyy, MUJOCO_WORKSPACE_REPAIR_PARAMS.min_inertia_diagonal) + diagonal_shift,
            max(izz, MUJOCO_WORKSPACE_REPAIR_PARAMS.min_inertia_diagonal) + diagonal_shift,
            ixy,
            ixz,
            iyz,
        )
        probe = ET.Element(
            "inertial",
            {
                "fullinertia": " ".join(f"{value:.12g}" for value in candidate),
            },
        )
        if _has_positive_full_inertia(probe):
            return candidate
    return None


def _body_needs_only_frame_inertial(body: ET.Element) -> bool:
    return body.find("joint") is None and body.find("freejoint") is None and body.find("geom") is None


def apply_mjcf_workspace_repairs(mjcf_content: str) -> tuple[str, tuple[str, ...]]:
    root = ET.fromstring(mjcf_content)
    warnings: list[str] = []

    for body in root.findall(".//body"):
        inertial = body.find("inertial")
        if inertial is None:
            continue

        mass = _parse_float_attr(inertial, "mass")
        has_valid_inertia = _has_positive_diagonal_inertia(inertial) or _has_positive_full_inertia(inertial)
        if (
            mass is not None
            and mass > MUJOCO_WORKSPACE_REPAIR_PARAMS.min_inertial_mass
            and has_valid_inertia
        ):
            continue

        body_name = body.get("name", "<unnamed-body>")
        if _body_needs_only_frame_inertial(body):
            body.remove(inertial)
            warnings.append(f"Workspace repair removed invalid frame inertial from MJCF body '{body_name}'.")
            continue

        inertial.set(
            "mass",
            f"{max(mass or 0.0, MUJOCO_WORKSPACE_REPAIR_PARAMS.min_inertial_mass):.12g}",
        )
        _ensure_inertial_pose_attrs(inertial)
        full_inertia = _parse_full_inertia(inertial)
        regularized_full_inertia = (
            _regularize_full_inertia(full_inertia)
            if full_inertia is not None and (mass or 0.0) > MUJOCO_WORKSPACE_REPAIR_PARAMS.min_inertial_mass
            else None
        )
        if regularized_full_inertia is not None:
            inertial.set(
                "fullinertia",
                " ".join(f"{value:.12g}" for value in regularized_full_inertia),
            )
            inertial.attrib.pop("diaginertia", None)
        else:
            inertial.attrib.pop("fullinertia", None)
            inertial.set(
                "diaginertia",
                f"{MUJOCO_WORKSPACE_REPAIR_PARAMS.min_inertia_diagonal:.12g} "
                f"{MUJOCO_WORKSPACE_REPAIR_PARAMS.min_inertia_diagonal:.12g} "
                f"{MUJOCO_WORKSPACE_REPAIR_PARAMS.min_inertia_diagonal:.12g}"
            )
        warnings.append(f"Workspace repair regularized invalid inertial on MJCF body '{body_name}'.")

    return ET.tostring(root, encoding="unicode"), tuple(warnings)


def _unique_mesh_name(source_path: Path, robot_dir: Path) -> str:
    try:
        rel = source_path.relative_to(robot_dir)
        parts = rel.parts
    except ValueError:
        parts = source_path.parts[-2:]
    if len(parts) <= 1:
        return source_path.name
    dir_prefix = "__".join(part for part in parts[:-1] if part not in (".", ".."))
    return f"{dir_prefix}__{source_path.name}" if dir_prefix else source_path.name


def _mjcf_mesh_name_from_filename(filename: str) -> str:
    normalized = filename.replace("\\", "/")
    normalized = re.sub(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", "", normalized)
    normalized = re.sub(r"\.[^./]+$", "", normalized)
    normalized = re.sub(r"[^a-zA-Z0-9_]+", "_", normalized).strip("_")
    return normalized or "mesh"


def _group_bundled_mesh_target_paths(bundle_result: BundleMeshAssetsResult) -> dict[str, list[Path]]:
    target_paths_by_basename: dict[str, list[Path]] = defaultdict(list)
    for asset in bundle_result.bundled:
        target_path = Path(asset.target_path).resolve()
        if target_path not in target_paths_by_basename[target_path.name]:
            target_paths_by_basename[target_path.name].append(target_path)
    return target_paths_by_basename


def _build_staged_mesh_name_map(
    target_paths_by_basename: dict[str, list[Path]],
    *,
    robot_dir: Path,
) -> dict[Path, str]:
    staged_name_by_source: dict[Path, str] = {}
    used_staged_names: set[str] = set()

    for paths in target_paths_by_basename.values():
        has_collision = len(paths) > 1
        for target_path in paths:
            candidate = (
                _unique_mesh_name(target_path, robot_dir) if has_collision else target_path.name
            )
            if candidate in used_staged_names:
                stem = Path(candidate).stem
                suffix = Path(candidate).suffix
                index = 2
                while f"{stem}__{index}{suffix}" in used_staged_names:
                    index += 1
                candidate = f"{stem}__{index}{suffix}"
            used_staged_names.add(candidate)
            staged_name_by_source[target_path] = candidate
    return staged_name_by_source


def _copy_staged_mesh_assets(*, mesh_dir: Path, staged_name_by_source: dict[Path, str]) -> None:
    for source_path, staged_name in staged_name_by_source.items():
        try:
            shutil.copy2(source_path, mesh_dir / staged_name)
        except OSError as exc:
            raise MujocoWorkspaceError(
                f"MuJoCo MJCF conversion could not stage mesh asset: {source_path.name}"
            ) from exc


def _build_staged_name_by_mjcf_mesh_name(
    bundle_result: BundleMeshAssetsResult,
    staged_name_by_source: dict[Path, str],
) -> dict[str, str]:
    return {
        _mjcf_mesh_name_from_filename(asset.rewritten): staged_name_by_source[target_path]
        for asset in bundle_result.bundled
        if (target_path := Path(asset.target_path).resolve()) in staged_name_by_source
    }


def _rewrite_mjcf_mesh_filenames(
    *,
    mjcf_path: Path,
    staged_name_by_mjcf_mesh_name: dict[str, str],
) -> None:
    if not staged_name_by_mjcf_mesh_name:
        return
    try:
        root = ET.fromstring(mjcf_path.read_text(encoding="utf-8"))
    except ET.ParseError:
        return
    changed = False
    for mesh_el in root.findall(".//mesh"):
        mesh_name = mesh_el.get("name")
        if not mesh_name:
            continue
        staged_name = staged_name_by_mjcf_mesh_name.get(mesh_name)
        if staged_name is None:
            continue
        attr = "file" if mesh_el.get("file") is not None else "filename"
        if mesh_el.get(attr) == staged_name:
            continue
        mesh_el.set(attr, staged_name)
        changed = True
    if changed:
        mjcf_path.write_text(ET.tostring(root, encoding="unicode"), encoding="utf-8")


def _stage_mjcf_mesh_assets(bundle_result: BundleMeshAssetsResult, mjcf_path: Path) -> None:
    robot_dir = mjcf_path.parent
    mesh_dir = robot_dir / "meshes"
    mesh_dir.mkdir(parents=True, exist_ok=True)

    target_paths_by_basename = _group_bundled_mesh_target_paths(bundle_result)
    staged_name_by_source = _build_staged_mesh_name_map(
        target_paths_by_basename,
        robot_dir=robot_dir,
    )
    _copy_staged_mesh_assets(mesh_dir=mesh_dir, staged_name_by_source=staged_name_by_source)
    staged_name_by_mjcf_mesh_name = _build_staged_name_by_mjcf_mesh_name(
        bundle_result,
        staged_name_by_source,
    )
    _rewrite_mjcf_mesh_filenames(
        mjcf_path=mjcf_path,
        staged_name_by_mjcf_mesh_name=staged_name_by_mjcf_mesh_name,
    )


def prepare_mujoco_workspace(
    request: SimulatorWorkspacePrepareRequest,
    *,
    simulator_id: SimulatorId,
    workspace_root: Path | None = None,
) -> PreparedMujocoWorkspace:
    prepared = prepare_simulator_workspace_package(
        request,
        workspace_root=workspace_root or MUJOCO_WORKSPACE_PROCESS_PARAMS.workspace_root / simulator_id,
        error=_mujoco_error,
    )
    try:
        return _prepare_mujoco_workspace_inner(prepared)
    except BaseException:
        shutil.rmtree(prepared.workspace_dir, ignore_errors=True)
        raise


def _prepare_mujoco_workspace_inner(prepared: PreparedSimulatorWorkspace) -> PreparedMujocoWorkspace:
    try:
        conversion = convert_urdf_to_mjcf(prepared.robot_urdf_xml)
    except IluUrdfBridgeError as exc:
        raise MujocoWorkspaceError(f"MuJoCo MJCF conversion failed: {exc}") from exc

    if not conversion.mjcf_content.strip():
        details = "; ".join(conversion.warnings) or "empty MJCF output"
        raise MujocoWorkspaceError(f"MuJoCo MJCF conversion failed: {details}")
    mjcf_path = prepared.workspace_dir / "robot" / "robot.xml"
    mjcf_path.parent.mkdir(parents=True, exist_ok=True)
    mjcf_path.write_text(conversion.mjcf_content, encoding="utf-8")
    _stage_mjcf_mesh_assets(prepared.bundle_result, mjcf_path)
    return PreparedMujocoWorkspace(
        shared_workspace=prepared,
        mjcf_path=mjcf_path,
    )


def start_mujoco_workspace(
    request: SimulatorWorkspacePrepareRequest,
    *,
    simulator_id: SimulatorId,
    simulator_label: str,
) -> SimulatorWorkspacePrepareResponse:
    from backend.services.simulator_adapters.plugin import get_plugin
    plugin = get_plugin(simulator_id)
    runtime_spec = plugin.as_runtime_spec()
    prepared = prepare_mujoco_workspace(
        request,
        simulator_id=simulator_id,
    )
    shared = prepared.shared_workspace
    workspace_process = plugin.require_workspace_process()
    return start_prepared_workspace_process(
        runtime_spec=runtime_spec,
        prepared=shared,
        simulator_asset_path=prepared.mjcf_path,
        simulator_asset_flag="--robot-mjcf",
        workspace_process=workspace_process,
        error=_mujoco_error,
        simulator_label=simulator_label,
        extra_simulator_args=(
            "--robot-urdf", str(shared.robot_urdf_path),
            "--simulator-id", simulator_id,
        ),
        launch_id=request.launch_id,
    )


class MujocoPlugin(MjcfSimulatorPlugin):
    simulator_id = SIMULATOR_MUJOCO_ID
    label = "MuJoCo"
    robot_asset_format = "mjcf"
    transfer_strategy = "convert"
    workspace_target = True
    dependencies = (SimulatorDependencySpec(name="mujoco", import_name="mujoco"),)
    workspace_process = MUJOCO_WORKSPACE_PROCESS_PARAMS
    scene_params = MUJOCO_SCENE_PARAMS
