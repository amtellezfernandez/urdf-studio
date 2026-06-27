from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.models.live_transport import LiveTransportDescriptor
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_CONTRACT_VERSION,
    ROBOT_GATEWAY_CONTROL_INPUT_BROWSER_JOYSTICK_ID,
    ROBOT_GATEWAY_CONTROL_INPUT_BROWSER_JOYSTICK_LABEL,
    ROBOT_GATEWAY_CONTROL_INPUT_BROWSER_JOYSTICK_SUMMARY,
    ROBOT_GATEWAY_CONTROL_INPUT_BROWSER_KEYBOARD_ID,
    ROBOT_GATEWAY_CONTROL_INPUT_BROWSER_KEYBOARD_LABEL,
    ROBOT_GATEWAY_CONTROL_INPUT_BROWSER_KEYBOARD_SUMMARY,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_REQUIRED_ROLE,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_TRANSPORT,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_VERIFY_PATH,
    ROBOT_GATEWAY_DEFAULT_COMMAND_TICK_MS,
    ROBOT_GATEWAY_DEFAULT_CONTROL_RTT_MS,
    ROBOT_GATEWAY_DEFAULT_DEADMAN_TIMEOUT_MS,
    ROBOT_GATEWAY_DEFAULT_JOINT_JOG_STEP_RAD,
    ROBOT_GATEWAY_DEFAULT_LINEAR_SPEED_MPS,
    ROBOT_GATEWAY_DEFAULT_MAX_JOINT_JOG_DELTA_RAD,
    ROBOT_GATEWAY_DEFAULT_MAX_JOINT_VELOCITY_RAD_PER_SEC,
    ROBOT_GATEWAY_DEFAULT_OPERATOR_RTT_MS,
    ROBOT_GATEWAY_DEFAULT_PROVIDER_DISPLAY_NAME,
    ROBOT_GATEWAY_DEFAULT_PROVIDER_ID,
    ROBOT_GATEWAY_DEFAULT_SESSION_ID,
    ROBOT_GATEWAY_DEFAULT_YAW_SPEED_RPS,
    ROBOT_GATEWAY_LEROBOT_DIRECT_TELEOP_DEFAULT_FPS,
    ROBOT_GATEWAY_LEROBOT_DIRECT_TELEOP_MAX_FPS,
    ROBOT_GATEWAY_LEROBOT_DIRECT_TELEOP_MIN_FPS,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_KD_MAX,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_KD_MIN,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_KP_MAX,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_KP_MIN,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_POSITION_LIMIT_RAD,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_TORQUE_LIMIT_NM,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_VELOCITY_LIMIT_RAD_PER_SEC,
    ROBOT_GATEWAY_OPENARM_CAN_BYTE_MAX,
    ROBOT_GATEWAY_OPENARM_CAN_DLC_BYTES,
    ROBOT_GATEWAY_OPENARM_CAN_DRY_RUN_TRANSMISSION_STATE,
    ROBOT_GATEWAY_OPENARM_CAN_PROTOCOL,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_MAX_DELTA_RAD,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_MIN_DELTA_RAD,
    ROBOT_GATEWAY_MAX_CONTROL_SEQUENCE,
    ROBOT_GATEWAY_POINT_CLOUD_MAX_COLOR,
    ROBOT_GATEWAY_POINT_CLOUD_MAX_COORD_M,
    ROBOT_GATEWAY_POINT_CLOUD_MAX_POINTS,
    ROBOT_GATEWAY_POINT_CLOUD_MIN_COLOR,
    ROBOT_GATEWAY_POINT_CLOUD_MIN_COORD_M,
    ROBOT_GATEWAY_MAX_JOINT_JOG_DELTA_RAD,
    ROBOT_GATEWAY_MAX_SOURCE_TIMESTAMP_MS,
    ROBOT_GATEWAY_MIN_JOINT_JOG_DELTA_RAD,
    ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_FRAME_ID,
    ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID,
    ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_LABEL,
    ROBOT_GATEWAY_OPENARM_CONTROL_TARGET_LABEL,
    ROBOT_GATEWAY_OPENARM_PROFILE_ID,
    ROBOT_GATEWAY_OPENARM_ROBOT_ID,
    ROBOT_GATEWAY_TELEOPERATION_MODE_SIMULATED,
)

RobotGatewayConnectionState = Literal[
    "idle", "connecting", "active", "closing", "closed"
]
RobotGatewayControlMode = Literal["manual", "shared_autonomy", "safe_hold"]
RobotGatewayProfileKind = Literal["manipulator", "mobile_base", "mobile_manipulator"]
RobotGatewayTransport = Literal["robot_gateway"]
RobotGatewayControlTargetSide = Literal["left", "right", "both", "center"]
RobotGatewayControlInputKind = Literal[
    "keyboard", "joystick", "leader_arm", "spacemouse", "policy", "custom"
]
RobotGatewayControlTransport = Literal["teleop_sidecar"]
RobotGatewayControlCommandKind = Literal["twist", "stop", "estop", "joint_jog"]
RobotGatewayControlDatagramRole = Literal["operator", "robot", "observer"]
RobotGatewayAdapterKind = Literal[
    "fake_openarm",
    "openarm_ros2",
    "openarm_native",
    "lerobot",
]
RobotGatewayRuntimeMode = Literal["observe", "control"]
RobotGatewayTeleoperationMode = Literal["simulated", "real_hardware"]
RobotGatewayCameraKind = Literal["rgb", "depth", "rgbd"]
RobotGatewayPointCloudCoordinateFrame = Literal["robot_world", "camera"]
RobotGatewayPointCloudWorldFrame = Literal["urdf_z_up", "hf_y_up"]
RobotGatewayLeRobotDirectTeleopState = Literal[
    "idle", "starting", "running", "stopping", "stopped", "error"
]


class RobotGatewayCapabilitySet(BaseModel):
    observe: bool = True
    telemetry: bool = True
    video: bool = False
    record: bool = False
    control: bool = False
    estop: bool = True


class RobotGatewayProfileCapabilities(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    base_twist: bool = Field(default=False, alias="baseTwist")
    lateral_strafe: bool = Field(default=False, alias="lateralStrafe")
    arm_joint_state: bool = Field(default=True, alias="armJointState")
    arm_joint_command: bool = Field(default=False, alias="armJointCommand")
    state_mirroring: bool = Field(default=True, alias="stateMirroring")
    joint_jog: bool = Field(default=False, alias="jointJog")
    gripper: bool = False
    target_pose_ik: bool = Field(default=False, alias="targetPoseIk")


class RobotGatewayProfileTopics(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    twist: str | None = None
    odom: str | None = None
    joint_states: list[str] = Field(default_factory=list, alias="jointStates")
    battery: str | None = None
    arm_command: str | None = Field(default=None, alias="armCommand")
    goto_joint_service: str | None = Field(default=None, alias="gotoJointService")
    joint_jog: str | None = Field(default=None, alias="jointJog")
    robot_state: str | None = Field(default=None, alias="robotState")


class RobotGatewayJointLimit(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    lower_rad: float = Field(..., alias="lowerRad")
    upper_rad: float = Field(..., alias="upperRad")

    @field_validator("lower_rad", "upper_rad")
    @classmethod
    def _validate_finite_limit(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("joint limits must be finite.")
        return value

    @model_validator(mode="after")
    def _validate_ordered_limit(self) -> "RobotGatewayJointLimit":
        if self.lower_rad >= self.upper_rad:
            raise ValueError("joint lower limit must be below upper limit.")
        return self


class RobotGatewayProfileLimits(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    max_linear_speed_mps: float = Field(
        default=ROBOT_GATEWAY_DEFAULT_LINEAR_SPEED_MPS, alias="maxLinearSpeedMps"
    )
    max_yaw_speed_rps: float = Field(
        default=ROBOT_GATEWAY_DEFAULT_YAW_SPEED_RPS, alias="maxYawSpeedRps"
    )
    command_tick_ms: int = Field(
        default=ROBOT_GATEWAY_DEFAULT_COMMAND_TICK_MS, ge=1, alias="commandTickMs"
    )
    deadman_timeout_ms: int = Field(
        default=ROBOT_GATEWAY_DEFAULT_DEADMAN_TIMEOUT_MS, ge=1, alias="deadmanTimeoutMs"
    )
    max_joint_jog_delta_rad: float = Field(
        default=ROBOT_GATEWAY_DEFAULT_MAX_JOINT_JOG_DELTA_RAD,
        gt=0.0,
        le=ROBOT_GATEWAY_MAX_JOINT_JOG_DELTA_RAD,
        alias="maxJointJogDeltaRad",
    )
    default_joint_jog_step_rad: float = Field(
        default=ROBOT_GATEWAY_DEFAULT_JOINT_JOG_STEP_RAD,
        gt=0.0,
        le=ROBOT_GATEWAY_MAX_JOINT_JOG_DELTA_RAD,
        alias="defaultJointJogStepRad",
    )
    max_joint_velocity_rad_per_s: float = Field(
        default=ROBOT_GATEWAY_DEFAULT_MAX_JOINT_VELOCITY_RAD_PER_SEC,
        gt=0.0,
        alias="maxJointVelocityRadPerSec",
    )


class RobotGatewayControlInputDescriptor(BaseModel):
    id: str = Field(..., min_length=1)
    kind: RobotGatewayControlInputKind
    label: str = Field(..., min_length=1)
    summary: str = ""


def build_default_robot_gateway_control_inputs() -> list[
    RobotGatewayControlInputDescriptor
]:
    return [
        RobotGatewayControlInputDescriptor(
            id=ROBOT_GATEWAY_CONTROL_INPUT_BROWSER_KEYBOARD_ID,
            kind="keyboard",
            label=ROBOT_GATEWAY_CONTROL_INPUT_BROWSER_KEYBOARD_LABEL,
            summary=ROBOT_GATEWAY_CONTROL_INPUT_BROWSER_KEYBOARD_SUMMARY,
        ),
        RobotGatewayControlInputDescriptor(
            id=ROBOT_GATEWAY_CONTROL_INPUT_BROWSER_JOYSTICK_ID,
            kind="joystick",
            label=ROBOT_GATEWAY_CONTROL_INPUT_BROWSER_JOYSTICK_LABEL,
            summary=ROBOT_GATEWAY_CONTROL_INPUT_BROWSER_JOYSTICK_SUMMARY,
        ),
    ]


class RobotGatewayCameraIntrinsics(BaseModel):
    width: int = Field(..., ge=1)
    height: int = Field(..., ge=1)
    fx: float = Field(..., gt=0.0)
    fy: float = Field(..., gt=0.0)
    ppx: float = Field(..., ge=0.0)
    ppy: float = Field(..., ge=0.0)


class RobotGatewayCameraCapabilities(BaseModel):
    color: bool = True
    depth: bool = True
    point_cloud: bool = Field(default=True, alias="pointCloud")


class RobotGatewayCameraPose(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    position: tuple[float, float, float]
    rotation_rpy_deg: tuple[float, float, float] = Field(alias="rotationRpyDeg")
    scale: float = Field(gt=0.0)
    world_frame: RobotGatewayPointCloudWorldFrame = Field(
        default="urdf_z_up",
        alias="worldFrame",
    )

    @field_validator("position", "rotation_rpy_deg")
    @classmethod
    def _validate_finite_tuple(
        cls, value: tuple[float, float, float]
    ) -> tuple[float, float, float]:
        if not all(math.isfinite(component) for component in value):
            raise ValueError("camera pose values must be finite.")
        return value


class RobotGatewayCameraStream(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: str = Field(default=ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID, min_length=1)
    label: str = Field(default=ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_LABEL, min_length=1)
    kind: RobotGatewayCameraKind = "rgbd"
    frame_id: str = Field(
        default=ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_FRAME_ID,
        min_length=1,
        alias="frameId",
    )
    coordinate_frame: RobotGatewayPointCloudCoordinateFrame = Field(
        default="robot_world",
        alias="coordinateFrame",
    )
    intrinsics: RobotGatewayCameraIntrinsics
    capabilities: RobotGatewayCameraCapabilities = Field(
        default_factory=RobotGatewayCameraCapabilities
    )
    color_stream_path: str | None = Field(default=None, alias="colorStreamPath")
    depth_stream_path: str | None = Field(default=None, alias="depthStreamPath")
    metadata_stream_path: str | None = Field(default=None, alias="metadataStreamPath")
    point_cloud_path: str | None = Field(default=None, alias="pointCloudPath")
    camera_pose: RobotGatewayCameraPose | None = Field(
        default=None,
        alias="cameraPose",
    )


class RobotGatewayPointCloudFrame(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    camera_id: str = Field(..., min_length=1, alias="cameraId")
    frame_id: str = Field(
        default=ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_FRAME_ID,
        min_length=1,
        alias="frameId",
    )
    coordinate_frame: RobotGatewayPointCloudCoordinateFrame = Field(
        default="robot_world",
        alias="coordinateFrame",
    )
    sequence: int = Field(default=0, ge=0)
    source_ts_ms: int = Field(default=0, ge=0, alias="sourceTsMs")
    intrinsics: RobotGatewayCameraIntrinsics
    points_xyz: list[
        tuple[
            float,
            float,
            float,
        ]
    ] = Field(
        default_factory=list,
        max_length=ROBOT_GATEWAY_POINT_CLOUD_MAX_POINTS,
        alias="pointsXyz",
    )
    colors_rgb: list[
        tuple[
            float,
            float,
            float,
        ]
    ] = Field(
        default_factory=list,
        max_length=ROBOT_GATEWAY_POINT_CLOUD_MAX_POINTS,
        alias="colorsRgb",
    )

    @field_validator("points_xyz")
    @classmethod
    def _validate_points(
        cls, value: list[tuple[float, float, float]]
    ) -> list[tuple[float, float, float]]:
        for point in value:
            for coordinate in point:
                if (
                    not math.isfinite(coordinate)
                    or coordinate < ROBOT_GATEWAY_POINT_CLOUD_MIN_COORD_M
                    or coordinate > ROBOT_GATEWAY_POINT_CLOUD_MAX_COORD_M
                ):
                    raise ValueError(
                        "point cloud coordinates must be finite and within gateway bounds."
                    )
        return value

    @field_validator("colors_rgb")
    @classmethod
    def _validate_colors(
        cls, value: list[tuple[float, float, float]]
    ) -> list[tuple[float, float, float]]:
        for color in value:
            for channel in color:
                if (
                    not math.isfinite(channel)
                    or channel < ROBOT_GATEWAY_POINT_CLOUD_MIN_COLOR
                    or channel > ROBOT_GATEWAY_POINT_CLOUD_MAX_COLOR
                ):
                    raise ValueError(
                        "point cloud color channels must be finite and normalized."
                    )
        return value


class RobotGatewayProfile(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: str = Field(default=ROBOT_GATEWAY_OPENARM_PROFILE_ID, min_length=1)
    label: str = Field(default="OpenArm dual-arm joint jog", min_length=1)
    summary: str = Field(
        default="OpenArm observe-first manipulator profile with bounded joint jog."
    )
    control_target_label: str = Field(
        default=ROBOT_GATEWAY_OPENARM_CONTROL_TARGET_LABEL,
        min_length=1,
        alias="controlTargetLabel",
    )
    control_target_side: RobotGatewayControlTargetSide | None = Field(
        default=None,
        alias="controlTargetSide",
    )
    transport: RobotGatewayTransport = "robot_gateway"
    robot_family: RobotGatewayProfileKind = Field(
        default="manipulator", alias="robotFamily"
    )
    robot_id: str = Field(
        default=ROBOT_GATEWAY_OPENARM_ROBOT_ID, min_length=1, alias="robotId"
    )
    adapter_id: str = Field(default="", alias="adapterId")
    hardware_device_key: str = Field(default="", alias="hardwareDeviceKey")
    hardware_device_keys: list[str] = Field(
        default_factory=list,
        alias="hardwareDeviceKeys",
    )
    teleoperation_mode: RobotGatewayTeleoperationMode = Field(
        default=ROBOT_GATEWAY_TELEOPERATION_MODE_SIMULATED,
        alias="teleoperationMode",
    )
    controlled_joint_names: list[str] = Field(
        default_factory=list, alias="controlledJointNames"
    )
    control_inputs: list[RobotGatewayControlInputDescriptor] = Field(
        default_factory=list,
        alias="controlInputs",
    )
    capabilities: RobotGatewayProfileCapabilities = Field(
        default_factory=RobotGatewayProfileCapabilities
    )
    topics: RobotGatewayProfileTopics = Field(default_factory=RobotGatewayProfileTopics)
    limits: RobotGatewayProfileLimits = Field(default_factory=RobotGatewayProfileLimits)
    joint_limits: dict[str, RobotGatewayJointLimit] = Field(
        default_factory=dict,
        alias="jointLimits",
    )


class RobotGatewayConnectionMode(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: str = Field(default="direct_local", min_length=1)
    label: str = Field(default="Direct local", min_length=1)
    summary: str = Field(default="Gateway is reachable from the local robot network.")
    max_operator_rtt_ms: float | None = Field(default=None, alias="maxOperatorRttMs")
    config_ref: str | None = Field(default=None, alias="configRef")


class RobotGatewayEnvConfigFile(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    path: str = Field(..., min_length=1)
    content: str = ""
    exists: bool = False


class RobotGatewayEnvConfigOpenResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    path: str = Field(..., min_length=1)
    exists: bool = False
    opened: bool = False
    message: str = ""


class RobotGatewayLeRobotCalibrationStartResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    started: bool = False
    command: list[str] = Field(default_factory=list)
    display_command: str = Field(default="", alias="displayCommand")
    message: str = ""


class RobotGatewayLeRobotDirectTeleopLeaderRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    port: str | None = None
    port_left: str | None = Field(default=None, alias="portLeft")
    port_right: str | None = Field(default=None, alias="portRight")
    calibration_category: str | None = Field(default=None, alias="calibrationCategory")
    calibration_profile: str | None = Field(default=None, alias="calibrationProfile")
    calibration_id: str | None = Field(default=None, alias="calibrationId")
    calibration_group: str | None = Field(default=None, alias="calibrationGroup")


class RobotGatewayLeRobotDirectTeleopStartRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    operator_id: str = Field(..., min_length=1, alias="operatorId")
    leader: RobotGatewayLeRobotDirectTeleopLeaderRequest
    fps: int = Field(
        default=ROBOT_GATEWAY_LEROBOT_DIRECT_TELEOP_DEFAULT_FPS,
        ge=ROBOT_GATEWAY_LEROBOT_DIRECT_TELEOP_MIN_FPS,
        le=ROBOT_GATEWAY_LEROBOT_DIRECT_TELEOP_MAX_FPS,
    )


class RobotGatewayLeRobotDirectTeleopStatus(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    state: RobotGatewayLeRobotDirectTeleopState = "idle"
    running: bool = False
    session_id: str | None = Field(default=None, alias="sessionId")
    fps: int = ROBOT_GATEWAY_LEROBOT_DIRECT_TELEOP_DEFAULT_FPS
    pid: int | None = Field(default=None, ge=0)
    command: list[str] = Field(default_factory=list)
    display_command: str = Field(default="", alias="displayCommand")
    leader_profile: str | None = Field(default=None, alias="leaderProfile")
    leader_id: str | None = Field(default=None, alias="leaderId")
    follower_robot_type: str | None = Field(default=None, alias="followerRobotType")
    started_at_ms: int | None = Field(default=None, ge=0, alias="startedAtMs")
    stopped_at_ms: int | None = Field(default=None, ge=0, alias="stoppedAtMs")
    return_code: int | None = Field(default=None, alias="returnCode")
    last_error: str | None = Field(default=None, alias="lastError")


class RobotGatewayEnvConfigUpdate(BaseModel):
    content: str = ""


class RobotGatewayControlTransportDescriptor(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    type: RobotGatewayControlTransport = "teleop_sidecar"
    manifest_path: str = Field(..., min_length=1, alias="manifestPath")
    stats_path: str = Field(..., min_length=1, alias="statsPath")
    webtransport_url: str = Field(..., min_length=1, alias="webtransportUrl")
    native_quic_address: str = Field(..., min_length=1, alias="nativeQuicAddress")
    native_quic_alpn: str = Field(..., min_length=1, alias="nativeQuicAlpn")
    sidecar_ready: bool = Field(default=False, alias="sidecarReady")
    requires_lease: bool = Field(default=True, alias="requiresLease")
    requires_teleop_capability: bool = Field(
        default=True, alias="requiresTeleopCapability"
    )
    teleop_capability_verify_path: str = Field(
        default=ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_VERIFY_PATH,
        min_length=1,
        alias="teleopCapabilityVerifyPath",
    )
    teleop_capability_required_role: Literal["teleop_operator"] = Field(
        default=ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_REQUIRED_ROLE,
        alias="teleopCapabilityRequiredRole",
    )
    teleop_capability_transport: Literal["moq"] = Field(
        default=ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_TRANSPORT,
        alias="teleopCapabilityTransport",
    )


class RobotGatewayControlDatagramAuthorization(BaseModel):
    collaboration_session_id: str = Field(..., min_length=1)
    teleop_capability_token: str = Field(..., min_length=1)


class RobotGatewayControlDatagramPacket(BaseModel):
    session_id: str = Field(..., min_length=1)
    peer_id: str = Field(..., min_length=1)
    role: RobotGatewayControlDatagramRole = "operator"
    sequence: int = Field(..., ge=0, le=ROBOT_GATEWAY_MAX_CONTROL_SEQUENCE)
    source_ts_ms: int = Field(..., ge=0, le=ROBOT_GATEWAY_MAX_SOURCE_TIMESTAMP_MS)
    monotonic_timestamp_ns: int = Field(..., ge=0)
    command_kind: RobotGatewayControlCommandKind
    ack_requested: bool = True
    authorization: RobotGatewayControlDatagramAuthorization | None = None
    payload: dict[str, object] = Field(default_factory=dict)

    def require_teleop_capability_session_id(self) -> str:
        if self.authorization is None:
            raise ValueError("Control datagram is missing teleop authorization.")
        return self.authorization.collaboration_session_id

    def build_teleop_capability_verify_payload(self) -> dict[str, str]:
        if self.authorization is None:
            raise ValueError("Control datagram is missing teleop authorization.")
        return {
            "capability_token": self.authorization.teleop_capability_token,
            "required_role": ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_REQUIRED_ROLE,
            "transport": ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_TRANSPORT,
        }


class RobotGatewayControlDatagramAck(BaseModel):
    session_id: str = Field(..., min_length=1)
    peer_id: str = Field(..., min_length=1)
    sequence: int = Field(..., ge=0, le=ROBOT_GATEWAY_MAX_CONTROL_SEQUENCE)
    server_sequence: int = Field(..., ge=0)
    accepted: bool
    reason: str = ""
    server_received_unix_ms: int = Field(..., ge=0)


class RobotGatewayManifest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    contract_version: str = Field(
        default=ROBOT_GATEWAY_CONTRACT_VERSION, alias="contractVersion"
    )
    provider_id: str = Field(
        default=ROBOT_GATEWAY_DEFAULT_PROVIDER_ID, alias="providerId"
    )
    provider_display_name: str = Field(
        default=ROBOT_GATEWAY_DEFAULT_PROVIDER_DISPLAY_NAME,
        alias="providerDisplayName",
    )
    connection_modes: list[RobotGatewayConnectionMode] = Field(
        default_factory=lambda: [RobotGatewayConnectionMode()],
        alias="connectionModes",
    )
    capabilities: RobotGatewayCapabilitySet = Field(
        default_factory=RobotGatewayCapabilitySet
    )
    profiles: list[RobotGatewayProfile] = Field(default_factory=list)
    camera_streams: list[RobotGatewayCameraStream] = Field(
        default_factory=list, alias="cameraStreams"
    )
    live_transport: LiveTransportDescriptor | None = Field(
        default=None, alias="liveTransport"
    )
    control_transport: RobotGatewayControlTransportDescriptor | None = Field(
        default=None, alias="controlTransport"
    )


class RobotGatewaySessionSnapshot(BaseModel):
    state: RobotGatewayConnectionState = "active"
    current_session_id: str | None = ROBOT_GATEWAY_DEFAULT_SESSION_ID
    robot_id: str | None = ROBOT_GATEWAY_OPENARM_ROBOT_ID
    model_robot_id: str | None = ROBOT_GATEWAY_OPENARM_ROBOT_ID
    model_robot_aliases: list[str] = Field(default_factory=list)
    mode: RobotGatewayControlMode = "safe_hold"
    runtime_mode: RobotGatewayRuntimeMode = "observe"
    adapter_id: str = ""
    teleoperation_mode: RobotGatewayTeleoperationMode = (
        ROBOT_GATEWAY_TELEOPERATION_MODE_SIMULATED
    )
    active_profile_id: str = ROBOT_GATEWAY_OPENARM_PROFILE_ID
    control_lease_owner: str | None = None


class RobotGatewayStatsSnapshot(BaseModel):
    operator_rtt_ms: float | None = ROBOT_GATEWAY_DEFAULT_OPERATOR_RTT_MS
    estimated_end_to_end_latency_ms: float | None = None
    robot_state: dict[str, object] = Field(
        default_factory=lambda: {
            "mode": "safe_hold",
            "connection_state": "active",
            "estop": False,
            "control_rtt_ms": ROBOT_GATEWAY_DEFAULT_CONTROL_RTT_MS,
        }
    )


class RobotGatewayHardwareMotionSafetyStatus(BaseModel):
    motion_ready: bool = False
    authoritative_joint_feedback_ready: bool = False
    joint_rotation_calibration_ready: bool = False
    joint_rotation_calibration_required: bool = False
    joint_rotation_calibration_id: str | None = None
    self_collision_preflight_ready: bool = False
    gripper_motion_enabled: bool = False
    last_reject_reason: str | None = None


class RobotGatewayJointTelemetry(BaseModel):
    position_rad: float
    velocity_rad_per_sec: float | None = None
    torque_nm: float | None = None
    temp_mos_c: float | None = None
    temp_rotor_c: float | None = None
    fault_code: int | None = None

    @field_validator(
        "position_rad",
        "velocity_rad_per_sec",
        "torque_nm",
        "temp_mos_c",
        "temp_rotor_c",
    )
    @classmethod
    def _validate_finite_telemetry_value(
        cls,
        value: float | None,
    ) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("joint telemetry values must be finite.")
        return value


class RobotGatewayStateFrame(BaseModel):
    robot_id: str = Field(default=ROBOT_GATEWAY_OPENARM_ROBOT_ID, min_length=1)
    adapter_id: str = ""
    profile_id: str = Field(default=ROBOT_GATEWAY_OPENARM_PROFILE_ID, min_length=1)
    sequence: int = Field(default=0, ge=0)
    source_ts_ms: int = Field(default=0, ge=0)
    mode: RobotGatewayControlMode = "safe_hold"
    estop: bool = False
    heartbeat_ok: bool = True
    joint_positions_rad: dict[str, float] = Field(default_factory=dict)
    gripper_positions_rad: dict[str, float] = Field(default_factory=dict)
    joint_telemetry: dict[str, RobotGatewayJointTelemetry] = Field(default_factory=dict)
    hardware_motion_safety: RobotGatewayHardwareMotionSafetyStatus = Field(
        default_factory=RobotGatewayHardwareMotionSafetyStatus
    )

    @field_validator("joint_positions_rad", "gripper_positions_rad")
    @classmethod
    def _validate_finite_joint_maps(cls, value: dict[str, float]) -> dict[str, float]:
        for joint_name, joint_value in value.items():
            if not joint_name.strip():
                raise ValueError("joint name must be non-empty.")
            if not math.isfinite(joint_value):
                raise ValueError(f"joint value for {joint_name!r} must be finite.")
        return value

    @field_validator("joint_telemetry")
    @classmethod
    def _validate_joint_telemetry_map(
        cls,
        value: dict[str, RobotGatewayJointTelemetry],
    ) -> dict[str, RobotGatewayJointTelemetry]:
        for joint_name in value:
            if not joint_name.strip():
                raise ValueError("joint telemetry name must be non-empty.")
        return value


class RobotGatewayLeaseRequest(BaseModel):
    operator_id: str = Field(..., min_length=1)
    profile_id: str = Field(default=ROBOT_GATEWAY_OPENARM_PROFILE_ID, min_length=1)


class RobotGatewayLeaseResponse(BaseModel):
    accepted: bool
    session_id: str = ROBOT_GATEWAY_DEFAULT_SESSION_ID
    operator_id: str | None = None
    profile_id: str = ROBOT_GATEWAY_OPENARM_PROFILE_ID
    reason: str = ""


class RobotGatewayJointJogRequest(BaseModel):
    command_kind: Literal["joint_jog"] = "joint_jog"
    joint_name: str = Field(..., min_length=1)
    operator_id: str | None = Field(default=None, min_length=1)
    current_position_rad: float | None = Field(
        default=None,
        ge=-ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_POSITION_LIMIT_RAD,
        le=ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_POSITION_LIMIT_RAD,
    )
    delta_rad: float = Field(
        ...,
        ge=ROBOT_GATEWAY_MIN_JOINT_JOG_DELTA_RAD,
        le=ROBOT_GATEWAY_MAX_JOINT_JOG_DELTA_RAD,
    )
    sequence: int = Field(default=0, ge=0, le=ROBOT_GATEWAY_MAX_CONTROL_SEQUENCE)
    source_ts_ms: int = Field(default=0, ge=0, le=ROBOT_GATEWAY_MAX_SOURCE_TIMESTAMP_MS)
    ack_requested: bool = True

    @field_validator("delta_rad")
    @classmethod
    def _validate_finite_delta(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("delta_rad must be finite.")
        return value

    @field_validator("current_position_rad")
    @classmethod
    def _validate_finite_current_position(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("current_position_rad must be finite.")
        return value


class RobotGatewayOpenArmCalibrationJogRequest(BaseModel):
    command_kind: Literal["openarm_calibration_jog"] = "openarm_calibration_jog"
    joint_name: str = Field(..., min_length=1)
    operator_id: str | None = Field(default=None, min_length=1)
    delta_rad: float = Field(
        ...,
        ge=ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_MIN_DELTA_RAD,
        le=ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_MAX_DELTA_RAD,
    )
    sequence: int = Field(default=0, ge=0, le=ROBOT_GATEWAY_MAX_CONTROL_SEQUENCE)
    source_ts_ms: int = Field(default=0, ge=0, le=ROBOT_GATEWAY_MAX_SOURCE_TIMESTAMP_MS)
    ack_requested: bool = True

    @field_validator("delta_rad")
    @classmethod
    def _validate_finite_delta(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("delta_rad must be finite.")
        return value


class RobotGatewayOpenArmCanDryRunMitParam(BaseModel):
    kp: float = Field(
        ...,
        ge=ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_KP_MIN,
        le=ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_KP_MAX,
    )
    kd: float = Field(
        ...,
        ge=ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_KD_MIN,
        le=ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_KD_MAX,
    )
    q: float = Field(
        ...,
        ge=-ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_POSITION_LIMIT_RAD,
        le=ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_POSITION_LIMIT_RAD,
    )
    dq: float = Field(
        ...,
        ge=-ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_VELOCITY_LIMIT_RAD_PER_SEC,
        le=ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_VELOCITY_LIMIT_RAD_PER_SEC,
    )
    tau: float = Field(
        ...,
        ge=-ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_TORQUE_LIMIT_NM,
        le=ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_TORQUE_LIMIT_NM,
    )

    @field_validator("kp", "kd", "q", "dq", "tau")
    @classmethod
    def _validate_finite_mit_param(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("MIT parameter must be finite.")
        return value


class RobotGatewayOpenArmCanDryRunFrame(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    joint_name: str = Field(..., min_length=1, alias="jointName")
    arm_side: str = Field(..., min_length=1, alias="armSide")
    logical_bus: str = Field(..., min_length=1, alias="logicalBus")
    motor_type: str = Field(..., min_length=1, alias="motorType")
    protocol: Literal["damiao_mit_control"] = ROBOT_GATEWAY_OPENARM_CAN_PROTOCOL
    send_can_id: int = Field(..., ge=0, alias="sendCanId")
    recv_can_id: int = Field(..., ge=0, alias="recvCanId")
    send_can_id_hex: str = Field(..., min_length=1, alias="sendCanIdHex")
    recv_can_id_hex: str = Field(..., min_length=1, alias="recvCanIdHex")
    dlc: int = Field(default=ROBOT_GATEWAY_OPENARM_CAN_DLC_BYTES, ge=1)
    data_bytes: list[int] = Field(
        ...,
        min_length=ROBOT_GATEWAY_OPENARM_CAN_DLC_BYTES,
        alias="dataBytes",
    )
    data_hex: str = Field(..., min_length=1, alias="dataHex")
    mit_param: RobotGatewayOpenArmCanDryRunMitParam = Field(..., alias="mitParam")
    transmission_state: Literal["dry_run_not_sent"] = Field(
        default=ROBOT_GATEWAY_OPENARM_CAN_DRY_RUN_TRANSMISSION_STATE,
        alias="transmissionState",
    )

    @field_validator("data_bytes")
    @classmethod
    def _validate_data_bytes(cls, value: list[int]) -> list[int]:
        if len(value) != ROBOT_GATEWAY_OPENARM_CAN_DLC_BYTES:
            raise ValueError(
                "OpenArm CAN dry-run frame must contain exactly one 8-byte payload."
            )
        for byte in value:
            if byte < 0 or byte > ROBOT_GATEWAY_OPENARM_CAN_BYTE_MAX:
                raise ValueError(
                    "OpenArm CAN payload bytes must be unsigned 8-bit integers."
                )
        return value


class RobotGatewayOpenArmCanDryRunPlan(BaseModel):
    ok: bool = True
    accepted: bool
    reason: str = ""
    sequence: int = 0
    session_id: str = ROBOT_GATEWAY_DEFAULT_SESSION_ID
    applied_joint_name: str | None = None
    applied_delta_rad: float | None = None
    frame: RobotGatewayOpenArmCanDryRunFrame | None = None


class RobotGatewayTwistRequest(BaseModel):
    command_kind: Literal["twist", "stop"] = "twist"
    x: float = 0.0
    y: float = 0.0
    omega: float = 0.0
    sequence: int = Field(default=0, ge=0, le=ROBOT_GATEWAY_MAX_CONTROL_SEQUENCE)
    source_ts_ms: int = Field(default=0, ge=0, le=ROBOT_GATEWAY_MAX_SOURCE_TIMESTAMP_MS)
    ack_requested: bool = True


class RobotGatewayControlAck(BaseModel):
    ok: bool = True
    accepted: bool
    reason: str = ""
    sequence: int = 0
    session_id: str = ROBOT_GATEWAY_DEFAULT_SESSION_ID
    applied_joint_name: str | None = None
    applied_delta_rad: float | None = None
