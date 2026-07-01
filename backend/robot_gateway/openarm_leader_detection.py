from __future__ import annotations

import os
import json
from pathlib import Path
from collections.abc import Callable
from dataclasses import dataclass
from threading import RLock
from time import monotonic
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.robot_gateway.params import (
    ROBOT_GATEWAY_OPENARM_LEADER_DEV_ROOT_DEFAULT,
    ROBOT_GATEWAY_OPENARM_LEADER_FALLBACK_IDENTITY_PREFIX,
    ROBOT_GATEWAY_OPENARM_LEADER_INTERFACE_SUFFIX_PREFIX,
    ROBOT_GATEWAY_OPENARM_LEADER_LABEL_SEPARATOR,
    ROBOT_GATEWAY_OPENARM_LEADER_LABEL_WORD_SEPARATOR,
    ROBOT_GATEWAY_OPENARM_LEADER_RECOMMENDED_ENV,
    ROBOT_GATEWAY_OPENARM_LEADER_SERIAL_BY_ID_RELATIVE_DIR,
    ROBOT_GATEWAY_OPENARM_LEADER_SERIAL_BY_ID_SOURCE,
    ROBOT_GATEWAY_OPENARM_LEADER_SERIAL_CANDIDATE,
    ROBOT_GATEWAY_OPENARM_LEADER_SERIAL_LEADER_CANDIDATE,
    ROBOT_GATEWAY_OPENARM_LEADER_STABLE_IDENTITY_PREFIX,
    ROBOT_GATEWAY_OPENARM_LEADER_TTY_GLOB_SOURCE,
    ROBOT_GATEWAY_OPENARM_LEADER_TTY_GLOBS,
    ROBOT_GATEWAY_OPENARM_LEADER_USB_NAME_PREFIX,
    ROBOT_GATEWAY_LEROBOT_CALIBRATION_ROOT_DEFAULT,
    ROBOT_GATEWAY_LEROBOT_DEVICE_PORTS_FILENAME,
    ROBOT_GATEWAY_LEROBOT_ROBOT_CALIBRATION_RELATIVE_DIR,
    ROBOT_GATEWAY_LEROBOT_TELEOPERATOR_CALIBRATION_RELATIVE_DIR,
)
from backend.robot_gateway.lerobot_calibration_files import (
    read_lerobot_calibration_groups,
)
from backend.robot_gateway.serial_port_matching import serial_port_match_values
from backend.robot_gateway.providers.dora_provider import get_dora_runtime_provider_info
from backend.robot_gateway.providers.feetech_provider import (
    get_feetech_runtime_provider_info,
)
from backend.robot_gateway.providers.lerobot_provider import (
    get_lerobot_runtime_provider_info,
)
from backend.robot_gateway.providers.provider_contract import (
    RobotGatewayRuntimeProviderInfo,
)
from backend.robot_gateway.serial_port_access import robot_gateway_serial_port_lock

OpenArmLeaderDetectionSource = Literal["serial_by_id", "tty_glob"]
OpenArmLeaderType = Literal["serial_leader_candidate", "serial_candidate"]
OpenArmLeaderHardwareFamily = Literal[
    "arm_controller",
    "motor_chain",
    "serial_unknown",
]
OpenArmLeaderControlPartKind = Literal["arm", "unknown"]
_MOTOR_PROBE_CACHE_TTL_SECONDS = 1.0
_motor_probe_cache_lock = RLock()
_motor_probe_cache: dict[str, tuple[float, OpenArmLeaderMotorProbe | None]] = {}


@dataclass(frozen=True)
class _LerobotCalibrationMatch:
    category: str
    profile_id: str
    calibration_id: str
    group_id: str
    joint_names: tuple[str, ...]
    motor_ids: tuple[int, ...]
    zero_positions_rad: dict[str, float]
    configured_port: str | None = None
    configured_port_matches: bool = False
    configured_port_status: str = "none"


class OpenArmLeaderMotorProbe(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    bus: str
    motor_ids: list[int] = Field(default_factory=list, alias="motorIds")
    motor_models: dict[int, str] = Field(default_factory=dict, alias="motorModels")
    error: str | None = None


class OpenArmLeaderControlPart(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: str = Field(..., min_length=1)
    kind: OpenArmLeaderControlPartKind
    label: str = Field(..., min_length=1)
    actuator_count: int = Field(ge=0, alias="actuatorCount")
    motor_bus: str | None = Field(default=None, alias="motorBus")
    motor_ids: list[int] = Field(default_factory=list, alias="motorIds")
    motor_model: str | None = Field(default=None, alias="motorModel")
    motor_models: dict[int, str] = Field(default_factory=dict, alias="motorModels")
    joint_names: list[str] = Field(default_factory=list, alias="jointNames")
    zero_positions_rad: dict[str, float] = Field(
        default_factory=dict,
        alias="zeroPositionsRad",
    )
    calibration_category: str | None = Field(default=None, alias="calibrationCategory")
    calibration_profile: str | None = Field(default=None, alias="calibrationProfile")
    calibration_id: str | None = Field(default=None, alias="calibrationId")
    calibration_group: str | None = Field(default=None, alias="calibrationGroup")
    configured_port: str | None = Field(default=None, alias="configuredPort")
    configured_port_matches: bool = Field(
        default=False,
        alias="configuredPortMatches",
    )
    configured_port_status: str = Field(default="none", alias="configuredPortStatus")


class OpenArmLeaderDetectionDevice(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: str = Field(..., min_length=1)
    path: str = Field(..., min_length=1)
    device_path: str = Field(..., min_length=1, alias="devicePath")
    identity_key: str = Field(..., min_length=1, alias="identityKey")
    identity_stable: bool = Field(alias="identityStable")
    serial: str | None = None
    label: str = Field(..., min_length=1)
    source: OpenArmLeaderDetectionSource
    leader_type: OpenArmLeaderType = Field(alias="leaderType")
    hardware_family: OpenArmLeaderHardwareFamily = Field(
        default="serial_unknown",
        alias="hardwareFamily",
    )
    motor_bus: str | None = Field(default=None, alias="motorBus")
    motor_ids: list[int] = Field(default_factory=list, alias="motorIds")
    motor_models: dict[int, str] = Field(default_factory=dict, alias="motorModels")
    motor_count: int = Field(default=0, alias="motorCount")
    motor_probe_error: str | None = Field(default=None, alias="motorProbeError")
    control_parts: list[OpenArmLeaderControlPart] = Field(
        default_factory=list,
        alias="controlParts",
    )
    recommended_env: str = Field(
        default=ROBOT_GATEWAY_OPENARM_LEADER_RECOMMENDED_ENV,
        alias="recommendedEnv",
    )
    available: bool


class OpenArmLeaderDetectionResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    leaders: list[OpenArmLeaderDetectionDevice] = Field(default_factory=list)
    runtime_providers: list[RobotGatewayRuntimeProviderInfo] = Field(
        default_factory=list,
        alias="runtimeProviders",
    )
    preferred_leader_port: str | None = Field(
        default=None,
        alias="preferredLeaderPort",
    )


def detect_openarm_leaders(
    dev_root: Path | str = Path(ROBOT_GATEWAY_OPENARM_LEADER_DEV_ROOT_DEFAULT),
    motor_probe: Callable[[Path], OpenArmLeaderMotorProbe | None] | None = None,
) -> OpenArmLeaderDetectionResult:
    root = Path(dev_root)
    probe = motor_probe or _probe_leader_motors_cached
    serial_by_id_candidates = _iter_serial_by_id_candidates(root)
    leaders: list[OpenArmLeaderDetectionDevice] = []
    seen_device_paths: set[str] = set()

    for candidate in serial_by_id_candidates:
        device = _build_leader_device(
            candidate,
            source=ROBOT_GATEWAY_OPENARM_LEADER_SERIAL_BY_ID_SOURCE,
            leader_type=ROBOT_GATEWAY_OPENARM_LEADER_SERIAL_LEADER_CANDIDATE,
            motor_probe=probe,
        )
        leaders.append(device)
        seen_device_paths.add(device.device_path)

    for candidate in _iter_tty_candidates(root):
        device = _build_leader_device(
            candidate,
            source=ROBOT_GATEWAY_OPENARM_LEADER_TTY_GLOB_SOURCE,
            leader_type=ROBOT_GATEWAY_OPENARM_LEADER_SERIAL_CANDIDATE,
            motor_probe=probe,
        )
        if device.device_path in seen_device_paths:
            continue
        leaders.append(device)
        seen_device_paths.add(device.device_path)

    return OpenArmLeaderDetectionResult(
        leaders=leaders,
        runtime_providers=[
            get_feetech_runtime_provider_info(),
            get_lerobot_runtime_provider_info(),
            get_dora_runtime_provider_info(),
        ],
        preferred_leader_port=_resolve_preferred_leader_port(leaders),
    )


def _iter_serial_by_id_candidates(dev_root: Path) -> list[Path]:
    serial_by_id = dev_root / ROBOT_GATEWAY_OPENARM_LEADER_SERIAL_BY_ID_RELATIVE_DIR
    if not serial_by_id.is_dir():
        return []
    return sorted(
        (
            candidate
            for candidate in serial_by_id.iterdir()
            if candidate.is_symlink() or candidate.exists()
        ),
        key=lambda candidate: candidate.name,
    )


def _iter_tty_candidates(dev_root: Path) -> list[Path]:
    candidates: list[Path] = []
    for pattern in ROBOT_GATEWAY_OPENARM_LEADER_TTY_GLOBS:
        candidates.extend(candidate for candidate in dev_root.glob(pattern))
    return sorted(candidates, key=lambda candidate: candidate.name)


def _build_leader_device(
    path: Path,
    *,
    source: OpenArmLeaderDetectionSource,
    leader_type: OpenArmLeaderType,
    motor_probe: Callable[[Path], OpenArmLeaderMotorProbe | None],
) -> OpenArmLeaderDetectionDevice:
    resolved_path = path.resolve(strict=False)
    available = path.exists() and os.access(path, os.R_OK | os.W_OK)
    identity_key = _build_leader_identity_key(path, source)
    probe = motor_probe(path) if available else None
    motor_ids = sorted(probe.motor_ids) if probe else []
    hardware_family = _classify_leader_hardware_family(probe)
    return OpenArmLeaderDetectionDevice(
        id=str(path),
        path=str(path),
        device_path=str(resolved_path),
        identity_key=identity_key,
        identity_stable=source == ROBOT_GATEWAY_OPENARM_LEADER_SERIAL_BY_ID_SOURCE,
        serial=_extract_leader_serial(path, source),
        label=_format_leader_label(path),
        source=source,
        leader_type=leader_type,
        hardware_family=hardware_family,
        motor_bus=probe.bus if probe else None,
        motor_ids=motor_ids,
        motor_models=probe.motor_models if probe else {},
        motor_count=len(motor_ids),
        motor_probe_error=probe.error if probe else None,
        control_parts=_build_leader_control_parts(
            probe,
            path=path,
            resolved_path=resolved_path,
        ),
        available=available,
    )


def _classify_leader_hardware_family(
    probe: OpenArmLeaderMotorProbe | None,
) -> OpenArmLeaderHardwareFamily:
    if probe is None or probe.error or not probe.motor_ids:
        return "serial_unknown"
    motor_ids = sorted(set(probe.motor_ids))
    return "arm_controller" if len(motor_ids) >= 4 else "motor_chain"


def _build_leader_control_parts(
    probe: OpenArmLeaderMotorProbe | None,
    *,
    path: Path,
    resolved_path: Path,
) -> list[OpenArmLeaderControlPart]:
    if probe is None or probe.error or not probe.motor_ids:
        return []
    motor_ids = sorted(set(probe.motor_ids))
    motor_models = {
        motor_id: model
        for motor_id, model in probe.motor_models.items()
        if motor_id in motor_ids
    }
    unique_models = sorted(set(motor_models.values()))
    calibration_matches = _find_lerobot_calibration_matches(
        motor_ids,
        path=path,
        resolved_path=resolved_path,
    )
    if calibration_matches:
        calibration_matches = sorted(
            calibration_matches,
            key=lambda match: 0 if match.configured_port_status == "matched" else 1,
        )
        return [
            OpenArmLeaderControlPart(
                id=(
                    f"{probe.bus}:{match.profile_id}:{match.calibration_id}:"
                    f"{match.group_id}:"
                    f"{'-'.join(str(motor_id) for motor_id in match.motor_ids)}"
                ),
                kind="arm",
                label=_format_lerobot_control_part_label(match),
                actuator_count=len(match.motor_ids),
                motor_bus=probe.bus,
                motor_ids=list(match.motor_ids),
                motor_model=(
                    unique_models[0]
                    if len(unique_models) == 1 and not unique_models[0].isdigit()
                    else None
                ),
                motor_models={
                    motor_id: model
                    for motor_id, model in motor_models.items()
                    if motor_id in match.motor_ids
                },
                joint_names=list(match.joint_names),
                zero_positions_rad=match.zero_positions_rad,
                calibration_category=match.category,
                calibration_profile=match.profile_id,
                calibration_id=match.calibration_id,
                calibration_group=match.group_id,
                configured_port=match.configured_port,
                configured_port_matches=match.configured_port_matches,
                configured_port_status=match.configured_port_status,
            )
            for match in calibration_matches
        ]
    kind: OpenArmLeaderControlPartKind = "arm" if len(motor_ids) >= 4 else "unknown"
    label = "Arm" if kind == "arm" else "Unknown motor chain"
    return [
        OpenArmLeaderControlPart(
            id=f"{probe.bus}:{'-'.join(str(motor_id) for motor_id in motor_ids)}",
            kind=kind,
            label=label,
            actuator_count=len(motor_ids),
            motor_bus=probe.bus,
            motor_ids=motor_ids,
            motor_model=(
                unique_models[0]
                if len(unique_models) == 1 and not unique_models[0].isdigit()
                else None
            ),
            motor_models=motor_models,
        ),
    ]


def _find_lerobot_calibration_matches(
    motor_ids: list[int],
    *,
    path: Path,
    resolved_path: Path,
) -> list[_LerobotCalibrationMatch]:
    calibration_root = Path(
        ROBOT_GATEWAY_LEROBOT_CALIBRATION_ROOT_DEFAULT
    ).expanduser()
    expected_motor_ids = tuple(sorted(set(motor_ids)))
    configured_ports = _load_lerobot_device_ports(calibration_root)
    matches: list[_LerobotCalibrationMatch] = []
    for category, calibration_dir in _iter_lerobot_calibration_dirs(
        calibration_root,
    ):
        for calibration_path in sorted(calibration_dir.glob("*/*.json")):
            matches.extend(
                _parse_lerobot_calibration_matches(
                    calibration_path,
                    expected_motor_ids,
                    category=category,
                    configured_ports=configured_ports,
                    path=path,
                    resolved_path=resolved_path,
                )
            )
    return sorted(
        matches,
        key=lambda match: (
            not match.configured_port_matches,
            match.configured_port_status == "unmatched",
            match.configured_port_status == "none",
            match.category != ROBOT_GATEWAY_LEROBOT_TELEOPERATOR_CALIBRATION_RELATIVE_DIR,
            match.profile_id,
            match.calibration_id,
            match.group_id,
        ),
    )


def _parse_lerobot_calibration_matches(
    calibration_path: Path,
    expected_motor_ids: tuple[int, ...],
    *,
    category: str,
    configured_ports: dict[tuple[str, str, str], str],
    path: Path,
    resolved_path: Path,
) -> list[_LerobotCalibrationMatch]:
    profile_id = calibration_path.parent.name
    calibration_id = calibration_path.stem
    configured_port = configured_ports.get((category, profile_id, calibration_id))
    configured_port_status = _resolve_configured_port_status(
        configured_port,
        path=path,
        resolved_path=resolved_path,
    )
    configured_port_matches = configured_port_status == "matched"
    matches: list[_LerobotCalibrationMatch] = []
    for group in read_lerobot_calibration_groups(calibration_path):
        if group.motor_ids != expected_motor_ids:
            continue
        matches.append(
            _LerobotCalibrationMatch(
                category=category,
                profile_id=profile_id,
                calibration_id=calibration_id,
                group_id=group.group_id,
                joint_names=group.joint_names,
                motor_ids=group.motor_ids,
                zero_positions_rad=group.zero_positions_rad,
                configured_port=configured_port,
                configured_port_matches=configured_port_matches,
                configured_port_status=configured_port_status,
            )
        )
    return matches


def _iter_lerobot_calibration_dirs(
    calibration_root: Path,
) -> list[tuple[str, Path]]:
    return [
        (category, calibration_dir)
        for category in (
            ROBOT_GATEWAY_LEROBOT_TELEOPERATOR_CALIBRATION_RELATIVE_DIR,
            ROBOT_GATEWAY_LEROBOT_ROBOT_CALIBRATION_RELATIVE_DIR,
        )
        if (calibration_dir := calibration_root / category).is_dir()
    ]


def _load_lerobot_device_ports(
    calibration_root: Path,
) -> dict[tuple[str, str, str], str]:
    device_ports_path = calibration_root / ROBOT_GATEWAY_LEROBOT_DEVICE_PORTS_FILENAME
    try:
        payload = json.loads(device_ports_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    ports: dict[tuple[str, str, str], str] = {}
    for raw_category, raw_profiles in payload.items():
        category = _normalize_device_ports_category(raw_category)
        if category is None or not isinstance(raw_profiles, dict):
            continue
        ports.update(_parse_lerobot_device_ports_category(category, raw_profiles))
    return ports


def _parse_lerobot_device_ports_category(
    category: str,
    profiles: dict[Any, Any],
) -> dict[tuple[str, str, str], str]:
    ports: dict[tuple[str, str, str], str] = {}
    for raw_profile_id, raw_calibrations in profiles.items():
        if not isinstance(raw_profile_id, str) or not isinstance(raw_calibrations, dict):
            continue
        profile_id = raw_profile_id.strip()
        if not profile_id:
            continue
        for raw_calibration_id, raw_port in raw_calibrations.items():
            if not isinstance(raw_calibration_id, str) or not isinstance(raw_port, str):
                continue
            calibration_id = raw_calibration_id.strip()
            port = raw_port.strip()
            if calibration_id and port:
                ports[(category, profile_id, calibration_id)] = port
    return ports


def _normalize_device_ports_category(raw_category: Any) -> str | None:
    if not isinstance(raw_category, str):
        return None
    category = raw_category.strip().lower()
    if category in {"teleop", "teleoperator", "teleoperators"}:
        return ROBOT_GATEWAY_LEROBOT_TELEOPERATOR_CALIBRATION_RELATIVE_DIR
    if category in {"robot", "robots", "follower", "followers"}:
        return ROBOT_GATEWAY_LEROBOT_ROBOT_CALIBRATION_RELATIVE_DIR
    return None


def _resolve_configured_port_status(
    configured_port: str | None,
    *,
    path: Path,
    resolved_path: Path,
) -> str:
    if not configured_port:
        return "none"
    configured_path = Path(configured_port).expanduser()
    configured_resolved = configured_path.resolve(strict=False)
    candidates = serial_port_match_values(
        str(path),
        str(path.resolve(strict=False)),
        str(resolved_path),
    )
    configured_candidates = serial_port_match_values(
        str(configured_path),
        str(configured_resolved),
    )
    if configured_candidates & candidates:
        return "matched"
    if not configured_path.exists():
        return "stale"
    return "unmatched"


def _format_lerobot_control_part_label(match: _LerobotCalibrationMatch) -> str:
    group_suffix = "" if match.group_id == "all" else f" · {match.group_id}"
    return f"{match.profile_id} · {match.calibration_id}{group_suffix}"


def _resolve_preferred_leader_port(
    leaders: list[OpenArmLeaderDetectionDevice],
) -> str | None:
    return next(
        (
            leader.path
            for leader in leaders
            if any(part.kind == "arm" for part in leader.control_parts)
        ),
        None,
    )


def _probe_leader_motors(path: Path) -> OpenArmLeaderMotorProbe | None:
    try:
        from lerobot.motors.feetech import FeetechMotorsBus

        with robot_gateway_serial_port_lock:
            bus = FeetechMotorsBus(str(path), {})
            try:
                bus._connect(handshake=False)  # noqa: SLF001 - no public ping-only connect.
                ids_models = bus.broadcast_ping() or {}
                return OpenArmLeaderMotorProbe(
                    bus="feetech",
                    motor_ids=sorted(ids_models),
                    motor_models={
                        int(motor_id): str(model)
                        for motor_id, model in ids_models.items()
                    },
                )
            finally:
                try:
                    bus.port_handler.closePort()
                except Exception:
                    pass
    except Exception as exc:  # pragma: no cover - hardware/library dependent
        return OpenArmLeaderMotorProbe(
            bus="feetech",
            motor_ids=[],
            error=str(exc),
        )


def _probe_leader_motors_cached(path: Path) -> OpenArmLeaderMotorProbe | None:
    cache_key = str(path.resolve(strict=False))
    now = monotonic()
    with _motor_probe_cache_lock:
        cached = _motor_probe_cache.get(cache_key)
        if cached is not None and now - cached[0] <= _MOTOR_PROBE_CACHE_TTL_SECONDS:
            return (
                cached[1].model_copy(deep=True)
                if cached[1] is not None
                else None
            )

        probe = _probe_leader_motors(path)
        _motor_probe_cache[cache_key] = (
            monotonic(),
            probe.model_copy(deep=True) if probe is not None else None,
        )
        return probe


def _format_leader_label(path: Path) -> str:
    label = _stable_serial_name(path)
    label = label.replace(
        ROBOT_GATEWAY_OPENARM_LEADER_LABEL_SEPARATOR,
        ROBOT_GATEWAY_OPENARM_LEADER_LABEL_WORD_SEPARATOR,
    ).strip()
    return label or path.name


def _stable_serial_name(path: Path) -> str:
    label = path.name
    if label.startswith(ROBOT_GATEWAY_OPENARM_LEADER_USB_NAME_PREFIX):
        label = label.removeprefix(ROBOT_GATEWAY_OPENARM_LEADER_USB_NAME_PREFIX)
    interface_suffix_index = label.rfind(
        ROBOT_GATEWAY_OPENARM_LEADER_INTERFACE_SUFFIX_PREFIX
    )
    if interface_suffix_index >= 0:
        label = label[:interface_suffix_index]
    return label


def _build_leader_identity_key(
    path: Path,
    source: OpenArmLeaderDetectionSource,
) -> str:
    if source == ROBOT_GATEWAY_OPENARM_LEADER_SERIAL_BY_ID_SOURCE:
        return (
            f"{ROBOT_GATEWAY_OPENARM_LEADER_STABLE_IDENTITY_PREFIX}"
            f"{_stable_serial_name(path)}"
        )
    return f"{ROBOT_GATEWAY_OPENARM_LEADER_FALLBACK_IDENTITY_PREFIX}{path.name}"


def _extract_leader_serial(
    path: Path,
    source: OpenArmLeaderDetectionSource,
) -> str | None:
    if source != ROBOT_GATEWAY_OPENARM_LEADER_SERIAL_BY_ID_SOURCE:
        return None
    parts = [
        part
        for part in _stable_serial_name(path).split(
            ROBOT_GATEWAY_OPENARM_LEADER_LABEL_SEPARATOR
        )
        if part
    ]
    return parts[-1] if parts else None
