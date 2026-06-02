from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
import importlib
import json
import math
from pathlib import Path
from time import monotonic, sleep, time
from typing import Any, Callable, Mapping, Protocol

from backend.models.robot_gateway import (
    RobotGatewayAdapterKind,
    RobotGatewayCameraIntrinsics,
    RobotGatewayCameraPose,
    RobotGatewayCameraStream,
    RobotGatewayOpenArmCanDryRunPlan,
    RobotGatewayOpenArmCalibrationJogRequest,
    RobotGatewayControlAck,
    RobotGatewayHardwareMotionSafetyStatus,
    RobotGatewayJointJogRequest,
    RobotGatewayJointLimit,
    RobotGatewayJointTelemetry,
    RobotGatewayPointCloudFrame,
    RobotGatewayProfile,
    RobotGatewayProfileCapabilities,
    RobotGatewayProfileLimits,
    RobotGatewayProfileTopics,
    RobotGatewayStateFrame,
    RobotGatewayTeleoperationMode,
    build_default_robot_gateway_control_inputs,
)
from backend.robot_gateway.openarm_can import build_openarm_joint_jog_can_dry_run_frame
from backend.robot_gateway.openarm_can_transport import (
    OpenArmCanBridge,
    OpenArmCanTransportError,
)
from backend.robot_gateway.openarm_joint_calibration import (
    RejectingOpenArmJointRotationCalibration,
    build_openarm_joint_rotation_calibration_from_env,
)
from backend.robot_gateway.openarm_self_collision import (
    build_default_openarm_self_collision_preflight,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES,
    ROBOT_GATEWAY_DEFAULT_MAX_JOINT_JOG_DELTA_RAD,
    ROBOT_GATEWAY_DEFAULT_MAX_JOINT_VELOCITY_RAD_PER_SEC,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_BASE_DEPTH_M,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_COLOR_MAX,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_DENOMINATOR_MIN,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_DEPTH_WAVE_M,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_FX,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_FY,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_FULL_WAVE_MULTIPLIER,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_HEIGHT,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_PHASE_STEP_RAD,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_PPX,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_PPY,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_WIDTH,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_X_OFFSET_M,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_Y_OFFSET_M,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_Z_OFFSET_M,
    ROBOT_GATEWAY_FAKE_ADAPTER_ID,
    ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
    ROBOT_GATEWAY_LEROBOT_CALIBRATION_REQUIRED_REASON,
    ROBOT_GATEWAY_LEROBOT_FOLLOWER_PROFILE_SUFFIX,
    ROBOT_GATEWAY_LEROBOT_GRIPPER_JOINT_NAMES,
    ROBOT_GATEWAY_LEROBOT_GRIPPER_UNITS_PER_RAD,
    ROBOT_GATEWAY_LEROBOT_LEADER_PROFILE_SUFFIX,
    ROBOT_GATEWAY_LEROBOT_SO_STYLE_PROFILE_PREFIX,
    ROBOT_GATEWAY_LEROBOT_SO_STYLE_REVERSED_MODEL_JOINT_NAMES,
    ROBOT_GATEWAY_JOINT_JOG_CURRENT_POSITION_REQUIRED_REASON,
    ROBOT_GATEWAY_JOINT_JOG_DELTA_LIMIT_REASON,
    ROBOT_GATEWAY_JOINT_JOG_GRIPPER_COLLISION_MAPPING_REQUIRED_REASON,
    ROBOT_GATEWAY_JOINT_JOG_POSITION_LIMIT_REASON,
    ROBOT_GATEWAY_JOINT_JOG_SELF_COLLISION_REQUIRED_REASON,
    ROBOT_GATEWAY_JOINT_JOG_VELOCITY_LIMIT_REASON,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_DELTA_LIMIT_REASON,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_MAX_DELTA_RAD,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_MAX_UNCOMMANDED_DELTA_RAD,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_MAX_VELOCITY_RAD_PER_SEC,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_MIN_OBSERVED_DELTA_RAD,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_MIN_DELTA_RAD,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_NO_MOTION_REASON,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_OBSERVE_POLL_SEC,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_OBSERVE_TIMEOUT_SEC,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_POSITION_LIMIT_REASON,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_REASON,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_UNCOMMANDED_MOTION_REASON,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_UNSUPPORTED_REASON,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_VELOCITY_LIMIT_REASON,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_POSITION_LIMIT_RAD,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_UNAVAILABLE_REASON_PREFIX,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_SWEEP_MAX_STEP_RAD,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_SWEEP_STEP_EPSILON,
    ROBOT_GATEWAY_OPENARM_CAN_LEFT_JOINT_PREFIX,
    ROBOT_GATEWAY_OPENARM_CAN_RIGHT_JOINT_PREFIX,
    ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_FRAME_ID,
    ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID,
    ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_LABEL,
    ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_POINT_SCALE,
    ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_POSITION_XYZ_M,
    ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ROTATION_RPY_DEG,
    ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_WORLD_FRAME,
    ROBOT_GATEWAY_OPENARM_NATIVE_ADAPTER_ID,
    ROBOT_GATEWAY_OPENARM_PROFILE_ID,
    ROBOT_GATEWAY_OPENARM_LEFT_JOINT_LIMITS_RAD,
    ROBOT_GATEWAY_OPENARM_ROBOT_ID,
    ROBOT_GATEWAY_OPENARM_ROS2_ADAPTER_ID,
    ROBOT_GATEWAY_OPENARM_RIGHT_JOINT_LIMITS_RAD,
    ROBOT_GATEWAY_OPENARM_GRIPPER_JOINT_SUFFIXES,
    ROBOT_GATEWAY_SECONDS_TO_MS,
    ROBOT_GATEWAY_TELEOPERATION_MODE_REAL_HARDWARE,
    ROBOT_GATEWAY_TELEOPERATION_MODE_SIMULATED,
)

RobotGatewayJointJogSafetyPreflight = Callable[
    [Mapping[str, float], RobotGatewayJointJogRequest], str | None
]
RobotGatewayJointPositionReader = Callable[[tuple[str, ...]], Mapping[str, float]]
RobotGatewayJointTelemetryReader = Callable[[tuple[str, ...]], Mapping[str, object]]

LEROBOT_MODEL_JOINT_DIRECTION_FORWARD = 1
LEROBOT_MODEL_JOINT_DIRECTION_REVERSED = -1


class RobotGatewayJointRotationCalibration(Protocol):
    ready: bool
    calibration_id: str | None
    reason: str

    def model_from_hardware_positions(
        self,
        hardware_positions_rad: Mapping[str, float],
    ) -> dict[str, float]:
        raise NotImplementedError

    def model_delta_from_hardware(
        self,
        joint_name: str,
        hardware_delta_rad: float,
    ) -> float:
        raise NotImplementedError

    def hardware_from_model(self, joint_name: str, model_position_rad: float) -> float:
        raise NotImplementedError

    def validate_model_target(
        self,
        joint_name: str,
        model_position_rad: float,
    ) -> str | None:
        raise NotImplementedError


@dataclass(frozen=True)
class RobotGatewayAdapterConfig:
    adapter_kind: RobotGatewayAdapterKind = "fake_openarm"
    robot_id: str = ROBOT_GATEWAY_OPENARM_ROBOT_ID
    model_robot_id: str | None = None
    model_robot_aliases: tuple[str, ...] = ()
    joint_names: tuple[str, ...] = ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES
    initial_joint_positions_rad: Mapping[str, float] | None = None
    allow_unvalidated_self_collision: bool = False
    enforce_motion_limits: bool = True
    lerobot_port: str | None = None
    lerobot_calibration_dir: Path | None = None
    lerobot_id: str | None = None
    lerobot_robot_type: str = ""
    lerobot_config_json: str | None = None
    lerobot_hardware_joint_names: tuple[str, ...] = ()


RobotGatewayLeRobotFactory = Callable[[RobotGatewayAdapterConfig], object]


@dataclass(frozen=True)
class _LeRobotCalibrationStatus:
    ready: bool
    calibration_id: str | None
    reason: str | None = None


@dataclass(frozen=True)
class RobotGatewayCalibrationReloadResult:
    matched: bool
    applied: bool
    message: str


class RobotGatewayAdapter(ABC):
    config: RobotGatewayAdapterConfig

    @property
    @abstractmethod
    def adapter_id(self) -> str:
        raise NotImplementedError

    @property
    @abstractmethod
    def teleoperation_mode(self) -> RobotGatewayTeleoperationMode:
        raise NotImplementedError

    @abstractmethod
    def build_profile(self, *, control_enabled: bool) -> RobotGatewayProfile:
        raise NotImplementedError

    @abstractmethod
    def read_state(self) -> RobotGatewayStateFrame:
        raise NotImplementedError

    @abstractmethod
    def build_camera_streams(self) -> list[RobotGatewayCameraStream]:
        raise NotImplementedError

    @abstractmethod
    def read_point_cloud(self, camera_id: str) -> RobotGatewayPointCloudFrame:
        raise NotImplementedError

    @abstractmethod
    def apply_joint_jog(self, req: RobotGatewayJointJogRequest) -> RobotGatewayControlAck:
        raise NotImplementedError

    def apply_openarm_calibration_jog(
        self,
        req: RobotGatewayOpenArmCalibrationJogRequest,
    ) -> RobotGatewayControlAck:
        return RobotGatewayControlAck(
            accepted=False,
            reason=ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_UNSUPPORTED_REASON,
            sequence=req.sequence,
            applied_joint_name=req.joint_name,
        )

    @abstractmethod
    def prepare_joint_jog_can_dry_run(
        self,
        req: RobotGatewayJointJogRequest,
    ) -> RobotGatewayOpenArmCanDryRunPlan:
        raise NotImplementedError

    @abstractmethod
    def stop(self, *, sequence: int = 0) -> RobotGatewayControlAck:
        raise NotImplementedError

    @abstractmethod
    def estop(self, *, sequence: int = 0) -> RobotGatewayControlAck:
        raise NotImplementedError

    def disconnect(self) -> int:
        return 0

    def reload_lerobot_calibration_file(
        self,
        calibration_path: Path,
    ) -> RobotGatewayCalibrationReloadResult:
        return RobotGatewayCalibrationReloadResult(
            matched=False,
            applied=False,
            message="Active gateway is not using this LeRobot calibration file.",
        )


class FakeOpenArmAdapter(RobotGatewayAdapter):
    def __init__(self, config: RobotGatewayAdapterConfig | None = None) -> None:
        self.config = config or RobotGatewayAdapterConfig(adapter_kind="fake_openarm")
        self._sequence = 0
        initial_positions = self.config.initial_joint_positions_rad or {}
        self._joint_positions = {
            joint_name: float(initial_positions.get(joint_name, 0.0))
            for joint_name in self.config.joint_names
        }
        self._last_joint_jog_applied_monotonic_ms: dict[str, float] = {}
        self._last_motion_reject_reason: str | None = None
        self._estop = False

    @property
    def adapter_id(self) -> str:
        return ROBOT_GATEWAY_FAKE_ADAPTER_ID

    @property
    def teleoperation_mode(self) -> RobotGatewayTeleoperationMode:
        return ROBOT_GATEWAY_TELEOPERATION_MODE_SIMULATED

    def build_profile(self, *, control_enabled: bool) -> RobotGatewayProfile:
        return _build_openarm_profile(
            adapter_id=self.adapter_id,
            teleoperation_mode=self.teleoperation_mode,
            robot_id=self.config.robot_id,
            joint_names=self.config.joint_names,
            control_enabled=control_enabled,
            summary=(
                "OpenArm fake adapter for URDF Studio gateway validation. "
                "Use observe mode by default; control mode never touches real hardware."
            ),
        )

    def read_state(self) -> RobotGatewayStateFrame:
        self._sequence += 1
        return RobotGatewayStateFrame(
            robot_id=self.config.robot_id,
            adapter_id=self.adapter_id,
            profile_id=ROBOT_GATEWAY_OPENARM_PROFILE_ID,
            sequence=self._sequence,
            source_ts_ms=int(time() * 1000),
            mode="safe_hold" if self._estop else "manual",
            estop=self._estop,
            heartbeat_ok=True,
            joint_positions_rad=dict(self._joint_positions),
            joint_telemetry={
                joint_name: RobotGatewayJointTelemetry(position_rad=position_rad)
                for joint_name, position_rad in self._joint_positions.items()
            },
            hardware_motion_safety=RobotGatewayHardwareMotionSafetyStatus(
                motion_ready=not self._estop,
                authoritative_joint_feedback_ready=True,
                joint_rotation_calibration_ready=True,
                joint_rotation_calibration_required=False,
                joint_rotation_calibration_id="simulated",
                self_collision_preflight_ready=True,
                gripper_motion_enabled=True,
                last_reject_reason=self._last_motion_reject_reason,
            ),
        )

    def build_camera_streams(self) -> list[RobotGatewayCameraStream]:
        return [_build_openarm_depth_camera_stream()]

    def read_point_cloud(self, camera_id: str) -> RobotGatewayPointCloudFrame:
        if camera_id != ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID:
            return RobotGatewayPointCloudFrame(
                camera_id=camera_id,
                intrinsics=_build_openarm_depth_camera_intrinsics(),
                points_xyz=[],
                colors_rgb=[],
            )
        self._sequence += 1
        return _build_fake_openarm_point_cloud_frame(sequence=self._sequence)

    def apply_joint_jog(self, req: RobotGatewayJointJogRequest) -> RobotGatewayControlAck:
        if req.joint_name not in self._joint_positions:
            self._last_motion_reject_reason = f"Unknown controlled joint: {req.joint_name}"
            return RobotGatewayControlAck(
                accepted=False,
                reason=self._last_motion_reject_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        if self._estop:
            self._last_motion_reject_reason = "Robot is e-stopped."
            return RobotGatewayControlAck(
                accepted=False,
                reason=self._last_motion_reject_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        now_ms = _now_monotonic_ms()
        if self.config.enforce_motion_limits:
            delta_limit_reason = _validate_joint_jog_delta(req.delta_rad)
            if delta_limit_reason is not None:
                self._last_motion_reject_reason = delta_limit_reason
                return RobotGatewayControlAck(
                    accepted=False,
                    reason=delta_limit_reason,
                    sequence=req.sequence,
                    applied_joint_name=req.joint_name,
                )
            velocity_limit_reason = _validate_joint_jog_velocity(
                delta_rad=req.delta_rad,
                last_applied_monotonic_ms=self._last_joint_jog_applied_monotonic_ms.get(
                    req.joint_name
                ),
                now_monotonic_ms=now_ms,
            )
            if velocity_limit_reason is not None:
                self._last_motion_reject_reason = velocity_limit_reason
                return RobotGatewayControlAck(
                    accepted=False,
                    reason=velocity_limit_reason,
                    sequence=req.sequence,
                    applied_joint_name=req.joint_name,
                )
        self._joint_positions[req.joint_name] += req.delta_rad
        self._last_joint_jog_applied_monotonic_ms[req.joint_name] = now_ms
        self._last_motion_reject_reason = None
        return RobotGatewayControlAck(
            accepted=True,
            reason="joint jog accepted",
            sequence=req.sequence,
            applied_joint_name=req.joint_name,
            applied_delta_rad=req.delta_rad,
        )

    def prepare_joint_jog_can_dry_run(
        self,
        req: RobotGatewayJointJogRequest,
    ) -> RobotGatewayOpenArmCanDryRunPlan:
        current_position_rad = (
            req.current_position_rad
            if req.current_position_rad is not None
            else self._joint_positions.get(req.joint_name)
        )
        if current_position_rad is None:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason=f"Unknown controlled joint: {req.joint_name}",
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        if self._estop:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason="Robot is e-stopped.",
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        if self.config.enforce_motion_limits:
            delta_limit_reason = _validate_joint_jog_delta(req.delta_rad)
            if delta_limit_reason is not None:
                return RobotGatewayOpenArmCanDryRunPlan(
                    accepted=False,
                    reason=delta_limit_reason,
                    sequence=req.sequence,
                    applied_joint_name=req.joint_name,
                )
            velocity_limit_reason = _validate_joint_jog_velocity(
                delta_rad=req.delta_rad,
                last_applied_monotonic_ms=self._last_joint_jog_applied_monotonic_ms.get(
                    req.joint_name
                ),
                now_monotonic_ms=_now_monotonic_ms(),
            )
            if velocity_limit_reason is not None:
                return RobotGatewayOpenArmCanDryRunPlan(
                    accepted=False,
                    reason=velocity_limit_reason,
                    sequence=req.sequence,
                    applied_joint_name=req.joint_name,
                )
        frame = build_openarm_joint_jog_can_dry_run_frame(
            joint_name=req.joint_name,
            current_position_rad=current_position_rad,
            delta_rad=req.delta_rad,
        )
        if frame is None:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason=f"Joint is not mapped to an OpenArm CAN motor: {req.joint_name}",
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        return RobotGatewayOpenArmCanDryRunPlan(
            accepted=True,
            reason="OpenArm CAN joint jog prepared; dry-run only, not sent.",
            sequence=req.sequence,
            applied_joint_name=req.joint_name,
            applied_delta_rad=req.delta_rad,
            frame=frame,
        )

    def stop(self, *, sequence: int = 0) -> RobotGatewayControlAck:
        return RobotGatewayControlAck(accepted=True, reason="safe hold requested", sequence=sequence)

    def estop(self, *, sequence: int = 0) -> RobotGatewayControlAck:
        self._estop = True
        return RobotGatewayControlAck(accepted=True, reason="e-stop latched", sequence=sequence)


class Ros2OpenArmAdapter(FakeOpenArmAdapter):
    def __init__(self, config: RobotGatewayAdapterConfig | None = None) -> None:
        super().__init__(
            config or RobotGatewayAdapterConfig(adapter_kind="openarm_ros2")
        )

    @property
    def adapter_id(self) -> str:
        return ROBOT_GATEWAY_OPENARM_ROS2_ADAPTER_ID

    @property
    def teleoperation_mode(self) -> RobotGatewayTeleoperationMode:
        return ROBOT_GATEWAY_TELEOPERATION_MODE_REAL_HARDWARE

    def build_profile(self, *, control_enabled: bool) -> RobotGatewayProfile:
        return _build_openarm_profile(
            adapter_id=self.adapter_id,
            teleoperation_mode=self.teleoperation_mode,
            robot_id=self.config.robot_id,
            joint_names=self.config.joint_names,
            control_enabled=control_enabled,
            summary="OpenArm ROS2 adapter profile for ros2_control-backed joint state and joint jog.",
        )

    def apply_joint_jog(
        self, req: RobotGatewayJointJogRequest
    ) -> RobotGatewayControlAck:
        return RobotGatewayControlAck(
            accepted=False,
            reason=(
                "OpenArm ROS2 joint-jog transport is not implemented in this gateway."
            ),
            sequence=req.sequence,
            applied_joint_name=req.joint_name,
        )


class NativeOpenArmAdapter(FakeOpenArmAdapter):
    def __init__(
        self,
        config: RobotGatewayAdapterConfig | None = None,
        *,
        can_bridge: OpenArmCanBridge | None = None,
        safety_preflight: RobotGatewayJointJogSafetyPreflight | None = None,
        joint_position_reader: RobotGatewayJointPositionReader | None = None,
        joint_telemetry_reader: RobotGatewayJointTelemetryReader | None = None,
        joint_rotation_calibration: RobotGatewayJointRotationCalibration | None = None,
    ) -> None:
        super().__init__(
            config or RobotGatewayAdapterConfig(adapter_kind="openarm_native")
        )
        self._can_bridge = can_bridge or OpenArmCanBridge()
        self._safety_preflight = safety_preflight
        self._joint_position_reader = joint_position_reader
        self._joint_telemetry_reader = joint_telemetry_reader
        self._joint_rotation_calibration = (
            joint_rotation_calibration or RejectingOpenArmJointRotationCalibration()
        )

    @property
    def adapter_id(self) -> str:
        return ROBOT_GATEWAY_OPENARM_NATIVE_ADAPTER_ID

    @property
    def teleoperation_mode(self) -> RobotGatewayTeleoperationMode:
        return ROBOT_GATEWAY_TELEOPERATION_MODE_REAL_HARDWARE

    def build_profile(self, *, control_enabled: bool) -> RobotGatewayProfile:
        return _build_openarm_profile(
            adapter_id=self.adapter_id,
            teleoperation_mode=self.teleoperation_mode,
            robot_id=self.config.robot_id,
            joint_names=self.config.joint_names,
            control_enabled=control_enabled,
            summary="OpenArm native adapter profile for official OpenArm/LeRobot control integration.",
        )

    def read_state(self) -> RobotGatewayStateFrame:
        self._sequence += 1
        heartbeat_ok = True
        mode = "safe_hold" if self._estop else "manual"
        joint_telemetry: dict[str, RobotGatewayJointTelemetry] = {}
        try:
            hardware_telemetry = self._read_authoritative_joint_telemetry()
            hardware_positions = {
                joint_name: telemetry.position_rad
                for joint_name, telemetry in hardware_telemetry.items()
            }
            if self._joint_rotation_calibration_ready():
                model_positions = (
                    self._joint_rotation_calibration.model_from_hardware_positions(
                        hardware_positions
                    )
                )
                self._joint_positions.update(model_positions)
                joint_telemetry = self._model_joint_telemetry_from_hardware(
                    hardware_telemetry,
                    model_positions,
                )
            else:
                joint_telemetry = dict(hardware_telemetry)
        except OpenArmCanTransportError:
            heartbeat_ok = False
            mode = "safe_hold"
        except ValueError as exc:
            self._last_motion_reject_reason = str(exc)
            mode = "safe_hold"
        return RobotGatewayStateFrame(
            robot_id=self.config.robot_id,
            adapter_id=self.adapter_id,
            profile_id=ROBOT_GATEWAY_OPENARM_PROFILE_ID,
            sequence=self._sequence,
            source_ts_ms=int(time() * 1000),
            mode=mode,
            estop=self._estop,
            heartbeat_ok=heartbeat_ok,
            joint_positions_rad=dict(self._joint_positions),
            joint_telemetry=joint_telemetry,
            hardware_motion_safety=self._build_hardware_motion_safety_status(
                authoritative_joint_feedback_ready=heartbeat_ok,
            ),
        )

    def apply_joint_jog(
        self, req: RobotGatewayJointJogRequest
    ) -> RobotGatewayControlAck:
        plan = self.prepare_joint_jog_can_dry_run(req)
        if not plan.accepted:
            self._last_motion_reject_reason = plan.reason
            return RobotGatewayControlAck(
                accepted=False,
                reason=plan.reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        if plan.frame is None:
            self._last_motion_reject_reason = (
                "OpenArm CAN joint jog produced no transmit frame."
            )
            return RobotGatewayControlAck(
                accepted=False,
                reason=self._last_motion_reject_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        try:
            self._enable_joint_motor_if_supported(plan.frame.joint_name)
            self._can_bridge.send_frame(plan.frame)
        except OpenArmCanTransportError as exc:
            self._last_motion_reject_reason = str(exc)
            return RobotGatewayControlAck(
                accepted=False,
                reason=self._last_motion_reject_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )

        previous_position_rad = self._joint_positions.get(req.joint_name, 0.0)
        applied_delta_rad = plan.applied_delta_rad or 0.0
        self._joint_positions[req.joint_name] = (
            previous_position_rad + applied_delta_rad
        )
        self._last_joint_jog_applied_monotonic_ms[
            req.joint_name
        ] = _now_monotonic_ms()
        self._last_motion_reject_reason = None
        return RobotGatewayControlAck(
            accepted=True,
            reason="OpenArm CAN joint jog sent.",
            sequence=req.sequence,
            applied_joint_name=req.joint_name,
            applied_delta_rad=applied_delta_rad,
        )

    def apply_openarm_calibration_jog(
        self,
        req: RobotGatewayOpenArmCalibrationJogRequest,
    ) -> RobotGatewayControlAck:
        if req.joint_name not in self._joint_positions:
            self._last_motion_reject_reason = f"Unknown controlled joint: {req.joint_name}"
            return RobotGatewayControlAck(
                accepted=False,
                reason=self._last_motion_reject_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        if _is_openarm_gripper_joint(req.joint_name):
            self._last_motion_reject_reason = (
                ROBOT_GATEWAY_JOINT_JOG_GRIPPER_COLLISION_MAPPING_REQUIRED_REASON
            )
            return RobotGatewayControlAck(
                accepted=False,
                reason=self._last_motion_reject_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        delta_limit_reason = _validate_openarm_calibration_jog_delta(req.delta_rad)
        if delta_limit_reason is not None:
            self._last_motion_reject_reason = delta_limit_reason
            return RobotGatewayControlAck(
                accepted=False,
                reason=delta_limit_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        now_ms = _now_monotonic_ms()
        velocity_limit_reason = _validate_openarm_calibration_jog_velocity(
            delta_rad=req.delta_rad,
            last_applied_monotonic_ms=self._last_joint_jog_applied_monotonic_ms.get(
                req.joint_name
            ),
            now_monotonic_ms=now_ms,
        )
        if velocity_limit_reason is not None:
            self._last_motion_reject_reason = velocity_limit_reason
            return RobotGatewayControlAck(
                accepted=False,
                reason=velocity_limit_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        try:
            hardware_current_positions = self._read_authoritative_joint_positions()
        except OpenArmCanTransportError as exc:
            self._last_motion_reject_reason = str(exc)
            return RobotGatewayControlAck(
                accepted=False,
                reason=self._last_motion_reject_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        hardware_current_position_rad = hardware_current_positions[req.joint_name]
        hardware_target_position_rad = hardware_current_position_rad + req.delta_rad
        if (
            hardware_target_position_rad
            < -ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_POSITION_LIMIT_RAD
            or hardware_target_position_rad
            > ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_POSITION_LIMIT_RAD
        ):
            self._last_motion_reject_reason = (
                ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_POSITION_LIMIT_REASON
            )
            return RobotGatewayControlAck(
                accepted=False,
                reason=self._last_motion_reject_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        frame = build_openarm_joint_jog_can_dry_run_frame(
            joint_name=req.joint_name,
            current_position_rad=hardware_current_position_rad,
            delta_rad=req.delta_rad,
        )
        if frame is None:
            self._last_motion_reject_reason = (
                f"Joint is not mapped to an OpenArm CAN motor: {req.joint_name}"
            )
            return RobotGatewayControlAck(
                accepted=False,
                reason=self._last_motion_reject_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        try:
            self._enable_joint_motor_if_supported(req.joint_name)
            self._can_bridge.send_frame(frame)
        except OpenArmCanTransportError as exc:
            self._last_motion_reject_reason = str(exc)
            return RobotGatewayControlAck(
                accepted=False,
                reason=self._last_motion_reject_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        return self._observe_openarm_calibration_jog_result(
            req=req,
            before_positions=hardware_current_positions,
        )

    def _enable_joint_motor_if_supported(self, joint_name: str) -> None:
        enable_joint = getattr(self._can_bridge, "enable_joint", None)
        if not callable(enable_joint):
            return
        enable_joint(joint_name)

    def _observe_openarm_calibration_jog_result(
        self,
        *,
        req: RobotGatewayOpenArmCalibrationJogRequest,
        before_positions: Mapping[str, float],
    ) -> RobotGatewayControlAck:
        deadline_monotonic_sec = (
            monotonic() + ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_OBSERVE_TIMEOUT_SEC
        )
        observed_delta_rad = 0.0
        while True:
            sleep(ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_OBSERVE_POLL_SEC)
            try:
                observed_positions = self._read_authoritative_joint_positions()
            except OpenArmCanTransportError as exc:
                self._last_motion_reject_reason = str(exc)
                return RobotGatewayControlAck(
                    accepted=False,
                    reason=self._last_motion_reject_reason,
                    sequence=req.sequence,
                    applied_joint_name=req.joint_name,
                )
            observed_delta_rad = (
                observed_positions[req.joint_name] - before_positions[req.joint_name]
            )
            uncommanded_joint_name = _find_openarm_uncommanded_calibration_motion(
                commanded_joint_name=req.joint_name,
                before_positions=before_positions,
                after_positions=observed_positions,
            )
            if uncommanded_joint_name is not None:
                self._last_motion_reject_reason = (
                    f"{ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_UNCOMMANDED_MOTION_REASON} "
                    f"{uncommanded_joint_name}"
                )
                return RobotGatewayControlAck(
                    accepted=False,
                    reason=self._last_motion_reject_reason,
                    sequence=req.sequence,
                    applied_joint_name=req.joint_name,
                    applied_delta_rad=observed_delta_rad,
                )
            if (
                abs(observed_delta_rad)
                >= ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_MIN_OBSERVED_DELTA_RAD
            ):
                self._last_joint_jog_applied_monotonic_ms[
                    req.joint_name
                ] = _now_monotonic_ms()
                self._last_motion_reject_reason = None
                return RobotGatewayControlAck(
                    accepted=True,
                    reason=ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_REASON,
                    sequence=req.sequence,
                    applied_joint_name=req.joint_name,
                    applied_delta_rad=observed_delta_rad,
                )
            if monotonic() >= deadline_monotonic_sec:
                self._last_motion_reject_reason = (
                    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_NO_MOTION_REASON
                )
                return RobotGatewayControlAck(
                    accepted=False,
                    reason=self._last_motion_reject_reason,
                    sequence=req.sequence,
                    applied_joint_name=req.joint_name,
                    applied_delta_rad=observed_delta_rad,
                )

    def prepare_joint_jog_can_dry_run(
        self,
        req: RobotGatewayJointJogRequest,
    ) -> RobotGatewayOpenArmCanDryRunPlan:
        if req.joint_name not in self._joint_positions:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason=f"Unknown controlled joint: {req.joint_name}",
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        if _is_openarm_gripper_joint(req.joint_name):
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason=ROBOT_GATEWAY_JOINT_JOG_GRIPPER_COLLISION_MAPPING_REQUIRED_REASON,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        delta_limit_reason = _validate_joint_jog_delta(req.delta_rad)
        if delta_limit_reason is not None:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason=delta_limit_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        velocity_limit_reason = _validate_joint_jog_velocity(
            delta_rad=req.delta_rad,
            last_applied_monotonic_ms=self._last_joint_jog_applied_monotonic_ms.get(
                req.joint_name
            ),
            now_monotonic_ms=_now_monotonic_ms(),
        )
        if velocity_limit_reason is not None:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason=velocity_limit_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        calibration_ready_reason = self._validate_joint_rotation_calibration_ready()
        if calibration_ready_reason is not None:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason=calibration_ready_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        try:
            hardware_current_positions = self._read_authoritative_joint_positions()
        except OpenArmCanTransportError as exc:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason=str(exc),
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        try:
            current_positions = (
                self._joint_rotation_calibration.model_from_hardware_positions(
                    hardware_current_positions
                )
            )
        except ValueError as exc:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason=str(exc),
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        self._joint_positions.update(current_positions)
        current_position_rad = current_positions[req.joint_name]
        target_position_rad = current_position_rad + req.delta_rad
        calibration_limit_reason = (
            self._joint_rotation_calibration.validate_model_target(
                req.joint_name,
                target_position_rad,
            )
        )
        if calibration_limit_reason is not None:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason=calibration_limit_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        position_limit_reason = _validate_openarm_physical_joint_limit(
            req.joint_name,
            target_position_rad,
        )
        if position_limit_reason is not None:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason=position_limit_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        target_positions = dict(current_positions)
        target_positions[req.joint_name] = target_position_rad
        safety_reason = self._validate_self_collision_swept_path(
            current_positions,
            target_positions,
            req,
        )
        if safety_reason is not None:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason=safety_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        try:
            hardware_target_position_rad = (
                self._joint_rotation_calibration.hardware_from_model(
                    req.joint_name,
                    target_position_rad,
                )
            )
        except ValueError as exc:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason=str(exc),
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        hardware_current_position_rad = hardware_current_positions[req.joint_name]
        frame = build_openarm_joint_jog_can_dry_run_frame(
            joint_name=req.joint_name,
            current_position_rad=hardware_current_position_rad,
            delta_rad=hardware_target_position_rad - hardware_current_position_rad,
        )
        if frame is None:
            return RobotGatewayOpenArmCanDryRunPlan(
                accepted=False,
                reason=f"Joint is not mapped to an OpenArm CAN motor: {req.joint_name}",
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        return RobotGatewayOpenArmCanDryRunPlan(
            accepted=True,
            reason="OpenArm CAN joint jog prepared; dry-run only, not sent.",
            sequence=req.sequence,
            applied_joint_name=req.joint_name,
            applied_delta_rad=req.delta_rad,
            frame=frame,
        )

    def _read_authoritative_joint_telemetry(
        self,
    ) -> dict[str, RobotGatewayJointTelemetry]:
        telemetry_reader = self._joint_telemetry_reader
        if telemetry_reader is None and self._joint_position_reader is None:
            bridge_reader = getattr(self._can_bridge, "read_joint_states", None)
            if callable(bridge_reader):
                telemetry_reader = bridge_reader
        if telemetry_reader is not None:
            try:
                raw_telemetry = dict(telemetry_reader(self.config.joint_names))
            except OpenArmCanTransportError:
                raise
            except Exception as exc:  # pragma: no cover - hardware driver boundary
                raise OpenArmCanTransportError(
                    f"OpenArm follower joint telemetry read failed: {exc}"
                ) from exc
            return self._validate_authoritative_joint_telemetry(raw_telemetry)

        reader = self._joint_position_reader
        if reader is None:
            bridge_reader = getattr(self._can_bridge, "read_joint_positions_rad", None)
            if callable(bridge_reader):
                reader = bridge_reader
        if reader is None:
            raise OpenArmCanTransportError(
                ROBOT_GATEWAY_JOINT_JOG_CURRENT_POSITION_REQUIRED_REASON
            )
        try:
            raw_positions = dict(reader(self.config.joint_names))
        except OpenArmCanTransportError:
            raise
        except Exception as exc:  # pragma: no cover - hardware driver boundary
            raise OpenArmCanTransportError(
                f"OpenArm follower joint feedback read failed: {exc}"
            ) from exc

        joint_telemetry: dict[str, RobotGatewayJointTelemetry] = {}
        missing_joint_names: list[str] = []
        for joint_name in self.config.joint_names:
            position_rad = raw_positions.get(joint_name)
            if position_rad is None:
                missing_joint_names.append(joint_name)
                continue
            position_float = float(position_rad)
            if not math.isfinite(position_float):
                raise OpenArmCanTransportError(
                    f"OpenArm follower joint feedback is non-finite for {joint_name}."
                )
            joint_telemetry[joint_name] = RobotGatewayJointTelemetry(
                position_rad=position_float,
            )
        if missing_joint_names:
            raise OpenArmCanTransportError(
                "OpenArm follower joint feedback missing controlled joints: "
                + ", ".join(missing_joint_names)
            )
        return joint_telemetry

    def _read_authoritative_joint_positions(self) -> dict[str, float]:
        telemetry = self._read_authoritative_joint_telemetry()
        return {
            joint_name: joint_telemetry.position_rad
            for joint_name, joint_telemetry in telemetry.items()
        }

    def _validate_authoritative_joint_telemetry(
        self,
        raw_telemetry: Mapping[str, object],
    ) -> dict[str, RobotGatewayJointTelemetry]:
        joint_telemetry: dict[str, RobotGatewayJointTelemetry] = {}
        missing_joint_names: list[str] = []
        for joint_name in self.config.joint_names:
            raw_joint_telemetry = raw_telemetry.get(joint_name)
            if raw_joint_telemetry is None:
                missing_joint_names.append(joint_name)
                continue
            joint_telemetry[joint_name] = _coerce_robot_gateway_joint_telemetry(
                joint_name,
                raw_joint_telemetry,
            )
        if missing_joint_names:
            raise OpenArmCanTransportError(
                "OpenArm follower joint telemetry missing controlled joints: "
                + ", ".join(missing_joint_names)
            )
        return joint_telemetry

    def _model_joint_telemetry_from_hardware(
        self,
        hardware_telemetry: Mapping[str, RobotGatewayJointTelemetry],
        model_positions: Mapping[str, float],
    ) -> dict[str, RobotGatewayJointTelemetry]:
        model_telemetry: dict[str, RobotGatewayJointTelemetry] = {}
        for joint_name, telemetry in hardware_telemetry.items():
            model_telemetry[joint_name] = RobotGatewayJointTelemetry(
                position_rad=model_positions[joint_name],
                velocity_rad_per_sec=_model_delta_from_hardware_if_present(
                    self._joint_rotation_calibration,
                    joint_name,
                    telemetry.velocity_rad_per_sec,
                ),
                torque_nm=_model_delta_from_hardware_if_present(
                    self._joint_rotation_calibration,
                    joint_name,
                    telemetry.torque_nm,
                ),
                temp_mos_c=telemetry.temp_mos_c,
                temp_rotor_c=telemetry.temp_rotor_c,
                fault_code=telemetry.fault_code,
            )
        return model_telemetry

    def _validate_self_collision_preflight(
        self,
        target_positions: Mapping[str, float],
        req: RobotGatewayJointJogRequest,
    ) -> str | None:
        if self._safety_preflight is not None:
            try:
                reason = self._safety_preflight(target_positions, req)
            except Exception as exc:  # pragma: no cover - safety boundary
                return (
                    f"{ROBOT_GATEWAY_OPENARM_SELF_COLLISION_UNAVAILABLE_REASON_PREFIX} "
                    f"{exc}"
                )
            return reason or None
        if self.config.allow_unvalidated_self_collision:
            return None
        return ROBOT_GATEWAY_JOINT_JOG_SELF_COLLISION_REQUIRED_REASON

    def _validate_self_collision_swept_path(
        self,
        current_positions: Mapping[str, float],
        target_positions: Mapping[str, float],
        req: RobotGatewayJointJogRequest,
    ) -> str | None:
        max_delta_rad = max(
            abs(target_positions[joint_name] - current_positions.get(joint_name, 0.0))
            for joint_name in target_positions
        )
        waypoint_count = max(
            1,
            math.ceil(
                (
                    max_delta_rad
                    / ROBOT_GATEWAY_OPENARM_SELF_COLLISION_SWEEP_MAX_STEP_RAD
                )
                - ROBOT_GATEWAY_OPENARM_SELF_COLLISION_SWEEP_STEP_EPSILON
            ),
        )
        for waypoint_index in range(1, waypoint_count + 1):
            interpolation_alpha = waypoint_index / waypoint_count
            waypoint_positions = {
                joint_name: current_positions.get(joint_name, target_position)
                + (
                    target_position
                    - current_positions.get(joint_name, target_position)
                )
                * interpolation_alpha
                for joint_name, target_position in target_positions.items()
            }
            safety_reason = self._validate_self_collision_preflight(
                waypoint_positions,
                req,
            )
            if safety_reason is not None:
                return safety_reason
        return None

    def _self_collision_preflight_ready(self) -> bool:
        if self.config.allow_unvalidated_self_collision:
            return False
        if self._safety_preflight is None:
            return False
        return bool(getattr(self._safety_preflight, "ready", True))

    def _joint_rotation_calibration_ready(self) -> bool:
        return bool(getattr(self._joint_rotation_calibration, "ready", False))

    def _validate_joint_rotation_calibration_ready(self) -> str | None:
        if self._joint_rotation_calibration_ready():
            return None
        return getattr(
            self._joint_rotation_calibration,
            "reason",
            "OpenArm joint rotation calibration is not ready.",
        )

    def _build_hardware_motion_safety_status(
        self,
        *,
        authoritative_joint_feedback_ready: bool,
    ) -> RobotGatewayHardwareMotionSafetyStatus:
        self_collision_ready = self._self_collision_preflight_ready()
        calibration_ready = self._joint_rotation_calibration_ready()
        motion_ready = (
            authoritative_joint_feedback_ready
            and calibration_ready
            and self_collision_ready
            and not self._estop
        )
        last_reject_reason = self._last_motion_reject_reason
        if last_reject_reason is None and not calibration_ready:
            last_reject_reason = self._validate_joint_rotation_calibration_ready()
        return RobotGatewayHardwareMotionSafetyStatus(
            motion_ready=motion_ready,
            authoritative_joint_feedback_ready=authoritative_joint_feedback_ready,
            joint_rotation_calibration_ready=calibration_ready,
            joint_rotation_calibration_required=not calibration_ready,
            joint_rotation_calibration_id=getattr(
                self._joint_rotation_calibration,
                "calibration_id",
                None,
            ),
            self_collision_preflight_ready=self_collision_ready,
            gripper_motion_enabled=False,
            last_reject_reason=last_reject_reason,
        )


class LeRobotAdapter(RobotGatewayAdapter):
    def __init__(
        self,
        config: RobotGatewayAdapterConfig | None = None,
        *,
        robot_factory: RobotGatewayLeRobotFactory | None = None,
    ) -> None:
        self.config = config or RobotGatewayAdapterConfig(
            adapter_kind=ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
            robot_id="lerobot",
        )
        self._robot_factory = robot_factory or _build_lerobot_robot
        self._joint_map = _build_lerobot_joint_map(self.config)
        self._robot: object | None = None
        self._sequence = 0
        self._joint_positions = self._initial_joint_positions()
        self._joint_directions = {
            joint_name: _resolve_lerobot_model_joint_direction(
                self.config,
                joint_name,
            )
            for joint_name in self._joint_positions
        }
        self._last_joint_jog_applied_monotonic_ms: dict[str, float] = {}
        self._last_motion_reject_reason: str | None = None
        self._estop = False

    @property
    def adapter_id(self) -> str:
        return ROBOT_GATEWAY_LEROBOT_ADAPTER_ID

    @property
    def teleoperation_mode(self) -> RobotGatewayTeleoperationMode:
        return ROBOT_GATEWAY_TELEOPERATION_MODE_REAL_HARDWARE

    def build_profile(self, *, control_enabled: bool) -> RobotGatewayProfile:
        return _build_lerobot_profile(
            adapter_id=self.adapter_id,
            teleoperation_mode=self.teleoperation_mode,
            robot_id=self.config.robot_id,
            joint_names=tuple(self._joint_positions),
            robot_type=self.config.lerobot_robot_type,
            hardware_device_key=_lerobot_hardware_device_key(self.config),
            control_enabled=control_enabled,
            joint_directions=self._joint_directions,
        )

    def read_state(self) -> RobotGatewayStateFrame:
        self._sequence += 1
        heartbeat_ok = True
        try:
            self._joint_positions.update(self._read_joint_positions())
            self._last_motion_reject_reason = None
        except Exception as exc:  # pragma: no cover - hardware driver boundary
            heartbeat_ok = False
            self._last_motion_reject_reason = f"LeRobot state read failed: {exc}"
        calibration_status = self._build_calibration_status()
        last_reject_reason = self._last_motion_reject_reason
        if (
            last_reject_reason is None
            and heartbeat_ok
            and not calibration_status.ready
        ):
            last_reject_reason = calibration_status.reason
        motion_ready = heartbeat_ok and not self._estop and calibration_status.ready
        return RobotGatewayStateFrame(
            robot_id=self.config.robot_id,
            adapter_id=self.adapter_id,
            profile_id=_lerobot_profile_id(self.config.lerobot_robot_type),
            sequence=self._sequence,
            source_ts_ms=int(time() * 1000),
            mode="safe_hold" if self._estop or not heartbeat_ok else "manual",
            estop=self._estop,
            heartbeat_ok=heartbeat_ok,
            joint_positions_rad=dict(self._joint_positions),
            joint_telemetry={
                joint_name: RobotGatewayJointTelemetry(position_rad=position_rad)
                for joint_name, position_rad in self._joint_positions.items()
            },
            hardware_motion_safety=RobotGatewayHardwareMotionSafetyStatus(
                motion_ready=motion_ready,
                authoritative_joint_feedback_ready=heartbeat_ok,
                joint_rotation_calibration_ready=calibration_status.ready,
                joint_rotation_calibration_required=(
                    heartbeat_ok and not calibration_status.ready
                ),
                joint_rotation_calibration_id=calibration_status.calibration_id,
                self_collision_preflight_ready=False,
                gripper_motion_enabled=True,
                last_reject_reason=last_reject_reason,
            ),
        )

    def build_camera_streams(self) -> list[RobotGatewayCameraStream]:
        return []

    def read_point_cloud(self, camera_id: str) -> RobotGatewayPointCloudFrame:
        return RobotGatewayPointCloudFrame(
            camera_id=camera_id,
            intrinsics=_build_openarm_depth_camera_intrinsics(),
            points_xyz=[],
            colors_rgb=[],
        )

    def apply_joint_jog(
        self, req: RobotGatewayJointJogRequest
    ) -> RobotGatewayControlAck:
        if req.joint_name not in self._joint_positions:
            self._last_motion_reject_reason = f"Unknown controlled joint: {req.joint_name}"
            return RobotGatewayControlAck(
                accepted=False,
                reason=self._last_motion_reject_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        if self._estop:
            self._last_motion_reject_reason = "Robot is e-stopped."
            return RobotGatewayControlAck(
                accepted=False,
                reason=self._last_motion_reject_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        delta_limit_reason = _validate_joint_jog_delta(req.delta_rad)
        if delta_limit_reason is not None:
            self._last_motion_reject_reason = delta_limit_reason
            return RobotGatewayControlAck(
                accepted=False,
                reason=delta_limit_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        now_ms = _now_monotonic_ms()
        velocity_limit_reason = _validate_joint_jog_velocity(
            delta_rad=req.delta_rad,
            last_applied_monotonic_ms=self._last_joint_jog_applied_monotonic_ms.get(
                req.joint_name
            ),
            now_monotonic_ms=now_ms,
        )
        if velocity_limit_reason is not None:
            self._last_motion_reject_reason = velocity_limit_reason
            return RobotGatewayControlAck(
                accepted=False,
                reason=velocity_limit_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        try:
            robot = self._connect()
            calibration_ready_reason = self._validate_calibration_ready(robot)
            if calibration_ready_reason is not None:
                self._last_motion_reject_reason = calibration_ready_reason
                return RobotGatewayControlAck(
                    accepted=False,
                    reason=calibration_ready_reason,
                    sequence=req.sequence,
                    applied_joint_name=req.joint_name,
                )
            current_positions = self._read_joint_positions()
            target_position_rad = current_positions[req.joint_name] + req.delta_rad
            position_limit_reason = _validate_lerobot_joint_limit(
                req.joint_name,
                target_position_rad,
                self._joint_direction(req.joint_name),
            )
            if position_limit_reason is not None:
                self._last_motion_reject_reason = position_limit_reason
                return RobotGatewayControlAck(
                    accepted=False,
                    reason=position_limit_reason,
                    sequence=req.sequence,
                    applied_joint_name=req.joint_name,
                )
            sent_action = self._send_joint_target(req.joint_name, target_position_rad)
            sent_position_rad = _read_lerobot_action_joint_position_rad(
                sent_action,
                req.joint_name,
                target_position_rad,
                self._joint_direction(req.joint_name),
            )
        except Exception as exc:  # pragma: no cover - hardware driver boundary
            self._last_motion_reject_reason = f"LeRobot joint jog failed: {exc}"
            return RobotGatewayControlAck(
                accepted=False,
                reason=self._last_motion_reject_reason,
                sequence=req.sequence,
                applied_joint_name=req.joint_name,
            )
        self._joint_positions.update(current_positions)
        self._joint_positions[req.joint_name] = sent_position_rad
        self._last_joint_jog_applied_monotonic_ms[req.joint_name] = now_ms
        self._last_motion_reject_reason = None
        return RobotGatewayControlAck(
            accepted=True,
            reason="LeRobot joint jog sent.",
            sequence=req.sequence,
            applied_joint_name=req.joint_name,
            applied_delta_rad=sent_position_rad - current_positions[req.joint_name],
        )

    def prepare_joint_jog_can_dry_run(
        self,
        req: RobotGatewayJointJogRequest,
    ) -> RobotGatewayOpenArmCanDryRunPlan:
        return RobotGatewayOpenArmCanDryRunPlan(
            accepted=False,
            reason="LeRobot adapter does not expose OpenArm CAN dry-run frames.",
            sequence=req.sequence,
            applied_joint_name=req.joint_name,
        )

    def stop(self, *, sequence: int = 0) -> RobotGatewayControlAck:
        return RobotGatewayControlAck(
            accepted=True,
            reason="safe hold requested",
            sequence=sequence,
        )

    def estop(self, *, sequence: int = 0) -> RobotGatewayControlAck:
        self._estop = True
        return RobotGatewayControlAck(
            accepted=True,
            reason="e-stop latched",
            sequence=sequence,
        )

    def _initial_joint_positions(self) -> dict[str, float]:
        joint_names = self.config.joint_names or self._infer_controlled_joint_names()
        return {joint_name: 0.0 for joint_name in joint_names}

    def _infer_controlled_joint_names(self) -> tuple[str, ...]:
        robot = self._robot_instance()
        action_features = getattr(robot, "action_features", None)
        if isinstance(action_features, Mapping):
            joint_names = tuple(
                key.removesuffix(".pos")
                for key in action_features
                if isinstance(key, str) and key.endswith(".pos")
            )
            if joint_names:
                return joint_names
        bus = getattr(robot, "bus", None)
        motors = getattr(bus, "motors", None)
        if isinstance(motors, Mapping) and motors:
            return tuple(str(joint_name) for joint_name in motors)
        raise RuntimeError(
            "LeRobot controlled joints are unknown. Set URDF_ROBOT_GATEWAY_JOINT_NAMES."
        )

    def _robot_instance(self) -> object:
        if self._robot is None:
            self._robot = self._robot_factory(self.config)
        return self._robot

    def _connect(self) -> object:
        robot = self._robot_instance()
        if not bool(getattr(robot, "is_connected", False)):
            connect = getattr(robot, "connect")
            connect(calibrate=False)
        return robot

    def _build_calibration_status(
        self,
        robot: object | None = None,
    ) -> _LeRobotCalibrationStatus:
        robot = robot if robot is not None else self._robot
        calibration_id = self._calibration_id(robot)
        if robot is None:
            return _LeRobotCalibrationStatus(
                ready=False,
                calibration_id=calibration_id,
                reason=ROBOT_GATEWAY_LEROBOT_CALIBRATION_REQUIRED_REASON,
            )
        try:
            is_calibrated = getattr(robot, "is_calibrated")
        except Exception:
            is_calibrated = False
        if isinstance(is_calibrated, bool):
            ready = is_calibrated
        else:
            ready = bool(is_calibrated)
        return _LeRobotCalibrationStatus(
            ready=ready,
            calibration_id=calibration_id,
            reason=None if ready else ROBOT_GATEWAY_LEROBOT_CALIBRATION_REQUIRED_REASON,
        )

    def _validate_calibration_ready(self, robot: object | None = None) -> str | None:
        calibration_status = self._build_calibration_status(robot)
        if calibration_status.ready:
            return None
        return calibration_status.reason or ROBOT_GATEWAY_LEROBOT_CALIBRATION_REQUIRED_REASON

    def _calibration_id(self, robot: object | None) -> str | None:
        if robot is not None:
            calibration_fpath = getattr(robot, "calibration_fpath", None)
            if calibration_fpath:
                return Path(calibration_fpath).stem
            robot_id = getattr(robot, "id", None)
            if robot_id:
                return str(robot_id)
        return self.config.lerobot_id or self.config.robot_id

    def _read_joint_positions(self) -> dict[str, float]:
        robot = self._connect()
        bus = getattr(robot, "bus", None)
        if bus is not None and hasattr(bus, "sync_read"):
            raw_positions = dict(
                bus.sync_read(
                    "Present_Position",
                    [
                        self._hardware_joint_name(joint_name)
                        for joint_name in self._joint_positions
                    ],
                    num_retry=2,
                )
            )
            observation = {
                _lerobot_joint_key(_model_joint_name): raw_positions[
                    self._hardware_joint_name(_model_joint_name)
                ]
                for _model_joint_name in self._joint_positions
            }
        else:
            observation = dict(getattr(robot, "get_observation")())
        positions: dict[str, float] = {}
        missing_joint_names: list[str] = []
        for joint_name in self._joint_positions:
            model_key = _lerobot_joint_key(joint_name)
            hardware_key = _lerobot_joint_key(self._hardware_joint_name(joint_name))
            if model_key in observation:
                raw_value = observation[model_key]
            elif hardware_key in observation:
                raw_value = observation[hardware_key]
            else:
                missing_joint_names.append(joint_name)
                continue
            positions[joint_name] = _lerobot_units_to_model_rad(
                joint_name,
                float(raw_value),
                self._joint_direction(joint_name),
            )
        if missing_joint_names:
            raise RuntimeError(
                "LeRobot observation missing controlled joints: "
                + ", ".join(missing_joint_names)
            )
        return positions

    def _send_joint_target(
        self,
        joint_name: str,
        target_position_rad: float,
    ) -> Mapping[str, float]:
        robot = self._connect()
        target_units = _model_rad_to_lerobot_units(
            joint_name,
            target_position_rad,
            self._joint_direction(joint_name),
        )
        bus = getattr(robot, "bus", None)
        if bus is not None and hasattr(bus, "sync_write"):
            bus.sync_write(
                "Goal_Position",
                {self._hardware_joint_name(joint_name): target_units},
            )
            return {_lerobot_joint_key(joint_name): target_units}
        send_action = getattr(robot, "send_action")
        sent_action = dict(
            send_action(
                {
                    _lerobot_joint_key(
                        self._hardware_joint_name(joint_name)
                    ): target_units
                }
            )
        )
        hardware_key = _lerobot_joint_key(self._hardware_joint_name(joint_name))
        if hardware_key in sent_action:
            return {_lerobot_joint_key(joint_name): sent_action[hardware_key]}
        return sent_action

    def _hardware_joint_name(self, model_joint_name: str) -> str:
        return self._joint_map.get(model_joint_name, model_joint_name)

    def _joint_direction(self, model_joint_name: str) -> int:
        return self._joint_directions.get(
            model_joint_name,
            LEROBOT_MODEL_JOINT_DIRECTION_FORWARD,
        )

    def disconnect(self) -> int:
        robot = self._robot
        self._robot = None
        if robot is None:
            return 0
        disconnect = getattr(robot, "disconnect", None)
        if callable(disconnect) and bool(getattr(robot, "is_connected", False)):
            disconnect()
            return 1
        return 0

    def reload_lerobot_calibration_file(
        self,
        calibration_path: Path,
    ) -> RobotGatewayCalibrationReloadResult:
        resolved_path = calibration_path.expanduser().resolve()
        active_path = self._active_lerobot_calibration_path()
        if active_path != resolved_path:
            return RobotGatewayCalibrationReloadResult(
                matched=False,
                applied=False,
                message="Selected file is not the active follower calibration.",
            )
        robot = self._robot
        if robot is None:
            return RobotGatewayCalibrationReloadResult(
                matched=True,
                applied=True,
                message="Selected calibration will load on the next hardware read.",
            )
        load_calibration = getattr(robot, "_load_calibration", None)
        if not callable(load_calibration):
            released = self.disconnect()
            return RobotGatewayCalibrationReloadResult(
                matched=True,
                applied=True,
                message=(
                    "Reloaded selected calibration by reconnecting hardware."
                    if released
                    else "Selected calibration will load on the next hardware read."
                ),
            )
        load_calibration(resolved_path)
        calibration = getattr(robot, "calibration", None)
        wrote_bus_calibration = _write_lerobot_bus_calibration(robot, calibration)
        return RobotGatewayCalibrationReloadResult(
            matched=True,
            applied=True,
            message=(
                "Reloaded selected follower calibration."
                if wrote_bus_calibration
                else "Reloaded selected calibration file."
            ),
        )

    def _active_lerobot_calibration_path(self) -> Path | None:
        robot = self._robot
        if robot is not None:
            calibration_fpath = getattr(robot, "calibration_fpath", None)
            if calibration_fpath:
                return Path(calibration_fpath).expanduser().resolve()
        payload = _build_lerobot_config_payload(self.config)
        calibration_id = str(payload.get("id", "")).strip()
        calibration_dir = payload.get("calibration_dir")
        if not calibration_id or calibration_dir is None:
            return None
        return (Path(str(calibration_dir)).expanduser() / f"{calibration_id}.json").resolve()


def _coerce_robot_gateway_joint_telemetry(
    joint_name: str,
    raw_telemetry: object,
) -> RobotGatewayJointTelemetry:
    if isinstance(raw_telemetry, RobotGatewayJointTelemetry):
        return raw_telemetry
    try:
        position_rad = float(getattr(raw_telemetry, "position_rad"))
        velocity_rad_per_sec = _optional_float_attr(
            raw_telemetry,
            "velocity_rad_per_sec",
        )
        torque_nm = _optional_float_attr(raw_telemetry, "torque_nm")
        temp_mos_c = _optional_float_attr(raw_telemetry, "temp_mos_c")
        temp_rotor_c = _optional_float_attr(raw_telemetry, "temp_rotor_c")
        fault_code = getattr(raw_telemetry, "fault_code", None)
    except (TypeError, ValueError) as exc:
        raise OpenArmCanTransportError(
            f"OpenArm follower joint telemetry is invalid for {joint_name}."
        ) from exc
    if not math.isfinite(position_rad):
        raise OpenArmCanTransportError(
            f"OpenArm follower joint telemetry is non-finite for {joint_name}."
        )
    return RobotGatewayJointTelemetry(
        position_rad=position_rad,
        velocity_rad_per_sec=velocity_rad_per_sec,
        torque_nm=torque_nm,
        temp_mos_c=temp_mos_c,
        temp_rotor_c=temp_rotor_c,
        fault_code=int(fault_code) if fault_code is not None else None,
    )


def _optional_float_attr(raw_telemetry: object, attr_name: str) -> float | None:
    value = getattr(raw_telemetry, attr_name, None)
    if value is None:
        return None
    float_value = float(value)
    if not math.isfinite(float_value):
        return None
    return float_value


def _model_delta_from_hardware_if_present(
    calibration: RobotGatewayJointRotationCalibration,
    joint_name: str,
    hardware_delta_rad: float | None,
) -> float | None:
    if hardware_delta_rad is None:
        return None
    return calibration.model_delta_from_hardware(joint_name, hardware_delta_rad)


def build_robot_gateway_adapter(config: RobotGatewayAdapterConfig) -> RobotGatewayAdapter:
    if config.adapter_kind == "openarm_ros2":
        return Ros2OpenArmAdapter(config)
    if config.adapter_kind == "openarm_native":
        safety_preflight = None
        if not config.allow_unvalidated_self_collision:
            safety_preflight = build_default_openarm_self_collision_preflight()
        return NativeOpenArmAdapter(
            config,
            safety_preflight=safety_preflight,
            joint_rotation_calibration=build_openarm_joint_rotation_calibration_from_env(
                config.joint_names
            ),
        )
    if config.adapter_kind in {
        ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
    }:
        return LeRobotAdapter(config)
    return FakeOpenArmAdapter(config)


def _build_lerobot_robot(config: RobotGatewayAdapterConfig) -> object:
    if not config.lerobot_robot_type:
        raise ValueError(
            "LeRobot gateway requires URDF_ROBOT_GATEWAY_LEROBOT_ROBOT_TYPE."
        )
    _import_lerobot_robot_configs()
    import draccus
    from lerobot.robots import RobotConfig, make_robot_from_config

    payload = _build_lerobot_config_payload(config)
    robot_config = draccus.decode(
        RobotConfig,
        {"type": config.lerobot_robot_type, **payload},
    )
    return make_robot_from_config(robot_config)


def _write_lerobot_bus_calibration(robot: object, calibration: object) -> bool:
    if not isinstance(calibration, Mapping):
        return False
    wrote = False
    for bus_attr in ("bus", "bus_left", "bus_right"):
        bus = getattr(robot, bus_attr, None)
        write_calibration = getattr(bus, "write_calibration", None)
        if not callable(write_calibration):
            continue
        write_calibration(calibration)
        wrote = True
    return wrote


def _import_lerobot_robot_configs() -> None:
    for module_name in (
        "lerobot.robots.so_follower.config_so_follower",
        "lerobot.robots.lekiwi.config_lekiwi",
        "lerobot.robots.openarm_follower.config_openarm_follower",
        "lerobot.robots.bi_openarm_follower.config_bi_openarm_follower",
        "lerobot.robots.koch_follower.config_koch_follower",
        "lerobot.robots.omx_follower.config_omx_follower",
        "lerobot.robots.hope_jr.config_hope_jr",
        "lerobot.robots.reachy2.configuration_reachy2",
        "lerobot.robots.unitree_g1.config_unitree_g1",
    ):
        try:
            importlib.import_module(module_name)
        except Exception:
            continue


def _build_lerobot_config_payload(config: RobotGatewayAdapterConfig) -> dict[str, Any]:
    if config.lerobot_config_json:
        raw_payload = json.loads(config.lerobot_config_json)
        if not isinstance(raw_payload, dict):
            raise ValueError("URDF_ROBOT_GATEWAY_LEROBOT_CONFIG_JSON must be a JSON object.")
        payload = dict(raw_payload)
    else:
        payload = {}
    payload.setdefault("id", config.lerobot_id or config.robot_id)
    if config.lerobot_calibration_dir is not None:
        payload.setdefault("calibration_dir", str(config.lerobot_calibration_dir))
    if config.lerobot_port:
        payload.setdefault("port", config.lerobot_port)
    return payload


def _build_openarm_profile(
    *,
    adapter_id: str,
    teleoperation_mode: RobotGatewayTeleoperationMode,
    robot_id: str,
    joint_names: tuple[str, ...],
    control_enabled: bool,
    summary: str,
) -> RobotGatewayProfile:
    return RobotGatewayProfile(
        id=ROBOT_GATEWAY_OPENARM_PROFILE_ID,
        robot_id=robot_id,
        adapter_id=adapter_id,
        teleoperation_mode=teleoperation_mode,
        controlled_joint_names=list(joint_names),
        control_inputs=(
            build_default_robot_gateway_control_inputs() if control_enabled else []
        ),
        summary=summary,
        capabilities=RobotGatewayProfileCapabilities(
            arm_joint_state=True,
            arm_joint_command=control_enabled,
            state_mirroring=True,
            joint_jog=control_enabled,
            gripper=control_enabled,
        ),
        topics=RobotGatewayProfileTopics(
            joint_states=["provider:/telemetry/state"],
            joint_jog="provider:/control/joint-jog" if control_enabled else None,
            robot_state="provider:/telemetry/state",
        ),
        limits=RobotGatewayProfileLimits(),
    )


def _build_lerobot_profile(
    *,
    adapter_id: str,
    teleoperation_mode: RobotGatewayTeleoperationMode,
    robot_id: str,
    joint_names: tuple[str, ...],
    robot_type: str,
    hardware_device_key: str,
    control_enabled: bool,
    joint_directions: Mapping[str, int] | None = None,
) -> RobotGatewayProfile:
    return RobotGatewayProfile(
        id=_lerobot_profile_id(robot_type),
        label=f"{_lerobot_robot_type_label(robot_type)} joint jog",
        control_target_label=f"{_lerobot_robot_type_label(robot_type)} robot gateway",
        robot_id=robot_id,
        adapter_id=adapter_id,
        hardware_device_key=hardware_device_key,
        teleoperation_mode=teleoperation_mode,
        controlled_joint_names=list(joint_names),
        control_inputs=(
            build_default_robot_gateway_control_inputs() if control_enabled else []
        ),
        summary="LeRobot adapter backed by the configured local or remote robot transport.",
        capabilities=RobotGatewayProfileCapabilities(
            arm_joint_state=True,
            arm_joint_command=control_enabled,
            state_mirroring=True,
            joint_jog=control_enabled,
            gripper=control_enabled,
        ),
        topics=RobotGatewayProfileTopics(
            joint_states=["provider:/telemetry/state"],
            joint_jog="provider:/control/joint-jog" if control_enabled else None,
            robot_state="provider:/telemetry/state",
        ),
        limits=RobotGatewayProfileLimits(),
        joint_limits={
            joint_name: _build_lerobot_joint_limit(joint_name, joint_directions)
            for joint_name in joint_names
        },
    )


def _build_lerobot_joint_limit(
    joint_name: str,
    joint_directions: Mapping[str, int] | None = None,
) -> RobotGatewayJointLimit:
    lower_rad, upper_rad = _resolve_lerobot_joint_limit(
        joint_name,
        (joint_directions or {}).get(
            joint_name,
            LEROBOT_MODEL_JOINT_DIRECTION_FORWARD,
        ),
    )
    return RobotGatewayJointLimit(lower_rad=lower_rad, upper_rad=upper_rad)


def _lerobot_profile_id(robot_type: str) -> str:
    normalized_type = _sanitize_lerobot_robot_type(robot_type)
    return f"{normalized_type}_joint_jog" if normalized_type else "lerobot_joint_jog"


def _lerobot_robot_type_label(robot_type: str) -> str:
    normalized_type = _sanitize_lerobot_robot_type(robot_type)
    return normalized_type.replace("_", " ").title() if normalized_type else "LeRobot"


def _sanitize_lerobot_robot_type(robot_type: str | None) -> str:
    return "".join(
        char if char.isalnum() else "_"
        for char in (robot_type or "").strip().lower()
    ).strip("_")


def _build_lerobot_joint_map(
    config: RobotGatewayAdapterConfig,
) -> dict[str, str]:
    if not config.lerobot_hardware_joint_names:
        return {}
    if len(config.joint_names) != len(config.lerobot_hardware_joint_names):
        raise ValueError(
            "URDF_ROBOT_GATEWAY_JOINT_NAMES and "
            "URDF_ROBOT_GATEWAY_LEROBOT_HARDWARE_JOINT_NAMES must have the same length."
        )
    return {
        model_joint_name: hardware_joint_name
        for model_joint_name, hardware_joint_name in zip(
            config.joint_names,
            config.lerobot_hardware_joint_names,
            strict=True,
        )
    }


def _lerobot_hardware_device_key(config: RobotGatewayAdapterConfig) -> str:
    return (config.lerobot_port or "").strip()


def _validate_joint_jog_delta(delta_rad: float) -> str | None:
    if abs(delta_rad) > ROBOT_GATEWAY_DEFAULT_MAX_JOINT_JOG_DELTA_RAD:
        return ROBOT_GATEWAY_JOINT_JOG_DELTA_LIMIT_REASON
    return None


def _validate_joint_jog_velocity(
    *,
    delta_rad: float,
    last_applied_monotonic_ms: float | None,
    now_monotonic_ms: float,
) -> str | None:
    if last_applied_monotonic_ms is None:
        return None
    elapsed_ms = max(0.0, now_monotonic_ms - last_applied_monotonic_ms)
    max_delta_rad = (
        ROBOT_GATEWAY_DEFAULT_MAX_JOINT_VELOCITY_RAD_PER_SEC
        * elapsed_ms
        / ROBOT_GATEWAY_SECONDS_TO_MS
    )
    if abs(delta_rad) > max_delta_rad:
        return ROBOT_GATEWAY_JOINT_JOG_VELOCITY_LIMIT_REASON
    return None


def _validate_openarm_calibration_jog_delta(delta_rad: float) -> str | None:
    if (
        delta_rad < ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_MIN_DELTA_RAD
        or delta_rad > ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_MAX_DELTA_RAD
    ):
        return ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_DELTA_LIMIT_REASON
    return None


def _validate_openarm_calibration_jog_velocity(
    *,
    delta_rad: float,
    last_applied_monotonic_ms: float | None,
    now_monotonic_ms: float,
) -> str | None:
    if last_applied_monotonic_ms is None:
        return None
    elapsed_ms = max(0.0, now_monotonic_ms - last_applied_monotonic_ms)
    max_delta_rad = (
        ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_MAX_VELOCITY_RAD_PER_SEC
        * elapsed_ms
        / ROBOT_GATEWAY_SECONDS_TO_MS
    )
    if abs(delta_rad) > max_delta_rad:
        return ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_VELOCITY_LIMIT_REASON
    return None


def _find_openarm_uncommanded_calibration_motion(
    *,
    commanded_joint_name: str,
    before_positions: Mapping[str, float],
    after_positions: Mapping[str, float],
) -> str | None:
    for joint_name, before_position_rad in before_positions.items():
        if joint_name == commanded_joint_name:
            continue
        after_position_rad = after_positions.get(joint_name)
        if after_position_rad is None:
            continue
        if (
            abs(after_position_rad - before_position_rad)
            > ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_MAX_UNCOMMANDED_DELTA_RAD
        ):
            return joint_name
    return None


def _validate_openarm_physical_joint_limit(
    joint_name: str,
    target_position_rad: float,
) -> str | None:
    joint_limits = _resolve_openarm_physical_joint_limit(joint_name)
    if joint_limits is None:
        return None
    lower_rad, upper_rad = joint_limits
    if target_position_rad < lower_rad or target_position_rad > upper_rad:
        return ROBOT_GATEWAY_JOINT_JOG_POSITION_LIMIT_REASON
    return None


def _validate_lerobot_joint_limit(
    joint_name: str,
    target_position_rad: float,
    direction: int = LEROBOT_MODEL_JOINT_DIRECTION_FORWARD,
) -> str | None:
    lower_rad, upper_rad = _resolve_lerobot_joint_limit(joint_name, direction)
    if target_position_rad < lower_rad or target_position_rad > upper_rad:
        return ROBOT_GATEWAY_JOINT_JOG_POSITION_LIMIT_REASON
    return None


def _resolve_openarm_physical_joint_limit(
    joint_name: str,
) -> tuple[float, float] | None:
    if joint_name.startswith(ROBOT_GATEWAY_OPENARM_CAN_LEFT_JOINT_PREFIX):
        suffix = joint_name.removeprefix(ROBOT_GATEWAY_OPENARM_CAN_LEFT_JOINT_PREFIX)
        return ROBOT_GATEWAY_OPENARM_LEFT_JOINT_LIMITS_RAD.get(suffix)
    if joint_name.startswith(ROBOT_GATEWAY_OPENARM_CAN_RIGHT_JOINT_PREFIX):
        suffix = joint_name.removeprefix(ROBOT_GATEWAY_OPENARM_CAN_RIGHT_JOINT_PREFIX)
        return ROBOT_GATEWAY_OPENARM_RIGHT_JOINT_LIMITS_RAD.get(suffix)
    return None


def _resolve_lerobot_joint_limit(
    joint_name: str,
    direction: int = LEROBOT_MODEL_JOINT_DIRECTION_FORWARD,
) -> tuple[float, float]:
    if joint_name in ROBOT_GATEWAY_LEROBOT_GRIPPER_JOINT_NAMES:
        hardware_limits = (0.0, 100.0 / ROBOT_GATEWAY_LEROBOT_GRIPPER_UNITS_PER_RAD)
    else:
        hardware_limits = (-math.pi, math.pi)
    if direction == LEROBOT_MODEL_JOINT_DIRECTION_REVERSED:
        lower_rad, upper_rad = hardware_limits
        return (-upper_rad, -lower_rad)
    return hardware_limits


def _is_openarm_gripper_joint(joint_name: str) -> bool:
    return any(
        joint_name.endswith(joint_suffix)
        for joint_suffix in ROBOT_GATEWAY_OPENARM_GRIPPER_JOINT_SUFFIXES
    )


def _lerobot_joint_key(joint_name: str) -> str:
    return f"{joint_name}.pos"


def _resolve_lerobot_model_joint_direction(
    config: RobotGatewayAdapterConfig,
    joint_name: str,
) -> int:
    hardware_joint_name = _build_lerobot_joint_map(config).get(joint_name, joint_name)
    if (
        _is_lerobot_so_style_profile(config.lerobot_robot_type)
        and (
            joint_name in ROBOT_GATEWAY_LEROBOT_SO_STYLE_REVERSED_MODEL_JOINT_NAMES
            or hardware_joint_name
            in ROBOT_GATEWAY_LEROBOT_SO_STYLE_REVERSED_MODEL_JOINT_NAMES
        )
    ):
        return LEROBOT_MODEL_JOINT_DIRECTION_REVERSED
    return LEROBOT_MODEL_JOINT_DIRECTION_FORWARD


def _is_lerobot_so_style_profile(profile_id: str | None) -> bool:
    if not isinstance(profile_id, str):
        return False
    normalized = profile_id.strip().lower()
    return normalized.startswith(ROBOT_GATEWAY_LEROBOT_SO_STYLE_PROFILE_PREFIX) and (
        normalized.endswith(ROBOT_GATEWAY_LEROBOT_LEADER_PROFILE_SUFFIX)
        or normalized.endswith(ROBOT_GATEWAY_LEROBOT_FOLLOWER_PROFILE_SUFFIX)
    )


def _lerobot_units_to_model_rad(
    joint_name: str,
    value: float,
    direction: int = LEROBOT_MODEL_JOINT_DIRECTION_FORWARD,
) -> float:
    if joint_name in ROBOT_GATEWAY_LEROBOT_GRIPPER_JOINT_NAMES:
        hardware_position_rad = value / ROBOT_GATEWAY_LEROBOT_GRIPPER_UNITS_PER_RAD
    else:
        hardware_position_rad = math.radians(value)
    return direction * hardware_position_rad


def _model_rad_to_lerobot_units(
    joint_name: str,
    value: float,
    direction: int = LEROBOT_MODEL_JOINT_DIRECTION_FORWARD,
) -> float:
    hardware_position_rad = direction * value
    if joint_name in ROBOT_GATEWAY_LEROBOT_GRIPPER_JOINT_NAMES:
        return hardware_position_rad * ROBOT_GATEWAY_LEROBOT_GRIPPER_UNITS_PER_RAD
    return math.degrees(hardware_position_rad)


def _read_lerobot_action_joint_position_rad(
    action: Mapping[str, float],
    joint_name: str,
    fallback_position_rad: float,
    direction: int = LEROBOT_MODEL_JOINT_DIRECTION_FORWARD,
) -> float:
    value = action.get(_lerobot_joint_key(joint_name))
    if value is None:
        return fallback_position_rad
    return _lerobot_units_to_model_rad(joint_name, float(value), direction)


def _now_monotonic_ms() -> float:
    return monotonic() * ROBOT_GATEWAY_SECONDS_TO_MS


def _build_openarm_depth_camera_intrinsics() -> RobotGatewayCameraIntrinsics:
    return RobotGatewayCameraIntrinsics(
        width=ROBOT_GATEWAY_FAKE_POINT_CLOUD_WIDTH,
        height=ROBOT_GATEWAY_FAKE_POINT_CLOUD_HEIGHT,
        fx=ROBOT_GATEWAY_FAKE_POINT_CLOUD_FX,
        fy=ROBOT_GATEWAY_FAKE_POINT_CLOUD_FY,
        ppx=ROBOT_GATEWAY_FAKE_POINT_CLOUD_PPX,
        ppy=ROBOT_GATEWAY_FAKE_POINT_CLOUD_PPY,
    )


def _build_openarm_depth_camera_pose() -> RobotGatewayCameraPose:
    return RobotGatewayCameraPose(
        position=ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_POSITION_XYZ_M,
        rotation_rpy_deg=ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ROTATION_RPY_DEG,
        scale=ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_POINT_SCALE,
        world_frame=ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_WORLD_FRAME,
    )


def _build_openarm_depth_camera_stream() -> RobotGatewayCameraStream:
    return RobotGatewayCameraStream(
        id=ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID,
        label=ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_LABEL,
        frame_id=ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_FRAME_ID,
        coordinate_frame="robot_world",
        intrinsics=_build_openarm_depth_camera_intrinsics(),
        color_stream_path=f"/perception/cameras/{ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID}/color",
        depth_stream_path=f"/perception/cameras/{ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID}/depth",
        metadata_stream_path=f"/perception/cameras/{ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID}/metadata",
        point_cloud_path=f"/perception/cameras/{ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID}/point-cloud",
        camera_pose=_build_openarm_depth_camera_pose(),
    )


def _build_fake_openarm_point_cloud_frame(*, sequence: int) -> RobotGatewayPointCloudFrame:
    intrinsics = _build_openarm_depth_camera_intrinsics()
    points_xyz: list[tuple[float, float, float]] = []
    colors_rgb: list[tuple[float, float, float]] = []
    phase = sequence * ROBOT_GATEWAY_FAKE_POINT_CLOUD_PHASE_STEP_RAD
    for row in range(intrinsics.height):
        for column in range(intrinsics.width):
            normalized_column = column / max(
                ROBOT_GATEWAY_FAKE_POINT_CLOUD_DENOMINATOR_MIN,
                intrinsics.width - ROBOT_GATEWAY_FAKE_POINT_CLOUD_DENOMINATOR_MIN,
            )
            normalized_row = row / max(
                ROBOT_GATEWAY_FAKE_POINT_CLOUD_DENOMINATOR_MIN,
                intrinsics.height - ROBOT_GATEWAY_FAKE_POINT_CLOUD_DENOMINATOR_MIN,
            )
            wave = math.sin(
                normalized_column * math.pi * ROBOT_GATEWAY_FAKE_POINT_CLOUD_FULL_WAVE_MULTIPLIER
                + phase
            ) * math.cos(
                normalized_row * math.pi + phase
            )
            depth_m = ROBOT_GATEWAY_FAKE_POINT_CLOUD_BASE_DEPTH_M + (
                ROBOT_GATEWAY_FAKE_POINT_CLOUD_DEPTH_WAVE_M * wave
            )
            camera_x_m = (column - intrinsics.ppx) * depth_m / intrinsics.fx
            camera_y_m = (row - intrinsics.ppy) * depth_m / intrinsics.fy
            points_xyz.append(
                (
                    ROBOT_GATEWAY_FAKE_POINT_CLOUD_X_OFFSET_M + depth_m,
                    ROBOT_GATEWAY_FAKE_POINT_CLOUD_Y_OFFSET_M - camera_x_m,
                    ROBOT_GATEWAY_FAKE_POINT_CLOUD_Z_OFFSET_M - camera_y_m,
                )
            )
            colors_rgb.append(
                (
                    normalized_column,
                    normalized_row,
                    ROBOT_GATEWAY_FAKE_POINT_CLOUD_COLOR_MAX - normalized_column,
                )
            )
    return RobotGatewayPointCloudFrame(
        camera_id=ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID,
        frame_id=ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_FRAME_ID,
        coordinate_frame="robot_world",
        sequence=sequence,
        source_ts_ms=int(time() * 1000),
        intrinsics=intrinsics,
        points_xyz=points_xyz,
        colors_rgb=colors_rgb,
    )
