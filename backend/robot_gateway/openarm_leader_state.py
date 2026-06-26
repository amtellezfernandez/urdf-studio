from __future__ import annotations

import importlib
import math
from dataclasses import dataclass
from pathlib import Path
from threading import RLock, Timer
from time import monotonic, time
from typing import Any, Literal, Sequence

from pydantic import BaseModel, ConfigDict, Field

from backend.robot_gateway.params import (
    ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_BOTH,
    ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_LEFT,
    ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT,
    ROBOT_GATEWAY_OPENARM_LEADER_READER_IDLE_TIMEOUT_SEC,
    ROBOT_GATEWAY_OPENARM_MINI_DEFAULT_DRIVE_MODE,
    ROBOT_GATEWAY_OPENARM_MINI_DEFAULT_HOMING_OFFSET,
    ROBOT_GATEWAY_OPENARM_MINI_FEETECH_POSITION_MAX,
    ROBOT_GATEWAY_OPENARM_MINI_FEETECH_POSITION_MIN,
    ROBOT_GATEWAY_OPENARM_MINI_GRIPPER_TO_DEGREES,
    ROBOT_GATEWAY_OPENARM_MINI_JOINT_NAMES,
    ROBOT_GATEWAY_OPENARM_MINI_JOINT_REMAP,
    ROBOT_GATEWAY_OPENARM_MINI_LEFT_MOTORS_TO_FLIP,
    ROBOT_GATEWAY_OPENARM_MINI_MOTOR_IDS,
    ROBOT_GATEWAY_OPENARM_MINI_MOTOR_MODEL,
    ROBOT_GATEWAY_OPENARM_MINI_RIGHT_MOTORS_TO_FLIP,
    ROBOT_GATEWAY_SECONDS_TO_MS,
    ROBOT_GATEWAY_LEROBOT_ACTION_POSITION_SUFFIX,
    ROBOT_GATEWAY_LEROBOT_CALIBRATION_ROOT_DEFAULT,
    ROBOT_GATEWAY_LEROBOT_GRIPPER_CLOSED_RAD,
    ROBOT_GATEWAY_LEROBOT_GRIPPER_JOINT_NAMES,
    ROBOT_GATEWAY_LEROBOT_GRIPPER_OPEN_RAD,
    ROBOT_GATEWAY_LEROBOT_GRIPPER_UNITS_PER_RAD,
    ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE,
    ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_ZERO_PORT_PREFIX,
    ROBOT_GATEWAY_LEROBOT_ROBOT_CALIBRATION_RELATIVE_DIR,
    ROBOT_GATEWAY_LEROBOT_FOLLOWER_PROFILE_SUFFIX,
    ROBOT_GATEWAY_LEROBOT_LEADER_PROFILE_SUFFIX,
    ROBOT_GATEWAY_LEROBOT_SINGLE_PORT_TELEOPERATOR_TYPES,
    ROBOT_GATEWAY_LEROBOT_SO_STYLE_PROFILE_PREFIX,
    ROBOT_GATEWAY_LEROBOT_SO_STYLE_REVERSED_MODEL_JOINT_NAMES,
    ROBOT_GATEWAY_LEROBOT_TELEOPERATOR_CONFIG_MODULES,
    ROBOT_GATEWAY_LEROBOT_TELEOPERATOR_CALIBRATION_RELATIVE_DIR,
    ROBOT_GATEWAY_LEROBOT_USE_DEGREES_TELEOPERATOR_TYPES,
)
from backend.robot_gateway.lerobot_calibration_files import (
    LeRobotCalibrationGroup,
    parse_int,
    read_lerobot_calibration_groups,
)
from backend.robot_gateway.serial_port_access import robot_gateway_port_serial_lock

OpenArmLeaderStateSide = Literal["left", "right", "both"]


class OpenArmLeaderJointTelemetry(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    position_rad: float = Field(alias="positionRad")
    velocity_rad_per_sec: float | None = Field(default=None, alias="velocityRadPerSec")
    torque_nm: float | None = Field(default=None, alias="torqueNm")
    motor_id: int | None = Field(default=None, alias="motorId")


class OpenArmLeaderStateResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    connected: bool
    port: str
    side: OpenArmLeaderStateSide
    source_ts_ms: int = Field(alias="sourceTsMs")
    joints: dict[str, OpenArmLeaderJointTelemetry] = Field(default_factory=dict)
    error: str | None = None


class OpenArmLeaderReleaseRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    port: str | None = None
    port_left: str | None = Field(default=None, alias="portLeft")
    port_right: str | None = Field(default=None, alias="portRight")
    motor_ids: list[int] | None = Field(default=None, alias="motorIds")
    motor_model: str | None = Field(default=None, alias="motorModel")
    calibration_category: str | None = Field(default=None, alias="calibrationCategory")
    calibration_profile: str | None = Field(default=None, alias="calibrationProfile")
    calibration_id: str | None = Field(default=None, alias="calibrationId")
    calibration_group: str | None = Field(default=None, alias="calibrationGroup")


@dataclass(frozen=True)
class _LeaderCalibrationRef:
    category: str
    profile_id: str
    calibration_id: str
    group_id: str


class OpenArmLeaderReleaseResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    released: int


class _OpenArmMiniLeaderReader:
    def __init__(self, port: str):
        self.port = port
        self._bus: Any | None = None

    def read(self) -> dict[str, float]:
        bus = self._get_bus()
        positions = bus.sync_read("Present_Position")
        return {
            motor_name: float(position_deg)
            for motor_name, position_deg in positions.items()
            if isinstance(position_deg, int | float)
        }

    def disconnect(self) -> None:
        if self._bus is None:
            return
        try:
            self._bus.disconnect(disable_torque=False)
        finally:
            self._bus = None

    def _get_bus(self) -> Any:
        if self._bus is not None and self._bus.is_connected:
            return self._bus

        from lerobot.motors import Motor, MotorCalibration, MotorNormMode
        from lerobot.motors.feetech import FeetechMotorsBus

        motors = {
            motor_name: Motor(
                motor_id,
                ROBOT_GATEWAY_OPENARM_MINI_MOTOR_MODEL,
                (
                    MotorNormMode.RANGE_0_100
                    if motor_name == "gripper"
                    else MotorNormMode.DEGREES
                ),
            )
            for motor_name, motor_id in zip(
                ROBOT_GATEWAY_OPENARM_MINI_JOINT_NAMES,
                ROBOT_GATEWAY_OPENARM_MINI_MOTOR_IDS,
                strict=True,
            )
        }
        calibration = {
            motor_name: MotorCalibration(
                id=motor_id,
                drive_mode=ROBOT_GATEWAY_OPENARM_MINI_DEFAULT_DRIVE_MODE,
                homing_offset=ROBOT_GATEWAY_OPENARM_MINI_DEFAULT_HOMING_OFFSET,
                range_min=ROBOT_GATEWAY_OPENARM_MINI_FEETECH_POSITION_MIN,
                range_max=ROBOT_GATEWAY_OPENARM_MINI_FEETECH_POSITION_MAX,
            )
            for motor_name, motor_id in zip(
                ROBOT_GATEWAY_OPENARM_MINI_JOINT_NAMES,
                ROBOT_GATEWAY_OPENARM_MINI_MOTOR_IDS,
                strict=True,
            )
        }
        bus = FeetechMotorsBus(
            port=self.port,
            motors=motors,
            calibration=calibration,
        )
        bus.connect()
        self._bus = bus
        return bus


class _GenericFeetechLeaderReader:
    def __init__(
        self,
        port: str,
        motor_ids: Sequence[int],
        motor_model: str | None,
        calibration_ref: _LeaderCalibrationRef | None,
    ):
        self.port = port
        self.motor_ids = tuple(motor_ids)
        self.motor_model = (
            motor_model.strip() if isinstance(motor_model, str) and motor_model.strip()
            else ROBOT_GATEWAY_OPENARM_MINI_MOTOR_MODEL
        )
        self.calibration_ref = calibration_ref
        self._bus: Any | None = None

    def read(self) -> dict[str, float]:
        bus = self._get_bus()
        positions = bus.sync_read("Present_Position")
        return {
            motor_name: float(position_deg)
            for motor_name, position_deg in positions.items()
            if isinstance(position_deg, int | float)
        }

    def disconnect(self) -> None:
        if self._bus is None:
            return
        try:
            self._bus.disconnect(disable_torque=False)
        finally:
            self._bus = None

    def _get_bus(self) -> Any:
        if self._bus is not None and self._bus.is_connected:
            return self._bus

        from lerobot.motors import Motor, MotorCalibration, MotorNormMode
        from lerobot.motors.feetech import FeetechMotorsBus

        calibration_group = _load_lerobot_axis_calibration_group(
            self.motor_ids,
            self.calibration_ref,
        )
        motor_names = (
            calibration_group.joint_names
            if calibration_group is not None
            else tuple(
                f"leader_axis_{index + 1}"
                for index, _motor_id in enumerate(self.motor_ids)
            )
        )
        motors = {
            motor_name: Motor(
                motor_id,
                self.motor_model,
                _resolve_lerobot_motor_norm_mode(motor_name, MotorNormMode),
            )
            for motor_name, motor_id in zip(motor_names, self.motor_ids, strict=True)
        }
        calibration = _build_lerobot_axis_calibration(
            calibration_group,
            motor_names=motor_names,
            motor_calibration_cls=MotorCalibration,
        ) or {
            motor_name: MotorCalibration(
                id=motor.id,
                drive_mode=ROBOT_GATEWAY_OPENARM_MINI_DEFAULT_DRIVE_MODE,
                homing_offset=ROBOT_GATEWAY_OPENARM_MINI_DEFAULT_HOMING_OFFSET,
                range_min=ROBOT_GATEWAY_OPENARM_MINI_FEETECH_POSITION_MIN,
                range_max=ROBOT_GATEWAY_OPENARM_MINI_FEETECH_POSITION_MAX,
            )
            for motor_name, motor in motors.items()
        }
        bus = FeetechMotorsBus(
            port=self.port,
            motors=motors,
            calibration=calibration,
        )
        bus.connect()
        self._bus = bus
        return bus


class _LeRobotTeleoperatorLeaderReader:
    def __init__(
        self,
        port: str,
        calibration_ref: _LeaderCalibrationRef,
        teleoperator_factory: Any | None = None,
    ):
        self.port = port
        self.calibration_ref = calibration_ref
        self._teleoperator_factory = teleoperator_factory
        self._teleoperator: Any | None = None

    def read(self) -> dict[str, float]:
        teleoperator = self._get_teleoperator()
        return _extract_lerobot_action_positions(teleoperator.get_action())

    def disconnect(self) -> None:
        teleoperator = self._teleoperator
        self._teleoperator = None
        if teleoperator is None:
            return
        if bool(getattr(teleoperator, "is_connected", False)):
            teleoperator.disconnect()

    def _get_teleoperator(self) -> Any:
        if self._teleoperator is not None and bool(
            getattr(self._teleoperator, "is_connected", False)
        ):
            return self._teleoperator

        teleoperator = (
            self._teleoperator_factory(self.port, self.calibration_ref)
            if self._teleoperator_factory is not None
            else _build_lerobot_teleoperator(self.port, self.calibration_ref)
        )
        teleoperator.connect(calibrate=False)
        self._teleoperator = teleoperator
        return teleoperator


def _build_lerobot_teleoperator(
    port: str,
    calibration_ref: _LeaderCalibrationRef,
) -> Any:
    _import_lerobot_teleoperator_configs()

    import draccus
    from lerobot.teleoperators import (
        TeleoperatorConfig,
        make_teleoperator_from_config,
    )

    config = draccus.decode(
        TeleoperatorConfig,
        _build_lerobot_teleoperator_config_payload(port, calibration_ref),
    )
    return make_teleoperator_from_config(config)


def _build_lerobot_teleoperator_config_payload(
    port: str,
    calibration_ref: _LeaderCalibrationRef,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "type": calibration_ref.profile_id,
        "id": calibration_ref.calibration_id,
        "calibration_dir": _resolve_lerobot_teleoperator_calibration_dir(
            calibration_ref
        ),
    }
    if calibration_ref.profile_id in ROBOT_GATEWAY_LEROBOT_USE_DEGREES_TELEOPERATOR_TYPES:
        payload["use_degrees"] = True
    if calibration_ref.profile_id in ROBOT_GATEWAY_LEROBOT_SINGLE_PORT_TELEOPERATOR_TYPES:
        return {**payload, "port": port}
    if calibration_ref.profile_id == ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE:
        return {
            **payload,
            "port_left": (
                port
                if calibration_ref.group_id == ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_LEFT
                else _build_lerobot_openarm_mini_zero_port(
                    ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_LEFT
                )
            ),
            "port_right": (
                port
                if calibration_ref.group_id == ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT
                else _build_lerobot_openarm_mini_zero_port(
                    ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT
                )
            ),
        }
    raise ValueError(f"Unsupported LeRobot teleoperator profile: {calibration_ref.profile_id}")


def _resolve_lerobot_teleoperator_calibration_dir(
    calibration_ref: _LeaderCalibrationRef,
) -> Path:
    return (
        Path(ROBOT_GATEWAY_LEROBOT_CALIBRATION_ROOT_DEFAULT).expanduser()
        / calibration_ref.category
        / calibration_ref.profile_id
    )


def _build_lerobot_openarm_mini_zero_port(side: str) -> str:
    return f"{ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_ZERO_PORT_PREFIX}/{side}"


def _import_lerobot_teleoperator_configs() -> None:
    for module_name in ROBOT_GATEWAY_LEROBOT_TELEOPERATOR_CONFIG_MODULES:
        try:
            importlib.import_module(module_name)
        except Exception:
            continue


def _extract_lerobot_action_positions(action: dict[str, Any]) -> dict[str, float]:
    positions: dict[str, float] = {}
    for raw_key, raw_value in action.items():
        if not isinstance(raw_key, str) or not raw_key.endswith(
            ROBOT_GATEWAY_LEROBOT_ACTION_POSITION_SUFFIX
        ):
            continue
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(value):
            continue
        joint_name = raw_key[: -len(ROBOT_GATEWAY_LEROBOT_ACTION_POSITION_SUFFIX)]
        if joint_name:
            positions[joint_name] = value
    return positions


def _should_use_lerobot_teleoperator_reader(
    calibration_ref: _LeaderCalibrationRef | None,
) -> bool:
    return (
        calibration_ref is not None
        and calibration_ref.category
        == ROBOT_GATEWAY_LEROBOT_TELEOPERATOR_CALIBRATION_RELATIVE_DIR
        and (
            (
                calibration_ref.profile_id
                in ROBOT_GATEWAY_LEROBOT_SINGLE_PORT_TELEOPERATOR_TYPES
                and calibration_ref.group_id == "all"
            )
            or (
                calibration_ref.profile_id
                == ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE
                and calibration_ref.group_id
                in {
                    ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_LEFT,
                    ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT,
                }
            )
        )
    )


def _resolve_lerobot_motor_norm_mode(motor_name: str, motor_norm_mode: Any) -> Any:
    if motor_name.strip().lower().endswith("gripper"):
        return motor_norm_mode.RANGE_0_100
    return motor_norm_mode.DEGREES


def _load_lerobot_axis_calibration_group(
    motor_ids: tuple[int, ...],
    calibration_ref: _LeaderCalibrationRef | None = None,
) -> LeRobotCalibrationGroup | None:
    if calibration_ref is None:
        return None
    calibration_root = Path(
        ROBOT_GATEWAY_LEROBOT_CALIBRATION_ROOT_DEFAULT
    ).expanduser()
    calibration_path = (
        calibration_root
        / calibration_ref.category
        / calibration_ref.profile_id
        / f"{calibration_ref.calibration_id}.json"
    )
    for group in read_lerobot_calibration_groups(calibration_path):
        if group.group_id == calibration_ref.group_id and group.motor_ids == motor_ids:
            return group
    return None


def _load_lerobot_axis_calibration(
    motor_ids: tuple[int, ...],
    *,
    motor_names: tuple[str, ...],
    motor_calibration_cls: Any,
    calibration_ref: _LeaderCalibrationRef | None = None,
) -> dict[str, Any] | None:
    return _build_lerobot_axis_calibration(
        _load_lerobot_axis_calibration_group(motor_ids, calibration_ref),
        motor_names=motor_names,
        motor_calibration_cls=motor_calibration_cls,
    )


def _build_lerobot_axis_calibration(
    group: LeRobotCalibrationGroup | None,
    *,
    motor_names: tuple[str, ...],
    motor_calibration_cls: Any,
) -> dict[str, Any] | None:
    if group is None or len(group.entries) != len(motor_names):
        return None
    return {
        motor_name: motor_calibration_cls(
            id=entry.motor_id,
            drive_mode=parse_int(
                entry.payload.get("drive_mode"),
                ROBOT_GATEWAY_OPENARM_MINI_DEFAULT_DRIVE_MODE,
            ),
            homing_offset=parse_int(
                entry.payload.get("homing_offset"),
                ROBOT_GATEWAY_OPENARM_MINI_DEFAULT_HOMING_OFFSET,
            ),
            range_min=parse_int(
                entry.payload.get("range_min"),
                ROBOT_GATEWAY_OPENARM_MINI_FEETECH_POSITION_MIN,
            ),
            range_max=parse_int(
                entry.payload.get("range_max"),
                ROBOT_GATEWAY_OPENARM_MINI_FEETECH_POSITION_MAX,
            ),
        )
        for motor_name, entry in zip(
            motor_names,
            group.entries,
            strict=True,
        )
    }

_LeaderReader = (
    _OpenArmMiniLeaderReader
    | _GenericFeetechLeaderReader
    | _LeRobotTeleoperatorLeaderReader
)
_LeaderReaderKey = tuple[
    str,
    tuple[int, ...] | None,
    str | None,
    _LeaderCalibrationRef | None,
]


@dataclass
class _LeaderReaderLease:
    reader: _LeaderReader
    last_used_monotonic_sec: float


class OpenArmLeaderStateService:
    def __init__(
        self,
        *,
        idle_timeout_sec: float = ROBOT_GATEWAY_OPENARM_LEADER_READER_IDLE_TIMEOUT_SEC,
    ) -> None:
        self._lock = RLock()
        self._readers: dict[_LeaderReaderKey, _LeaderReaderLease] = {}
        self._idle_timeout_sec = idle_timeout_sec
        self._idle_reaper_timer: Timer | None = None

    def read_state(
        self,
        *,
        port: str,
        side: OpenArmLeaderStateSide = ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_BOTH,
        motor_ids: Sequence[int] | None = None,
        motor_model: str | None = None,
        calibration_category: str | None = None,
        calibration_profile: str | None = None,
        calibration_id: str | None = None,
        calibration_group: str | None = None,
    ) -> OpenArmLeaderStateResult:
        normalized_port = port.strip()
        normalized_side = _normalize_side(side)
        normalized_motor_ids = _normalize_motor_ids(motor_ids)
        normalized_motor_model = _normalize_motor_model(motor_model)
        normalized_calibration_ref = _normalize_calibration_ref(
            calibration_category=calibration_category,
            calibration_profile=calibration_profile,
            calibration_id=calibration_id,
            calibration_group=calibration_group,
        )
        if not normalized_port:
            return _build_error_state(
                port=normalized_port,
                side=normalized_side,
                error="OpenArm leader port is required.",
            )

        # Resolve the reader (a dict mutation) under the service lock, then run
        # the blocking serial read under a per-port lock with the service lock
        # released. This lets two leaders on different ports (e.g. an OpenArm
        # left and right arm) read in parallel instead of serializing on either
        # the service lock or one global serial lock.
        with self._lock:
            idle_leases = self._collect_idle_leases_locked(monotonic())
            reader = self._get_reader(
                normalized_port,
                normalized_motor_ids,
                normalized_motor_model,
                normalized_calibration_ref,
            )
            self._ensure_idle_reaper_locked()
        for idle_port, idle_lease in idle_leases:
            self._disconnect_lease(idle_port, idle_lease)

        try:
            with robot_gateway_port_serial_lock(normalized_port):
                action_positions = self._read_with_fallback(
                    reader,
                    normalized_port,
                    normalized_motor_ids,
                    normalized_motor_model,
                    normalized_calibration_ref,
                )
        except Exception as exc:  # pragma: no cover - hardware/library dependent
            self._drop_reader(
                normalized_port,
                normalized_motor_ids,
                normalized_motor_model,
                normalized_calibration_ref,
            )
            return _build_error_state(
                port=normalized_port,
                side=normalized_side,
                error=f"OpenArm leader read failed: {exc}",
            )

        return OpenArmLeaderStateResult(
            connected=True,
            port=normalized_port,
            side=normalized_side,
            source_ts_ms=_now_ms(),
            joints=(
                map_lerobot_action_positions_to_joints(
                    action_positions,
                    motor_ids_by_joint_name=_resolve_lerobot_action_motor_ids(
                        action_positions,
                        motor_ids=normalized_motor_ids,
                        calibration_ref=normalized_calibration_ref,
                    ),
                    calibration_profile=(
                        normalized_calibration_ref.profile_id
                        if normalized_calibration_ref is not None
                        else None
                    ),
                )
                if normalized_motor_ids is not None
                else map_openarm_mini_positions_to_joints(
                    action_positions,
                    side=normalized_side,
                )
            ),
        )

    def _read_with_fallback(
        self,
        reader: _LeaderReader,
        port: str,
        motor_ids: tuple[int, ...] | None,
        motor_model: str | None,
        calibration_ref: _LeaderCalibrationRef | None,
    ) -> dict[str, float]:
        # Runs under this port's serial lock. The reader was resolved by the
        # caller under the service lock; only the fallback re-creation touches
        # the readers dict, so that step re-takes the service lock briefly.
        try:
            return reader.read()
        except Exception:
            if motor_ids is None or not _should_use_lerobot_teleoperator_reader(
                calibration_ref
            ):
                raise
            with self._lock:
                dropped = self._drop_reader_locked(
                    port,
                    motor_ids,
                    motor_model,
                    calibration_ref,
                )
                fallback_reader = self._get_generic_reader_locked(
                    port,
                    motor_ids,
                    motor_model,
                    calibration_ref,
                )
            # Already holding this port's serial lock (caller acquired it), so
            # disconnecting the failed reader here is safe and reentrant.
            if dropped is not None:
                try:
                    dropped.reader.disconnect()
                except Exception:
                    pass
            return fallback_reader.read()

    def _get_reader(
        self,
        port: str,
        motor_ids: tuple[int, ...] | None,
        motor_model: str | None,
        calibration_ref: _LeaderCalibrationRef | None,
    ) -> _LeaderReader:
        key = (port, motor_ids, motor_model, calibration_ref)
        lease = self._readers.get(key)
        now_monotonic_sec = monotonic()
        if lease is None:
            if motor_ids is None:
                reader: _LeaderReader = _OpenArmMiniLeaderReader(port)
            elif _should_use_lerobot_teleoperator_reader(calibration_ref):
                reader = _LeRobotTeleoperatorLeaderReader(port, calibration_ref)
            else:
                reader = _GenericFeetechLeaderReader(
                    port,
                    motor_ids,
                    motor_model,
                    calibration_ref,
                )
            self._readers[key] = _LeaderReaderLease(
                reader=reader,
                last_used_monotonic_sec=now_monotonic_sec,
            )
            return reader
        lease.last_used_monotonic_sec = now_monotonic_sec
        return lease.reader

    def _get_generic_reader_locked(
        self,
        port: str,
        motor_ids: tuple[int, ...],
        motor_model: str | None,
        calibration_ref: _LeaderCalibrationRef | None,
    ) -> _GenericFeetechLeaderReader:
        key = (port, motor_ids, motor_model, calibration_ref)
        reader = _GenericFeetechLeaderReader(
            port,
            motor_ids,
            motor_model,
            calibration_ref,
        )
        self._readers[key] = _LeaderReaderLease(
            reader=reader,
            last_used_monotonic_sec=monotonic(),
        )
        return reader

    def _drop_reader(
        self,
        port: str,
        motor_ids: tuple[int, ...] | None,
        motor_model: str | None,
        calibration_ref: _LeaderCalibrationRef | None,
    ) -> None:
        with self._lock:
            lease = self._drop_reader_locked(
                port, motor_ids, motor_model, calibration_ref
            )
        self._disconnect_lease(port, lease)

    def _drop_reader_locked(
        self,
        port: str,
        motor_ids: tuple[int, ...] | None,
        motor_model: str | None,
        calibration_ref: _LeaderCalibrationRef | None,
    ) -> _LeaderReaderLease | None:
        # Only removes the lease from the dict (under the service lock). The
        # caller disconnects the returned lease under its port lock so serial
        # I/O never runs while the service lock is held.
        return self._readers.pop((port, motor_ids, motor_model, calibration_ref), None)

    def _disconnect_lease(
        self, port: str, lease: _LeaderReaderLease | None
    ) -> None:
        if lease is None:
            return
        try:
            with robot_gateway_port_serial_lock(port):
                lease.reader.disconnect()
        except Exception:
            pass

    def _collect_idle_leases_locked(
        self, now_monotonic_sec: float
    ) -> list[tuple[str, _LeaderReaderLease]]:
        idle: list[tuple[str, _LeaderReaderLease]] = []
        for key in list(self._readers):
            lease = self._readers[key]
            if (
                now_monotonic_sec - lease.last_used_monotonic_sec
                < self._idle_timeout_sec
            ):
                continue
            self._readers.pop(key, None)
            idle.append((key[0], lease))
        if not self._readers:
            self._cancel_idle_reaper_locked()
        return idle

    def _ensure_idle_reaper_locked(self) -> None:
        if not self._readers or self._idle_reaper_timer is not None:
            return
        timer = Timer(self._idle_timeout_sec, self._reap_idle_readers)
        timer.daemon = True
        self._idle_reaper_timer = timer
        timer.start()

    def _cancel_idle_reaper_locked(self) -> None:
        if self._idle_reaper_timer is None:
            return
        self._idle_reaper_timer.cancel()
        self._idle_reaper_timer = None

    def _reap_idle_readers(self) -> None:
        with self._lock:
            self._idle_reaper_timer = None
            idle_leases = self._collect_idle_leases_locked(monotonic())
            self._ensure_idle_reaper_locked()
        for idle_port, idle_lease in idle_leases:
            self._disconnect_lease(idle_port, idle_lease)

    def release(
        self,
        *,
        port: str | None = None,
        motor_ids: Sequence[int] | None = None,
        motor_model: str | None = None,
        calibration_category: str | None = None,
        calibration_profile: str | None = None,
        calibration_id: str | None = None,
        calibration_group: str | None = None,
    ) -> OpenArmLeaderReleaseResult:
        normalized_port = port.strip() if isinstance(port, str) else None
        normalized_motor_ids = _normalize_motor_ids(motor_ids)
        normalized_motor_model = _normalize_motor_model(motor_model)
        normalized_calibration_ref = _normalize_calibration_ref(
            calibration_category=calibration_category,
            calibration_profile=calibration_profile,
            calibration_id=calibration_id,
            calibration_group=calibration_group,
        )
        leases_to_disconnect: list[tuple[str, _LeaderReaderLease]] = []
        with self._lock:
            keys = list(self._readers)
            for key_port, key_motor_ids, key_motor_model, key_calibration_ref in keys:
                if normalized_port and key_port != normalized_port:
                    continue
                if (
                    normalized_motor_ids is not None
                    and key_motor_ids != normalized_motor_ids
                ):
                    continue
                if (
                    normalized_motor_model is not None
                    and key_motor_model != normalized_motor_model
                ):
                    continue
                if (
                    normalized_calibration_ref is not None
                    and key_calibration_ref != normalized_calibration_ref
                ):
                    continue
                lease = self._readers.pop(
                    (key_port, key_motor_ids, key_motor_model, key_calibration_ref),
                    None,
                )
                if lease is None:
                    continue
                leases_to_disconnect.append((key_port, lease))
            if not self._readers:
                self._cancel_idle_reaper_locked()
        # Disconnect outside the service lock, each under its own port lock.
        for release_port, lease in leases_to_disconnect:
            self._disconnect_lease(release_port, lease)
        return OpenArmLeaderReleaseResult(released=len(leases_to_disconnect))

    def release_all(self) -> OpenArmLeaderReleaseResult:
        return self.release()


def map_openarm_mini_positions_to_joints(
    positions_deg: dict[str, float],
    *,
    side: OpenArmLeaderStateSide,
) -> dict[str, OpenArmLeaderJointTelemetry]:
    sides = _resolve_output_sides(side)
    joints: dict[str, OpenArmLeaderJointTelemetry] = {}
    for output_side in sides:
        flip_motors = (
            ROBOT_GATEWAY_OPENARM_MINI_LEFT_MOTORS_TO_FLIP
            if output_side == ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_LEFT
            else ROBOT_GATEWAY_OPENARM_MINI_RIGHT_MOTORS_TO_FLIP
        )
        for motor_name, raw_degrees in positions_deg.items():
            if not math.isfinite(raw_degrees):
                continue
            target_name = ROBOT_GATEWAY_OPENARM_MINI_JOINT_REMAP.get(
                motor_name,
                motor_name,
            )
            if motor_name == "gripper":
                joint_name = f"openarm_{output_side}_finger_joint1"
                target_degrees = raw_degrees * ROBOT_GATEWAY_OPENARM_MINI_GRIPPER_TO_DEGREES
            else:
                joint_suffix = target_name.replace("_", "")
                joint_name = f"openarm_{output_side}_{joint_suffix}"
                target_degrees = -raw_degrees if motor_name in flip_motors else raw_degrees
            joints[joint_name] = OpenArmLeaderJointTelemetry(
                position_rad=math.radians(target_degrees),
            )
    return joints


def map_lerobot_action_positions_to_joints(
    action_positions: dict[str, float],
    *,
    motor_ids_by_joint_name: dict[str, int] | None = None,
    calibration_profile: str | None = None,
) -> dict[str, OpenArmLeaderJointTelemetry]:
    joints: dict[str, OpenArmLeaderJointTelemetry] = {}
    for joint_name, action_position in action_positions.items():
        if not math.isfinite(action_position):
            continue
        joints[joint_name] = OpenArmLeaderJointTelemetry(
            position_rad=_lerobot_action_position_to_model_rad(
                joint_name,
                action_position,
                calibration_profile=calibration_profile,
            ),
            motor_id=(
                motor_ids_by_joint_name.get(joint_name)
                if motor_ids_by_joint_name is not None
                else None
            ),
        )
    return joints


def map_generic_leader_positions_to_axes(
    positions_deg: dict[str, float],
) -> dict[str, OpenArmLeaderJointTelemetry]:
    return map_lerobot_action_positions_to_joints(positions_deg)


def _resolve_lerobot_action_motor_ids(
    action_positions: dict[str, float],
    *,
    motor_ids: tuple[int, ...],
    calibration_ref: _LeaderCalibrationRef | None,
) -> dict[str, int]:
    calibration_group = _load_lerobot_axis_calibration_group(
        motor_ids,
        calibration_ref,
    )
    if calibration_group is not None:
        calibration_motor_ids = {
            entry.joint_name: entry.motor_id
            for entry in calibration_group.entries
            if entry.joint_name in action_positions
        }
        if calibration_motor_ids:
            return calibration_motor_ids
    if len(action_positions) != len(motor_ids):
        return {}
    return {
        joint_name: motor_id
        for joint_name, motor_id in zip(action_positions, motor_ids, strict=True)
    }


def _lerobot_action_position_to_model_rad(
    joint_name: str,
    value: float,
    *,
    calibration_profile: str | None = None,
) -> float:
    if joint_name in ROBOT_GATEWAY_LEROBOT_GRIPPER_JOINT_NAMES:
        return ROBOT_GATEWAY_LEROBOT_GRIPPER_CLOSED_RAD + (value / 100.0) * (
            ROBOT_GATEWAY_LEROBOT_GRIPPER_OPEN_RAD
            - ROBOT_GATEWAY_LEROBOT_GRIPPER_CLOSED_RAD
        )
    return (
        _resolve_lerobot_model_joint_direction(calibration_profile, joint_name)
        * math.radians(value)
    )


def _resolve_lerobot_model_joint_direction(
    calibration_profile: str | None,
    joint_name: str,
) -> int:
    if (
        _is_lerobot_so_style_profile(calibration_profile)
        and joint_name in ROBOT_GATEWAY_LEROBOT_SO_STYLE_REVERSED_MODEL_JOINT_NAMES
    ):
        return -1
    return 1


def _is_lerobot_so_style_profile(calibration_profile: str | None) -> bool:
    if not isinstance(calibration_profile, str):
        return False
    normalized = calibration_profile.strip().lower()
    return normalized.startswith(ROBOT_GATEWAY_LEROBOT_SO_STYLE_PROFILE_PREFIX) and (
        normalized.endswith(ROBOT_GATEWAY_LEROBOT_LEADER_PROFILE_SUFFIX)
        or normalized.endswith(ROBOT_GATEWAY_LEROBOT_FOLLOWER_PROFILE_SUFFIX)
    )


def _normalize_motor_ids(motor_ids: Sequence[int] | None) -> tuple[int, ...] | None:
    if motor_ids is None:
        return None
    normalized = tuple(
        motor_id for motor_id in motor_ids if isinstance(motor_id, int) and motor_id > 0
    )
    return normalized or None


def _normalize_motor_model(motor_model: str | None) -> str | None:
    if not isinstance(motor_model, str):
        return None
    normalized = motor_model.strip()
    if not normalized or normalized.isdigit():
        return None
    return normalized


def _normalize_calibration_ref(
    *,
    calibration_category: str | None,
    calibration_profile: str | None,
    calibration_id: str | None,
    calibration_group: str | None,
) -> _LeaderCalibrationRef | None:
    category = _normalize_calibration_category(calibration_category)
    profile_id = _normalize_non_empty_string(calibration_profile)
    normalized_calibration_id = _normalize_non_empty_string(calibration_id)
    group_id = _normalize_non_empty_string(calibration_group) or "all"
    if category is None or profile_id is None or normalized_calibration_id is None:
        return None
    return _LeaderCalibrationRef(
        category=category,
        profile_id=profile_id,
        calibration_id=normalized_calibration_id,
        group_id=group_id,
    )


def _normalize_calibration_category(value: str | None) -> str | None:
    normalized = (_normalize_non_empty_string(value) or "").lower()
    if normalized in {
        "teleop",
        "teleoperator",
        ROBOT_GATEWAY_LEROBOT_TELEOPERATOR_CALIBRATION_RELATIVE_DIR,
    }:
        return ROBOT_GATEWAY_LEROBOT_TELEOPERATOR_CALIBRATION_RELATIVE_DIR
    if normalized in {
        "robot",
        "follower",
        ROBOT_GATEWAY_LEROBOT_ROBOT_CALIBRATION_RELATIVE_DIR,
    }:
        return ROBOT_GATEWAY_LEROBOT_ROBOT_CALIBRATION_RELATIVE_DIR
    return None


def _normalize_non_empty_string(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_side(side: str) -> OpenArmLeaderStateSide:
    return (
        side
        if side
        in {
            ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_LEFT,
            ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT,
            ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_BOTH,
        }
        else ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_BOTH
    )


def _resolve_output_sides(side: OpenArmLeaderStateSide) -> tuple[Literal["left", "right"], ...]:
    if side == ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_LEFT:
        return (ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_LEFT,)
    if side == ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT:
        return (ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT,)
    return (
        ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_LEFT,
        ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT,
    )


def _build_error_state(
    *,
    port: str,
    side: OpenArmLeaderStateSide,
    error: str,
) -> OpenArmLeaderStateResult:
    return OpenArmLeaderStateResult(
        connected=False,
        port=port,
        side=side,
        source_ts_ms=_now_ms(),
        joints={},
        error=error,
    )


def _now_ms() -> int:
    return int(time() * ROBOT_GATEWAY_SECONDS_TO_MS)


openarm_leader_state_service = OpenArmLeaderStateService()
