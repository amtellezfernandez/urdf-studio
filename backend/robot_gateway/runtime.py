from __future__ import annotations

from dataclasses import dataclass, field
import os
from pathlib import Path
from time import time

from backend.models.robot_gateway import (
    RobotGatewayAdapterKind,
    RobotGatewayCapabilitySet,
    RobotGatewayControlAck,
    RobotGatewayLeaseRequest,
    RobotGatewayLeaseResponse,
    RobotGatewayManifest,
    RobotGatewayOpenArmCanDryRunPlan,
    RobotGatewayPointCloudFrame,
    RobotGatewayRuntimeMode,
    RobotGatewaySessionSnapshot,
    RobotGatewayStateFrame,
    RobotGatewayStatsSnapshot,
    RobotGatewayJointJogRequest,
    RobotGatewayOpenArmCalibrationJogRequest,
    RobotGatewayTwistRequest,
)
from backend.robot_gateway.adapters import (
    RobotGatewayCalibrationReloadResult,
    RobotGatewayAdapter,
    RobotGatewayAdapterConfig,
    build_robot_gateway_adapter,
)
from backend.robot_gateway.config_file import build_robot_gateway_connection_modes
from backend.robot_gateway.control_transport import (
    build_robot_gateway_control_transport,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_ADAPTER_KIND_ENV,
    ROBOT_GATEWAY_CONTROL_LEASE_OWNER_MISMATCH_REASON,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_FUTURE_TIMESTAMP_REASON,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_MAX_AGE_MS,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_MAX_FUTURE_SKEW_MS,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_STALE_REASON,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_REPLAYED_SEQUENCE_REASON,
    ROBOT_GATEWAY_DEFAULT_SESSION_ID,
    ROBOT_GATEWAY_JOINT_NAMES_ENV,
    ROBOT_GATEWAY_JOINT_NAMES_SEPARATOR,
    ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
    ROBOT_GATEWAY_LEROBOT_CALIBRATION_DIR_ENV,
    ROBOT_GATEWAY_LEROBOT_CONFIG_JSON_ENV,
    ROBOT_GATEWAY_LEROBOT_HARDWARE_JOINT_NAMES_ENV,
    ROBOT_GATEWAY_LEROBOT_ID_ENV,
    ROBOT_GATEWAY_LEROBOT_PORT_ENV,
    ROBOT_GATEWAY_LEROBOT_ROBOT_TYPE_ENV,
    ROBOT_GATEWAY_MODEL_ROBOT_ALIASES_ENV,
    ROBOT_GATEWAY_MODEL_ROBOT_ID_ENV,
    ROBOT_GATEWAY_OPENARM_ALLOW_UNVALIDATED_SELF_COLLISION_ENV,
    ROBOT_GATEWAY_OPENARM_CAN_TRUE_VALUES,
    ROBOT_GATEWAY_ROBOT_ID_ENV,
    ROBOT_GATEWAY_RUNTIME_MODE_ENV,
    ROBOT_GATEWAY_SUPPORTED_ADAPTER_IDS,
)
from backend.robot_gateway.live_transport import build_robot_gateway_live_transport
from backend.robot_gateway.profile_targets import build_robot_gateway_manifest_profiles


@dataclass
class RobotGatewayRuntimeConfig:
    runtime_mode: RobotGatewayRuntimeMode = "observe"
    adapter_config: RobotGatewayAdapterConfig = field(
        default_factory=RobotGatewayAdapterConfig
    )


class RobotGatewayRuntime:
    def __init__(
        self,
        config: RobotGatewayRuntimeConfig | None = None,
        adapter: RobotGatewayAdapter | None = None,
    ) -> None:
        self._config = config or RobotGatewayRuntimeConfig()
        self._adapter = adapter or build_robot_gateway_adapter(
            self._config.adapter_config
        )
        self._lease_owner: str | None = None
        self._last_control_datagram_sequences: dict[tuple[str, str], int] = {}

    @property
    def control_enabled(self) -> bool:
        return self._config.runtime_mode == "control"

    @property
    def config(self) -> RobotGatewayRuntimeConfig:
        return self._config

    def get_manifest(self) -> RobotGatewayManifest:
        profile = self._adapter.build_profile(control_enabled=self.control_enabled)
        profiles = build_robot_gateway_manifest_profiles(profile)
        camera_streams = self._adapter.build_camera_streams()
        control_transport = build_robot_gateway_control_transport()
        return RobotGatewayManifest(
            connection_modes=build_robot_gateway_connection_modes(),
            capabilities=RobotGatewayCapabilitySet(
                observe=True,
                telemetry=True,
                control=self.control_enabled,
                estop=True,
            ),
            profiles=profiles,
            camera_streams=camera_streams,
            live_transport=build_robot_gateway_live_transport(
                adapter_id=self._adapter.adapter_id,
                robot_id=profile.robot_id,
                camera_streams=camera_streams,
            ),
            control_transport=(
                control_transport
                if self.control_enabled and control_transport.sidecar_ready
                else None
            ),
        )

    def get_session(self) -> RobotGatewaySessionSnapshot:
        profile = self._adapter.build_profile(control_enabled=self.control_enabled)
        return RobotGatewaySessionSnapshot(
            state="active",
            current_session_id=ROBOT_GATEWAY_DEFAULT_SESSION_ID,
            robot_id=profile.robot_id,
            model_robot_id=_resolve_model_robot_id(self._adapter.config),
            model_robot_aliases=list(self._adapter.config.model_robot_aliases),
            mode="manual" if self.control_enabled else "safe_hold",
            runtime_mode=self._config.runtime_mode,
            adapter_id=self._adapter.adapter_id,
            teleoperation_mode=self._adapter.teleoperation_mode,
            active_profile_id=profile.id,
            control_lease_owner=self._lease_owner,
        )

    def get_stats(self) -> RobotGatewayStatsSnapshot:
        return RobotGatewayStatsSnapshot(
            robot_state={
                "mode": "manual"
                if self.control_enabled
                else "safe_hold",
                "connection_state": "active",
                "estop": False,
                "control_rtt_ms": 0.0,
                "adapter_id": self._adapter.adapter_id,
                "runtime_mode": self._config.runtime_mode,
                "teleoperation_mode": self._adapter.teleoperation_mode,
            }
        )

    def read_state(self) -> RobotGatewayStateFrame:
        return self._adapter.read_state()

    def read_point_cloud(self, camera_id: str) -> RobotGatewayPointCloudFrame:
        return self._adapter.read_point_cloud(camera_id)

    def request_lease(self, req: RobotGatewayLeaseRequest) -> RobotGatewayLeaseResponse:
        if not self.control_enabled:
            return RobotGatewayLeaseResponse(
                accepted=False,
                operator_id=req.operator_id,
                profile_id=req.profile_id,
                reason="Gateway is in observe mode.",
            )
        if self._lease_owner and self._lease_owner != req.operator_id:
            return RobotGatewayLeaseResponse(
                accepted=False,
                operator_id=req.operator_id,
                profile_id=req.profile_id,
                reason=f"Control lease is already held by {self._lease_owner}.",
            )
        self._lease_owner = req.operator_id
        self._last_control_datagram_sequences.pop(
            (ROBOT_GATEWAY_DEFAULT_SESSION_ID, req.operator_id),
            None,
        )
        return RobotGatewayLeaseResponse(
            accepted=True,
            operator_id=req.operator_id,
            profile_id=req.profile_id,
            reason="Control lease granted.",
        )

    def release_lease(self, req: RobotGatewayLeaseRequest) -> RobotGatewayLeaseResponse:
        if self._lease_owner != req.operator_id:
            return RobotGatewayLeaseResponse(
                accepted=False,
                operator_id=req.operator_id,
                profile_id=req.profile_id,
                reason="Operator does not hold the active lease.",
            )
        self._lease_owner = None
        self._last_control_datagram_sequences.pop(
            (ROBOT_GATEWAY_DEFAULT_SESSION_ID, req.operator_id),
            None,
        )
        return RobotGatewayLeaseResponse(
            accepted=True,
            operator_id=req.operator_id,
            profile_id=req.profile_id,
            reason="Control lease released.",
        )

    def release_hardware(self) -> int:
        self._lease_owner = None
        self._last_control_datagram_sequences.clear()
        return self._adapter.disconnect()

    def reload_lerobot_calibration_file(
        self,
        calibration_path: Path,
    ) -> RobotGatewayCalibrationReloadResult:
        return self._adapter.reload_lerobot_calibration_file(calibration_path)

    def reject_replayed_control_datagram(
        self,
        *,
        session_id: str,
        peer_id: str,
        sequence: int,
    ) -> str | None:
        last_sequence = self._last_control_datagram_sequences.get((session_id, peer_id))
        if last_sequence is not None and sequence <= last_sequence:
            return ROBOT_GATEWAY_CONTROL_DATAGRAM_REPLAYED_SEQUENCE_REASON
        return None

    def record_accepted_control_datagram(
        self,
        *,
        session_id: str,
        peer_id: str,
        sequence: int,
    ) -> None:
        self._last_control_datagram_sequences[(session_id, peer_id)] = sequence

    def apply_joint_jog(
        self, req: RobotGatewayJointJogRequest
    ) -> RobotGatewayControlAck:
        timestamp_rejection_reason = self._reject_stale_control_timestamp(
            req.source_ts_ms
        )
        if timestamp_rejection_reason is not None:
            return RobotGatewayControlAck(
                accepted=False,
                reason=timestamp_rejection_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        if not self.control_enabled:
            return RobotGatewayControlAck(
                accepted=False,
                reason="Gateway is in observe mode.",
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        if self._lease_owner is None:
            return RobotGatewayControlAck(
                accepted=False,
                reason="No active control lease.",
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        if req.operator_id != self._lease_owner:
            return RobotGatewayControlAck(
                accepted=False,
                reason=ROBOT_GATEWAY_CONTROL_LEASE_OWNER_MISMATCH_REASON,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        return self._adapter.apply_joint_jog(req)

    def apply_openarm_calibration_jog(
        self,
        req: RobotGatewayOpenArmCalibrationJogRequest,
    ) -> RobotGatewayControlAck:
        timestamp_rejection_reason = self._reject_stale_control_timestamp(
            req.source_ts_ms
        )
        if timestamp_rejection_reason is not None:
            return RobotGatewayControlAck(
                accepted=False,
                reason=timestamp_rejection_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        if not self.control_enabled:
            return RobotGatewayControlAck(
                accepted=False,
                reason="Gateway is in observe mode.",
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        if self._lease_owner is None:
            return RobotGatewayControlAck(
                accepted=False,
                reason="No active control lease.",
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        if req.operator_id != self._lease_owner:
            return RobotGatewayControlAck(
                accepted=False,
                reason=ROBOT_GATEWAY_CONTROL_LEASE_OWNER_MISMATCH_REASON,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        return self._adapter.apply_openarm_calibration_jog(req)

    def prepare_joint_jog_can_dry_run(
        self,
        req: RobotGatewayJointJogRequest,
    ) -> RobotGatewayOpenArmCanDryRunPlan:
        timestamp_rejection_reason = self._reject_stale_control_timestamp(
            req.source_ts_ms
        )
        if timestamp_rejection_reason is not None:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason=timestamp_rejection_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        if not self.control_enabled:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason="Gateway is in observe mode.",
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        if self._lease_owner is None:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason="No active control lease.",
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        if req.operator_id != self._lease_owner:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason=ROBOT_GATEWAY_CONTROL_LEASE_OWNER_MISMATCH_REASON,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        return self._adapter.prepare_joint_jog_can_dry_run(req)

    def apply_twist(self, req: RobotGatewayTwistRequest) -> RobotGatewayControlAck:
        return RobotGatewayControlAck(
            accepted=False,
            reason="Selected OpenArm profile does not support base twist.",
            sequence=req.sequence,
        )

    def stop(self, *, sequence: int = 0) -> RobotGatewayControlAck:
        return self._adapter.stop(sequence=sequence)

    def estop(self, *, sequence: int = 0) -> RobotGatewayControlAck:
        return self._adapter.estop(sequence=sequence)

    def _reject_stale_control_timestamp(self, source_ts_ms: int) -> str | None:
        if source_ts_ms <= 0:
            return None
        now_ms = int(time() * 1000)
        if source_ts_ms < now_ms - ROBOT_GATEWAY_CONTROL_DATAGRAM_MAX_AGE_MS:
            return ROBOT_GATEWAY_CONTROL_DATAGRAM_STALE_REASON
        if source_ts_ms > now_ms + ROBOT_GATEWAY_CONTROL_DATAGRAM_MAX_FUTURE_SKEW_MS:
            return ROBOT_GATEWAY_CONTROL_DATAGRAM_FUTURE_TIMESTAMP_REASON
        return None


def _read_runtime_mode_from_env() -> RobotGatewayRuntimeMode:
    raw_mode = os.getenv(ROBOT_GATEWAY_RUNTIME_MODE_ENV, "observe").strip().lower()
    return "control" if raw_mode == "control" else "observe"


def _read_adapter_kind_from_env() -> RobotGatewayAdapterKind:
    raw_env_kind = os.getenv(ROBOT_GATEWAY_ADAPTER_KIND_ENV)
    if raw_env_kind is None:
        return "fake_openarm"
    raw_kind = raw_env_kind.strip().lower()
    if raw_kind in ROBOT_GATEWAY_SUPPORTED_ADAPTER_IDS:
        return raw_kind
    supported_adapters = ", ".join(sorted(ROBOT_GATEWAY_SUPPORTED_ADAPTER_IDS))
    raise ValueError(
        f"Unsupported {ROBOT_GATEWAY_ADAPTER_KIND_ENV}={raw_env_kind!r}. "
        f"Supported adapters: {supported_adapters}."
    )


def _read_joint_names_from_env(default_joint_names: tuple[str, ...]) -> tuple[str, ...]:
    raw_joint_names = os.getenv(ROBOT_GATEWAY_JOINT_NAMES_ENV, "").strip()
    if not raw_joint_names:
        return default_joint_names
    joint_names = tuple(
        joint_name.strip()
        for joint_name in raw_joint_names.split(ROBOT_GATEWAY_JOINT_NAMES_SEPARATOR)
        if joint_name.strip()
    )
    return joint_names or default_joint_names


def _read_joint_names_from_env_for_key(env_key: str) -> tuple[str, ...]:
    raw_joint_names = os.getenv(env_key, "").strip()
    if not raw_joint_names:
        return ()
    return tuple(
        joint_name.strip()
        for joint_name in raw_joint_names.split(ROBOT_GATEWAY_JOINT_NAMES_SEPARATOR)
        if joint_name.strip()
    )


def _read_allow_unvalidated_self_collision_from_env() -> bool:
    return (
        os.getenv(ROBOT_GATEWAY_OPENARM_ALLOW_UNVALIDATED_SELF_COLLISION_ENV, "")
        .strip()
        .lower()
        in ROBOT_GATEWAY_OPENARM_CAN_TRUE_VALUES
    )


def _read_lerobot_robot_type_from_env() -> str:
    return os.getenv(ROBOT_GATEWAY_LEROBOT_ROBOT_TYPE_ENV, "").strip()


def _is_lerobot_adapter(adapter_kind: RobotGatewayAdapterKind) -> bool:
    return adapter_kind == ROBOT_GATEWAY_LEROBOT_ADAPTER_ID


def _default_lerobot_robot_id(robot_type: str) -> str:
    normalized_type = robot_type.strip().lower().replace("_follower", "")
    return normalized_type or "lerobot"


def _resolve_model_robot_id(config: RobotGatewayAdapterConfig) -> str:
    if config.model_robot_id:
        return config.model_robot_id
    if _is_lerobot_adapter(config.adapter_kind):
        if config.lerobot_robot_type.strip():
            return _default_lerobot_robot_id(config.lerobot_robot_type)
        return config.robot_id
    return RobotGatewayAdapterConfig().robot_id


def build_robot_gateway_runtime_from_env() -> RobotGatewayRuntime:
    default_adapter_config = RobotGatewayAdapterConfig()
    adapter_kind = _read_adapter_kind_from_env()
    lerobot_robot_type = _read_lerobot_robot_type_from_env()
    default_robot_id = (
        _default_lerobot_robot_id(lerobot_robot_type)
        if _is_lerobot_adapter(adapter_kind)
        else default_adapter_config.robot_id
    )
    default_joint_names = (
        ()
        if _is_lerobot_adapter(adapter_kind)
        else default_adapter_config.joint_names
    )
    lerobot_calibration_dir = os.getenv(
        ROBOT_GATEWAY_LEROBOT_CALIBRATION_DIR_ENV,
        "",
    ).strip()
    lerobot_config_json = os.getenv(ROBOT_GATEWAY_LEROBOT_CONFIG_JSON_ENV, "").strip()
    adapter_config = RobotGatewayAdapterConfig(
        adapter_kind=adapter_kind,
        robot_id=os.getenv(
            ROBOT_GATEWAY_ROBOT_ID_ENV, default_robot_id
        ).strip()
        or default_robot_id,
        model_robot_id=os.getenv(ROBOT_GATEWAY_MODEL_ROBOT_ID_ENV, "").strip() or None,
        model_robot_aliases=_read_joint_names_from_env_for_key(
            ROBOT_GATEWAY_MODEL_ROBOT_ALIASES_ENV
        ),
        joint_names=_read_joint_names_from_env(default_joint_names),
        allow_unvalidated_self_collision=(
            _read_allow_unvalidated_self_collision_from_env()
        ),
        lerobot_port=os.getenv(ROBOT_GATEWAY_LEROBOT_PORT_ENV, "").strip() or None,
        lerobot_calibration_dir=(
            Path(lerobot_calibration_dir).expanduser()
            if lerobot_calibration_dir
            else None
        ),
        lerobot_id=os.getenv(ROBOT_GATEWAY_LEROBOT_ID_ENV, "").strip() or None,
        lerobot_robot_type=lerobot_robot_type,
        lerobot_config_json=lerobot_config_json or None,
        lerobot_hardware_joint_names=_read_joint_names_from_env_for_key(
            ROBOT_GATEWAY_LEROBOT_HARDWARE_JOINT_NAMES_ENV
        ),
    )
    return RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(
            runtime_mode=_read_runtime_mode_from_env(),
            adapter_config=adapter_config,
        )
    )
