from __future__ import annotations

import shutil
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from backend.models.simulator_runtime import (
    SIMULATOR_MUJOCO_ID,
    SimulatorId,
    SimulatorRuntimeStatus,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
    get_simulator_runtime_spec,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapter,
    SimulatorAdapterError,
    build_simulator_runtime_status,
)
from backend.services.simulator_adapters.workspace_package import (
    PreparedSimulatorWorkspace,
    prepare_simulator_workspace_package,
)
from backend.services.simulator_adapters.params import (
    MUJOCO_WORKSPACE_PROCESS_PARAMS,
    MUJOCO_WORKSPACE_REPAIR_PARAMS,
)
from backend.services.simulator_adapters.workspace_process import start_prepared_workspace_process
from backend.services.ilu_urdf import (
    BundleMeshAssetsResult,
    IluUrdfBridgeError,
    convert_urdf_to_mjcf,
)


MUJOCO_RUNTIME_SPEC = get_simulator_runtime_spec(SIMULATOR_MUJOCO_ID)


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
        values = tuple(float(value) for value in fullinertia.split())
    except ValueError:
        return None
    if len(values) != 6:
        return None
    return values  # type: ignore[return-value]


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


def _stage_mjcf_mesh_assets(bundle_result: BundleMeshAssetsResult, mjcf_path: Path) -> None:
    mesh_targets_by_name: dict[str, set[str]] = defaultdict(set)
    for asset in bundle_result.bundled:
        source_path = Path(asset.target_path)
        mesh_targets_by_name[source_path.name].add(str(source_path.resolve()))

    conflicting_names = [
        mesh_name
        for mesh_name, source_paths in mesh_targets_by_name.items()
        if len(source_paths) > 1
    ]
    if conflicting_names:
        names = ", ".join(sorted(conflicting_names)[:8])
        suffix = "" if len(conflicting_names) <= 8 else " ..."
        raise MujocoWorkspaceError(
            f"MuJoCo MJCF conversion cannot stage duplicate mesh basenames: {names}{suffix}"
        )

    mesh_dir = mjcf_path.parent / "meshes"
    mesh_dir.mkdir(parents=True, exist_ok=True)
    for source_paths in mesh_targets_by_name.values():
        source_path = Path(next(iter(source_paths)))
        try:
            shutil.copy2(source_path, mesh_dir / source_path.name)
        except OSError as exc:
            raise MujocoWorkspaceError(
                f"MuJoCo MJCF conversion could not stage mesh asset: {source_path.name}"
            ) from exc


def prepare_mujoco_workspace(
    request: SimulatorWorkspacePrepareRequest,
    *,
    simulator_id: SimulatorId,
) -> PreparedMujocoWorkspace:
    prepared = prepare_simulator_workspace_package(
        request,
        workspace_root=MUJOCO_WORKSPACE_PROCESS_PARAMS.workspace_root / simulator_id,
        error=_mujoco_error,
    )
    try:
        conversion = convert_urdf_to_mjcf(prepared.robot_urdf_path.read_text(encoding="utf-8"))
    except (OSError, IluUrdfBridgeError) as exc:
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
    runtime_spec = get_simulator_runtime_spec(simulator_id)
    prepared = prepare_mujoco_workspace(
        request,
        simulator_id=simulator_id,
    )
    shared = prepared.shared_workspace
    return start_prepared_workspace_process(
        runtime_spec=runtime_spec,
        prepared=shared,
        simulator_asset_path=prepared.mjcf_path,
        simulator_asset_flag="--robot-mjcf",
        workspace_process=MUJOCO_WORKSPACE_PROCESS_PARAMS,
        error=_mujoco_error,
        simulator_label=simulator_label,
        extra_simulator_args=("--robot-urdf", str(shared.robot_urdf_path)),
    )


class MujocoSimulatorAdapter:
    simulator_id = MUJOCO_RUNTIME_SPEC.simulator_id
    label = MUJOCO_RUNTIME_SPEC.label
    capabilities = MUJOCO_RUNTIME_SPEC.capabilities_model()

    def prepare_workspace(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> SimulatorWorkspacePrepareResponse:
        return start_mujoco_workspace(
            request,
            simulator_id=self.simulator_id,
            simulator_label=self.label,
        )

    def runtime_status(self) -> SimulatorRuntimeStatus:
        return build_simulator_runtime_status(MUJOCO_RUNTIME_SPEC)


MUJOCO_SIMULATOR_ADAPTER: SimulatorAdapter = MujocoSimulatorAdapter()
