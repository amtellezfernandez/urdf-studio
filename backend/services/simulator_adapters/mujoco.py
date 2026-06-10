from __future__ import annotations

import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from backend.core.paths import BASE_DIR
from backend.models.simulator_runtime import (
    SIMULATOR_MUJOCO_ID,
    SimulatorId,
    SimulatorRuntimeSpec,
    SimulatorRuntimeStatus,
    SimulatorWorldOpenRequest,
    SimulatorWorldOpenResponse,
    get_simulator_runtime_spec,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapter,
    SimulatorAdapterError,
    build_runtime_dependency_statuses,
    format_runtime_dependency_status,
)
from backend.services.simulator_adapters.launch_package import (
    PreparedSimulatorLaunch,
    prepare_simulator_launch_package,
    wait_for_launch_readiness,
)
from backend.services.simulator_adapters.params import MUJOCO_LAUNCH_PARAMS
from backend.services.ilu_urdf import (
    BundleMeshAssetsResult,
    IluUrdfBridgeError,
    convert_urdf_to_mjcf,
)


MUJOCO_RUNTIME_SPEC = get_simulator_runtime_spec(SIMULATOR_MUJOCO_ID)


class MujocoWorldLaunchError(SimulatorAdapterError):
    pass


@dataclass(frozen=True)
class PreparedMujocoLaunch:
    shared_launch: PreparedSimulatorLaunch
    mjcf_path: Path


_MUJOCO_MIN_INERTIAL_MASS = 1e-9
_MUJOCO_MIN_INERTIA_DIAGONAL = 1e-12
_MUJOCO_INERTIA_SHIFT_ATTEMPTS = 12


def _mujoco_error(message: str) -> MujocoWorldLaunchError:
    return MujocoWorldLaunchError(message)


def _mujoco_runtime_status(spec: SimulatorRuntimeSpec) -> SimulatorRuntimeStatus:
    dependencies = build_runtime_dependency_statuses(spec.dependencies)
    available, status = format_runtime_dependency_status(
        ready_status="ready",
        missing_status_prefix="Missing dependency",
        dependencies=dependencies,
    )
    return SimulatorRuntimeStatus(
        runtimeName=spec.simulator_id,
        available=available,
        status=status,
        dependencies=dependencies,
    )


def _parse_float_attr(element: ET.Element, attr_name: str) -> float | None:
    raw = element.get(attr_name)
    if raw is None:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _has_positive_diagonal_inertia(inertial: ET.Element) -> bool:
    diaginertia = inertial.get("diaginertia")
    if not diaginertia:
        return False
    try:
        values = [float(value) for value in diaginertia.split()]
    except ValueError:
        return False
    return len(values) == 3 and all(value > _MUJOCO_MIN_INERTIA_DIAGONAL for value in values)


def _has_positive_full_inertia(inertial: ET.Element) -> bool:
    fullinertia = inertial.get("fullinertia")
    if not fullinertia:
        return False
    try:
        ixx, iyy, izz, ixy, ixz, iyz = [float(value) for value in fullinertia.split()]
    except ValueError:
        return False
    if ixx <= _MUJOCO_MIN_INERTIA_DIAGONAL:
        return False
    determinant_2x2 = (ixx * iyy) - (ixy * ixy)
    if determinant_2x2 <= _MUJOCO_MIN_INERTIA_DIAGONAL:
        return False
    determinant_3x3 = (
        ixx * ((iyy * izz) - (iyz * iyz))
        - ixy * ((ixy * izz) - (ixz * iyz))
        + ixz * ((ixy * iyz) - (ixz * iyy))
    )
    return determinant_3x3 > _MUJOCO_MIN_INERTIA_DIAGONAL


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
    base_scale = max(abs(value) for value in values) or _MUJOCO_MIN_INERTIA_DIAGONAL

    for attempt in range(_MUJOCO_INERTIA_SHIFT_ATTEMPTS):
        diagonal_shift = (10**attempt) * base_scale * 1e-9
        candidate = (
            max(ixx, _MUJOCO_MIN_INERTIA_DIAGONAL) + diagonal_shift,
            max(iyy, _MUJOCO_MIN_INERTIA_DIAGONAL) + diagonal_shift,
            max(izz, _MUJOCO_MIN_INERTIA_DIAGONAL) + diagonal_shift,
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


def sanitize_mjcf_inertials(mjcf_content: str) -> tuple[str, tuple[str, ...]]:
    root = ET.fromstring(mjcf_content)
    warnings: list[str] = []

    for body in root.findall(".//body"):
        inertial = body.find("inertial")
        if inertial is None:
            continue

        mass = _parse_float_attr(inertial, "mass")
        has_valid_inertia = _has_positive_diagonal_inertia(inertial) or _has_positive_full_inertia(inertial)
        if mass is not None and mass > _MUJOCO_MIN_INERTIAL_MASS and has_valid_inertia:
            continue

        body_name = body.get("name", "<unnamed-body>")
        if _body_needs_only_frame_inertial(body):
            body.remove(inertial)
            warnings.append(f"Removed invalid frame inertial from MJCF body '{body_name}'.")
            continue

        inertial.set("mass", f"{max(mass or 0.0, _MUJOCO_MIN_INERTIAL_MASS):.12g}")
        full_inertia = _parse_full_inertia(inertial)
        regularized_full_inertia = (
            _regularize_full_inertia(full_inertia)
            if full_inertia is not None and (mass or 0.0) > _MUJOCO_MIN_INERTIAL_MASS
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
                f"{_MUJOCO_MIN_INERTIA_DIAGONAL:.12g} "
                f"{_MUJOCO_MIN_INERTIA_DIAGONAL:.12g} "
                f"{_MUJOCO_MIN_INERTIA_DIAGONAL:.12g}"
            )
        warnings.append(f"Regularized invalid inertial on MJCF body '{body_name}'.")

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
        raise MujocoWorldLaunchError(
            f"MuJoCo MJCF conversion cannot stage duplicate mesh basenames: {names}{suffix}"
        )

    mesh_dir = mjcf_path.parent / "meshes"
    mesh_dir.mkdir(parents=True, exist_ok=True)
    for source_paths in mesh_targets_by_name.values():
        source_path = Path(next(iter(source_paths)))
        try:
            shutil.copy2(source_path, mesh_dir / source_path.name)
        except OSError as exc:
            raise MujocoWorldLaunchError(
                f"MuJoCo MJCF conversion could not stage mesh asset: {source_path.name}"
            ) from exc


def _prepare_mujoco_launch(
    request: SimulatorWorldOpenRequest,
    *,
    simulator_id: SimulatorId,
) -> PreparedMujocoLaunch:
    prepared = prepare_simulator_launch_package(
        request,
        launch_root=MUJOCO_LAUNCH_PARAMS.launch_root / simulator_id,
        error=_mujoco_error,
    )
    try:
        conversion = convert_urdf_to_mjcf(prepared.robot_urdf_path.read_text(encoding="utf-8"))
    except (OSError, IluUrdfBridgeError) as exc:
        raise MujocoWorldLaunchError(f"MuJoCo MJCF conversion failed: {exc}") from exc

    if not conversion.mjcf_content.strip():
        details = "; ".join(conversion.warnings) or "empty MJCF output"
        raise MujocoWorldLaunchError(f"MuJoCo MJCF conversion failed: {details}")
    sanitized_mjcf_content, sanitize_warnings = sanitize_mjcf_inertials(conversion.mjcf_content)

    mjcf_path = prepared.launch_dir / "robot" / "robot.xml"
    mjcf_path.parent.mkdir(parents=True, exist_ok=True)
    mjcf_path.write_text(sanitized_mjcf_content, encoding="utf-8")
    _stage_mjcf_mesh_assets(prepared.bundle_result, mjcf_path)
    if sanitize_warnings:
        print(
            "[mujoco-launch] "
            + " ".join(sanitize_warnings),
            flush=True,
        )
    return PreparedMujocoLaunch(
        shared_launch=prepared,
        mjcf_path=mjcf_path,
    )


def launch_mujoco_world(
    request: SimulatorWorldOpenRequest,
    *,
    simulator_id: SimulatorId,
    simulator_label: str,
) -> SimulatorWorldOpenResponse:
    prepared = _prepare_mujoco_launch(
        request,
        simulator_id=simulator_id,
    )
    shared = prepared.shared_launch
    log_path = shared.launch_dir / MUJOCO_LAUNCH_PARAMS.log_name
    command = [
        sys.executable,
        "-u",
        "-m",
        MUJOCO_LAUNCH_PARAMS.module_name,
        "--world-package",
        str(shared.world_package_path),
        "--robot-mjcf",
        str(prepared.mjcf_path),
        "--frame-map",
        "auto",
    ]
    with log_path.open("ab", buffering=0) as log_file:
        process = subprocess.Popen(
            command,
            cwd=BASE_DIR,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    wait_for_launch_readiness(
        process,
        simulator_label=simulator_label,
        log_path=log_path,
        ready_log_marker=MUJOCO_LAUNCH_PARAMS.ready_log_marker,
        log_tail_chars=MUJOCO_LAUNCH_PARAMS.log_tail_chars,
        poll_sec=MUJOCO_LAUNCH_PARAMS.startup_poll_sec,
        ready_timeout_sec=MUJOCO_LAUNCH_PARAMS.ready_timeout_sec,
        post_ready_grace_sec=MUJOCO_LAUNCH_PARAMS.post_ready_grace_sec,
        error=_mujoco_error,
    )
    return SimulatorWorldOpenResponse(
        simulator_id=simulator_id,
        started=True,
        pid=process.pid,
        command=command,
        log_path=str(log_path),
        world_package_path=str(shared.world_package_path),
        robot_urdf_path=str(shared.robot_urdf_path),
        simulator_asset_path=str(prepared.mjcf_path),
        simulator_asset_format="mjcf",
        bundled_mesh_count=shared.bundle_result.copied_files,
        unresolved_mesh_refs=list(shared.bundle_result.unresolved),
    )


class MujocoSimulatorAdapter:
    simulator_id = MUJOCO_RUNTIME_SPEC.simulator_id
    label = MUJOCO_RUNTIME_SPEC.label
    capabilities = MUJOCO_RUNTIME_SPEC.capabilities_model()

    def open_world(self, request: SimulatorWorldOpenRequest) -> SimulatorWorldOpenResponse:
        return launch_mujoco_world(
            request,
            simulator_id=self.simulator_id,
            simulator_label=self.label,
        )

    def runtime_status(self) -> SimulatorRuntimeStatus:
        return _mujoco_runtime_status(MUJOCO_RUNTIME_SPEC)


MUJOCO_SIMULATOR_ADAPTER: SimulatorAdapter = MujocoSimulatorAdapter()
