from __future__ import annotations

import asyncio
import json
import math
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from backend.tests.asgi_test_client import AsgiTestClient

from backend.app import create_app
from backend.api import robot_gateway as robot_gateway_api
from backend.core.simulator_security import SIMULATOR_TOKEN_HEADER
from backend.models.collaboration import (
    CollaborationAccessUpdateRequest,
    CollaborationCapabilityIssueRequest,
    CollaborationSessionCreateRequest,
)
from backend.models.robot_gateway import (
    RobotGatewayControlDatagramPacket,
    RobotGatewayControlTransportDescriptor,
    RobotGatewayJointJogRequest,
    RobotGatewayLeRobotCalibrationStartResult,
    RobotGatewayLeaseRequest,
    RobotGatewayOpenArmCalibrationJogRequest,
    RobotGatewayProfile,
    RobotGatewayTwistRequest,
)
from backend.robot_gateway.adapters import (
    FakeOpenArmAdapter,
    LeRobotAdapter,
    NativeOpenArmAdapter,
    RobotGatewayAdapterConfig,
    build_robot_gateway_adapter,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_CONTROL_INPUT_BROWSER_JOYSTICK_ID,
    ROBOT_GATEWAY_CONTROL_INPUT_BROWSER_KEYBOARD_ID,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_MAX_AGE_MS,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_MAX_FUTURE_SKEW_MS,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_FUTURE_TIMESTAMP_REASON,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_INVALID_PAYLOAD_REASON_PREFIX,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_REPLAYED_SEQUENCE_REASON,
    ROBOT_GATEWAY_CONTROL_DATAGRAM_STALE_REASON,
    ROBOT_GATEWAY_COLLABORATION_SESSION_HEADER,
    ROBOT_GATEWAY_COLLABORATION_TELEOP_CAPABILITY_HEADER,
    ROBOT_GATEWAY_CONTROL_AUTH_REQUIRED_DETAIL,
    ROBOT_GATEWAY_CONTROL_LEASE_OWNER_MISMATCH_REASON,
    ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_TRANSPORT,
    ROBOT_GATEWAY_DEV_PROXY_CLIENT_HOST_HEADER,
    ROBOT_GATEWAY_DEFAULT_MAX_JOINT_JOG_DELTA_RAD,
    ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES,
    ROBOT_GATEWAY_DEFAULT_SESSION_ID,
    ROBOT_GATEWAY_ENV_FILE_ENV,
    ROBOT_GATEWAY_ENV_SELECTOR_ENV,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_HEIGHT,
    ROBOT_GATEWAY_FAKE_POINT_CLOUD_WIDTH,
    ROBOT_GATEWAY_JOINT_JOG_CURRENT_POSITION_REQUIRED_REASON,
    ROBOT_GATEWAY_JOINT_JOG_DELTA_LIMIT_REASON,
    ROBOT_GATEWAY_JOINT_JOG_GRIPPER_COLLISION_MAPPING_REQUIRED_REASON,
    ROBOT_GATEWAY_JOINT_JOG_VELOCITY_LIMIT_REASON,
    ROBOT_GATEWAY_JOINT_JOG_POSITION_LIMIT_REASON,
    ROBOT_GATEWAY_JOINT_JOG_SELF_COLLISION_LIMIT_REASON,
    ROBOT_GATEWAY_JOINT_JOG_SELF_COLLISION_REQUIRED_REASON,
    ROBOT_GATEWAY_JOINT_NAMES_ENV,
    ROBOT_GATEWAY_JOINT_NAMES_SEPARATOR,
    ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
    ROBOT_GATEWAY_LEROBOT_CALIBRATION_REQUIRED_REASON,
    ROBOT_GATEWAY_LEROBOT_CALIBRATION_DIR_ENV,
    ROBOT_GATEWAY_LEROBOT_HARDWARE_JOINT_NAMES_ENV,
    ROBOT_GATEWAY_LEROBOT_ID_ENV,
    ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE,
    ROBOT_GATEWAY_LEROBOT_PORT_ENV,
    ROBOT_GATEWAY_LEROBOT_ROBOT_TYPE_ENV,
    ROBOT_GATEWAY_MODEL_ROBOT_ALIASES_ENV,
    ROBOT_GATEWAY_MODEL_ROBOT_ID_ENV,
    ROBOT_GATEWAY_MOQ_TRACK_CAMERA_POINT_CLOUD_SUFFIX,
    ROBOT_GATEWAY_MOQ_TRACK_CAMERA_VIDEO_SUFFIX,
    ROBOT_GATEWAY_MOQ_RELAY_URL_ENV,
    ROBOT_GATEWAY_MOQ_TRACK_JOINT_TELEMETRY,
    ROBOT_GATEWAY_MOQ_TRACK_ROBOT_STATE,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_DEFAULT_DQ,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_DEFAULT_KD,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_DEFAULT_KP,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_DEFAULT_TAU,
    ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_MOTOR_LIMITS,
    ROBOT_GATEWAY_OPENARM_CAN_DLC_BYTES,
    ROBOT_GATEWAY_OPENARM_CAN_DRY_RUN_TRANSMISSION_STATE,
    ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
    ROBOT_GATEWAY_OPENARM_CAN_ENABLE_COMMAND,
    ROBOT_GATEWAY_OPENARM_CAN_HEX_WIDTH,
    ROBOT_GATEWAY_OPENARM_CAN_HEX_PREFIX,
    ROBOT_GATEWAY_OPENARM_CAN_HIGH_BYTE_SHIFT,
    ROBOT_GATEWAY_OPENARM_CAN_JOINT_SUFFIXES,
    ROBOT_GATEWAY_OPENARM_CAN_LEFT_JOINT_PREFIX,
    ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_BITS,
    ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_PACK_SHIFT,
    ROBOT_GATEWAY_OPENARM_CAN_MIT_POSITION_BITS,
    ROBOT_GATEWAY_OPENARM_CAN_MOTOR_TYPES,
    ROBOT_GATEWAY_OPENARM_CAN_NIBBLE_MASK,
    ROBOT_GATEWAY_OPENARM_CAN_PARAM_ID,
    ROBOT_GATEWAY_OPENARM_CAN_REFRESH_COMMAND,
    ROBOT_GATEWAY_OPENARM_CAN_RIGHT_ARM_SIDE,
    ROBOT_GATEWAY_OPENARM_CAN_RIGHT_JOINT_PREFIX,
    ROBOT_GATEWAY_OPENARM_CAN_RIGHT_LOGICAL_BUS,
    ROBOT_GATEWAY_OPENARM_CAN_PROTOCOL,
    ROBOT_GATEWAY_OPENARM_CAN_RECV_IDS,
    ROBOT_GATEWAY_OPENARM_CAN_SEND_IDS,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_DELTA_LIMIT_REASON,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_NO_MOTION_REASON,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_REASON,
    ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_UNCOMMANDED_MOTION_REASON,
    ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID,
    ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_POINT_SCALE,
    ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_POSITION_XYZ_M,
    ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ROTATION_RPY_DEG,
    ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_WORLD_FRAME,
    ROBOT_GATEWAY_OPENARM_NATIVE_ADAPTER_ID,
    ROBOT_GATEWAY_OPENARM_ROBOT_ID,
    ROBOT_GATEWAY_OPENARM_ROS2_ADAPTER_ID,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_FINGER_NAME_TOKEN,
    ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT,
    ROBOT_GATEWAY_OPENARM_MINI_MOTOR_IDS,
    ROBOT_GATEWAY_OPENARM_MINI_MOTOR_MODEL,
    ROBOT_GATEWAY_ROBOT_ID_ENV,
    ROBOT_GATEWAY_TELEOPERATION_MODE_REAL_HARDWARE,
    ROBOT_GATEWAY_TELEOPERATION_MODE_SIMULATED,
)
from backend.robot_gateway.profile_targets import build_robot_gateway_manifest_profiles
from backend.services.collaboration import collaboration_service
from backend.services.collaboration_params import COLLABORATION_SESSION_TOKEN_HEADER
from backend.robot_gateway.control_datagram_verifier import (
    RobotGatewayHttpTeleopCapabilityVerifier,
    build_teleop_capability_verify_url,
    verify_robot_gateway_control_datagram,
)
from backend.robot_gateway.control_datagram_dispatcher import (
    decode_robot_gateway_control_datagram,
    dispatch_robot_gateway_control_datagram,
    dispatch_robot_gateway_control_datagram_frame,
    encode_robot_gateway_control_datagram_ack,
)
from backend.robot_gateway import config_file as robot_gateway_config_file
from backend.robot_gateway import openarm_leader_state
from backend.robot_gateway import lerobot_calibration, lerobot_calibration_catalog
from backend.robot_gateway.control_transport import build_robot_gateway_control_transport
from backend.robot_gateway.lerobot_calibration import (
    build_lerobot_calibration_command,
    build_lerobot_leader_calibration_command,
    build_lerobot_calibration_terminal_script,
    start_lerobot_calibration,
)
from backend.robot_gateway.lerobot_calibration_catalog import (
    RobotGatewayLeRobotCalibrationFileSyncRequest,
    RobotGatewayLeRobotCalibrationSource,
    RobotGatewayLeRobotCalibrationStartRequest,
    list_lerobot_calibration_catalog,
)
from backend.robot_gateway.live_transport import validate_robot_gateway_live_relay_url
from backend.robot_gateway.openarm_can_transport import (
    OpenArmCanBridge,
    OpenArmCanBridgeConfig,
    OpenArmCanTransportError,
)
from backend.robot_gateway.openarm_can_state import OpenArmCanJointState
from backend.robot_gateway.openarm_joint_calibration import (
    OpenArmJointRotationCalibration,
    OpenArmJointRotationCalibrationEntry,
    build_identity_openarm_joint_rotation_calibration,
)
from backend.robot_gateway.runtime import RobotGatewayRuntime, RobotGatewayRuntimeConfig
from backend.robot_gateway.runtime import build_robot_gateway_runtime_from_env
from backend.robot_gateway.rest_authorization import require_robot_gateway_control_access


TEST_OPERATOR_ID = "operator-a"
TEST_OTHER_OPERATOR_ID = "operator-b"
TEST_JOINT_DELTA_RAD = 0.01
TEST_COMMAND_SEQUENCE = 7
TEST_FIRST_JOINT_NAME = ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES[0]
TEST_RIGHT_CAN_JOINT_NAME = "openarm_right_joint3"
TEST_RIGHT_CAN_MOTOR_INDEX = ROBOT_GATEWAY_OPENARM_CAN_JOINT_SUFFIXES.index("joint3")
TEST_RIGHT_CAN_JOINT_DELTA_RAD = 0.02
TEST_SECOND_RIGHT_CAN_JOINT_DELTA_RAD = 0.01
TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD = 0.42
TEST_CURRENT_RIGHT_CAN_JOINT_VELOCITY_RAD_PER_SEC = 1.25
TEST_CURRENT_RIGHT_CAN_JOINT_TORQUE_NM = -2.5
TEST_CURRENT_RIGHT_CAN_JOINT_TEMP_MOS_C = 37
TEST_CURRENT_RIGHT_CAN_JOINT_TEMP_ROTOR_C = 39
TEST_SPOOFED_RIGHT_CAN_JOINT_POSITION_RAD = 1.20
TEST_AUTHORITATIVE_LEFT_CAN_JOINT_POSITION_RAD = 0.11
TEST_UNSAFE_RIGHT_CAN_JOINT_POSITION_RAD = 1.30
TEST_OVERSIZED_JOINT_DELTA_RAD = (
    ROBOT_GATEWAY_DEFAULT_MAX_JOINT_JOG_DELTA_RAD + TEST_JOINT_DELTA_RAD
)
TEST_OPENARM_CAN_RECV_ID_OFFSET = (
    ROBOT_GATEWAY_OPENARM_CAN_RECV_IDS[0] - ROBOT_GATEWAY_OPENARM_CAN_SEND_IDS[0]
)
TEST_MONOTONIC_SECONDS = 10.0
TEST_COLLABORATION_SESSION_ID = "collab-session-a"
TEST_TELEOP_CAPABILITY_TOKEN = "teleop-capability-a"
TEST_MONOTONIC_TIMESTAMP_NS = 42_000_000
TEST_SERVER_RECEIVED_UNIX_MS = 4_200_000
TEST_TIMESTAMP_BOUNDARY_OFFSET_MS = 1
TEST_TWIST_PAYLOAD = {"x": 0.1, "y": 0.0, "omega": 0.0}
TEST_BACKEND_BASE_URL = "http://127.0.0.1:8000"
TEST_PRIVATE_MOQ_RELAY_URL = "https://robot-relay.internal/live"
TEST_PUBLIC_MOQ_RELAY_URL = "https://cdn.1ms.ai"
TEST_SCHEMELESS_PUBLIC_MOQ_RELAY_URL = "cdn.moq.dev/anon"
TEST_PUBLIC_ANON_MOQ_RELAY_URL = "https://robot-relay.internal/anon"
TEST_REMOTE_BROWSER_HOST = "198.51.100.42"
TEST_SIMULATOR_TOKEN = "sim-token"
TEST_LEROBOT_SO_STYLE_JOINT_NAMES = (
    "shoulder_pan",
    "shoulder_lift",
    "elbow_flex",
    "wrist_flex",
    "wrist_roll",
    "gripper",
)
TEST_LEROBOT_SO_STYLE_MOTOR_IDS = (1, 2, 3, 4, 5, 6)
TEST_LEROBOT_LEKIWI_MODEL_JOINT_NAMES = (
    "arm_shoulder_pan",
    "arm_shoulder_lift",
    "arm_elbow_flex",
    "arm_wrist_flex",
    "arm_wrist_roll",
    "arm_gripper",
)


def _run_api(coro):
    return asyncio.run(coro)


class FakeCapabilityVerifyResponse:
    def __init__(self, body: bytes) -> None:
        self._body = body

    def __enter__(self) -> "FakeCapabilityVerifyResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self) -> bytes:
        return self._body


class FakeOpenArmCanBridge:
    def __init__(self, error: OpenArmCanTransportError | None = None) -> None:
        self.error = error
        self.enabled_joints = []
        self.sent_frames = []

    def enable_joint(self, joint_name) -> None:
        if self.error is not None:
            raise self.error
        self.enabled_joints.append(joint_name)

    def send_frame(self, frame) -> None:
        if self.error is not None:
            raise self.error
        self.sent_frames.append(frame)


class FakeJointPositionReader:
    def __init__(
        self,
        positions_rad: dict[str, float] | None = None,
        readings_rad: list[dict[str, float]] | None = None,
        error: OpenArmCanTransportError | None = None,
    ) -> None:
        self.positions_rad = positions_rad or {}
        self.readings_rad = list(readings_rad or [])
        self.error = error
        self.read_joint_names = []

    def __call__(self, joint_names: tuple[str, ...]) -> dict[str, float]:
        self.read_joint_names.append(joint_names)
        if self.error is not None:
            raise self.error
        positions_rad = (
            self.readings_rad.pop(0) if self.readings_rad else self.positions_rad
        )
        return {
            joint_name: positions_rad.get(joint_name, 0.0)
            for joint_name in joint_names
        }


class FakePythonCanMessage:
    def __init__(self, **kwargs) -> None:
        self.kwargs = kwargs
        self.arbitration_id = kwargs.get("arbitration_id")
        self.data = kwargs.get("data", b"")


class FakePythonCanBus:
    def __init__(
        self,
        *,
        state_positions_by_recv_id: dict[int, float] | None = None,
        state_telemetry_by_recv_id: dict[int, dict[str, object]] | None = None,
        state_raw_data_by_recv_id: dict[int, bytes] | None = None,
        **kwargs,
    ) -> None:
        self.kwargs = kwargs
        self.sent_messages = []
        self.received_messages = []
        self.state_positions_by_recv_id = state_positions_by_recv_id or {}
        self.state_telemetry_by_recv_id = state_telemetry_by_recv_id or {}
        self.state_raw_data_by_recv_id = state_raw_data_by_recv_id or {}

    def send(self, message) -> None:
        self.sent_messages.append(message)
        data = message.kwargs.get("data", b"")
        if (
            message.kwargs.get("arbitration_id") == ROBOT_GATEWAY_OPENARM_CAN_PARAM_ID
            and len(data) > 2
            and data[2] == ROBOT_GATEWAY_OPENARM_CAN_REFRESH_COMMAND
        ):
            send_can_id = data[0] | (
                data[1] << ROBOT_GATEWAY_OPENARM_CAN_HIGH_BYTE_SHIFT
            )
            recv_can_id = send_can_id + TEST_OPENARM_CAN_RECV_ID_OFFSET
            raw_data = self.state_raw_data_by_recv_id.get(recv_can_id)
            if raw_data is None:
                telemetry = self.state_telemetry_by_recv_id.get(recv_can_id)
                if telemetry is None:
                    telemetry = {
                        "position_rad": self.state_positions_by_recv_id.get(
                            recv_can_id,
                            0.0,
                        )
                    }
                raw_data = _build_damiao_state_response_bytes(
                    **telemetry,
                )
            self.received_messages.append(
                FakePythonCanMessage(
                    arbitration_id=recv_can_id,
                    data=raw_data,
                )
            )

    def recv(self, *, timeout=None):
        if self.received_messages:
            return self.received_messages.pop(0)
        return None


class FakePythonCanModule:
    Message = FakePythonCanMessage

    def __init__(
        self,
        *,
        state_positions_by_recv_id: dict[int, float] | None = None,
        state_telemetry_by_recv_id: dict[int, dict[str, object]] | None = None,
        state_raw_data_by_recv_id: dict[int, bytes] | None = None,
    ) -> None:
        self.created_buses = []
        self.state_positions_by_recv_id = state_positions_by_recv_id or {}
        self.state_telemetry_by_recv_id = state_telemetry_by_recv_id or {}
        self.state_raw_data_by_recv_id = state_raw_data_by_recv_id or {}

    def Bus(self, **kwargs):
        bus = FakePythonCanBus(
            state_positions_by_recv_id=self.state_positions_by_recv_id,
            state_telemetry_by_recv_id=self.state_telemetry_by_recv_id,
            state_raw_data_by_recv_id=self.state_raw_data_by_recv_id,
            **kwargs,
        )
        self.created_buses.append(bus)
        return bus


def _native_openarm_adapter_allowing_unvalidated_self_collision(
    can_bridge: FakeOpenArmCanBridge,
    *,
    safety_preflight=None,
    joint_position_reader: FakeJointPositionReader | None = None,
    joint_rotation_calibration=None,
) -> NativeOpenArmAdapter:
    return NativeOpenArmAdapter(
        config=RobotGatewayAdapterConfig(
            adapter_kind="openarm_native",
            allow_unvalidated_self_collision=True,
        ),
        can_bridge=can_bridge,
        safety_preflight=safety_preflight,
        joint_position_reader=(
            joint_position_reader
            or FakeJointPositionReader(
                {TEST_RIGHT_CAN_JOINT_NAME: TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD}
            )
        ),
        joint_rotation_calibration=(
            joint_rotation_calibration
            or build_identity_openarm_joint_rotation_calibration(
                ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES
            )
        ),
    )


def _build_damiao_state_response_bytes(
    position_rad: float,
    velocity_rad_per_sec: float = 0.0,
    torque_nm: float = 0.0,
    temp_mos_c: float = 0.0,
    temp_rotor_c: float = 0.0,
    motor_type: str = ROBOT_GATEWAY_OPENARM_CAN_MOTOR_TYPES[
        TEST_RIGHT_CAN_MOTOR_INDEX
    ],
) -> bytes:
    position_limit_rad, velocity_limit_rad_per_sec, torque_limit_nm = (
        ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_MOTOR_LIMITS[motor_type]
    )
    position_uint = _float_to_damiao_uint(
        position_rad,
        -position_limit_rad,
        position_limit_rad,
        ROBOT_GATEWAY_OPENARM_CAN_MIT_POSITION_BITS,
    )
    velocity_uint = _float_to_damiao_uint(
        velocity_rad_per_sec,
        -velocity_limit_rad_per_sec,
        velocity_limit_rad_per_sec,
        ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_BITS,
    )
    torque_uint = _float_to_damiao_uint(
        torque_nm,
        -torque_limit_nm,
        torque_limit_nm,
        ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_BITS,
    )
    return bytes(
        [
            0,
            (position_uint >> ROBOT_GATEWAY_OPENARM_CAN_HIGH_BYTE_SHIFT)
            & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
            position_uint & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
            (velocity_uint >> ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_PACK_SHIFT)
            & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
            (
                (velocity_uint & ROBOT_GATEWAY_OPENARM_CAN_NIBBLE_MASK)
                << ROBOT_GATEWAY_OPENARM_CAN_MIT_FIELD_PACK_SHIFT
            )
            | (
                (torque_uint >> ROBOT_GATEWAY_OPENARM_CAN_HIGH_BYTE_SHIFT)
                & ROBOT_GATEWAY_OPENARM_CAN_NIBBLE_MASK
            ),
            torque_uint & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
            int(temp_mos_c) & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
            int(temp_rotor_c) & ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK,
        ]
    )


def _float_to_damiao_uint(
    value: float,
    minimum: float,
    maximum: float,
    bits: int,
) -> int:
    normalized_value = (value - minimum) / (maximum - minimum)
    return int(normalized_value * ((1 << bits) - 1))


@pytest.fixture(autouse=True)
def reset_robot_gateway_collaboration_sessions() -> None:
    collaboration_service._sessions.clear()
    yield
    collaboration_service._sessions.clear()


def _create_robot_gateway_collaboration_session():
    return collaboration_service.create_session(
        CollaborationSessionCreateRequest(label="robot gateway auth"),
    )


def _robot_gateway_authorization_request(headers: dict[str, str] | None = None):
    return SimpleNamespace(
        client=SimpleNamespace(host="testclient"),
        headers=headers or {},
    )


def _build_control_runtime_with_lease() -> RobotGatewayRuntime:
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=FakeOpenArmAdapter(),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))
    return runtime


def _build_ready_control_transport_descriptor() -> RobotGatewayControlTransportDescriptor:
    return build_robot_gateway_control_transport().model_copy(update={"sidecar_ready": True})


def _build_control_datagram_packet(
    *,
    command_kind: str = "joint_jog",
    peer_id: str = TEST_OPERATOR_ID,
    role: str = "operator",
    session_id: str = ROBOT_GATEWAY_DEFAULT_SESSION_ID,
    sequence: int = TEST_COMMAND_SEQUENCE,
    source_ts_ms: int = TEST_SERVER_RECEIVED_UNIX_MS,
    with_authorization: bool = True,
    payload: dict[str, object] | None = None,
) -> RobotGatewayControlDatagramPacket:
    return RobotGatewayControlDatagramPacket(
        session_id=session_id,
        peer_id=peer_id,
        role=role,
        sequence=sequence,
        source_ts_ms=source_ts_ms,
        monotonic_timestamp_ns=TEST_MONOTONIC_TIMESTAMP_NS,
        command_kind=command_kind,
        authorization={
            "collaboration_session_id": TEST_COLLABORATION_SESSION_ID,
            "teleop_capability_token": TEST_TELEOP_CAPABILITY_TOKEN,
        }
        if with_authorization
        else None,
        payload=payload
        if payload is not None
        else {
            "joint_name": TEST_FIRST_JOINT_NAME,
            "delta_rad": TEST_JOINT_DELTA_RAD,
        },
    )


class _FakeSO100Robot:
    def __init__(self) -> None:
        self.calibration = {"shoulder_pan": object()}
        self.calibration_fpath = "/tmp/fake-so100-calibration.json"
        self.calibrated = True
        self.is_connected = False
        self.positions = {
            "shoulder_pan.pos": 10.0,
            "shoulder_lift.pos": 0.0,
            "elbow_flex.pos": 0.0,
            "wrist_flex.pos": 0.0,
            "wrist_roll.pos": 0.0,
            "gripper.pos": 50.0,
        }
        self.actions: list[dict[str, float]] = []
        self.connect_calibrate_args: list[bool] = []
        self.observation_error: Exception | None = None
        self.loaded_calibration_paths: list[str] = []

    @property
    def is_calibrated(self) -> bool:
        return self.calibrated

    def connect(self, *, calibrate: bool = True) -> None:
        self.connect_calibrate_args.append(calibrate)
        self.is_connected = True

    def get_observation(self) -> dict[str, float]:
        if self.observation_error is not None:
            raise self.observation_error
        return dict(self.positions)

    def send_action(self, action: dict[str, float]) -> dict[str, float]:
        self.actions.append(dict(action))
        self.positions.update(action)
        return dict(action)

    def _load_calibration(self, fpath: Path | None = None) -> None:
        if fpath is not None:
            self.loaded_calibration_paths.append(str(fpath))


def test_robot_gateway_manifest_defaults_to_observe_only() -> None:
    runtime = RobotGatewayRuntime()

    manifest = runtime.get_manifest()

    connection_modes = {mode.id: mode for mode in manifest.connection_modes}
    assert set(connection_modes) == {"direct_local"}
    assert connection_modes["direct_local"].label == "This computer"
    assert connection_modes["direct_local"].config_ref
    assert manifest.capabilities.observe is True
    assert manifest.capabilities.control is False
    assert manifest.profiles[0].capabilities.state_mirroring is True
    assert manifest.profiles[0].capabilities.joint_jog is False
    assert TEST_FIRST_JOINT_NAME in manifest.profiles[0].controlled_joint_names
    profile_by_side = {
        profile.control_target_side: profile
        for profile in manifest.profiles
        if profile.control_target_side in {"left", "right"}
    }
    assert set(profile_by_side) == {"left", "right"}
    assert profile_by_side["left"].hardware_device_key == "openarm:left_arm"
    assert profile_by_side["right"].hardware_device_key == "openarm:right_arm"
    assert all(
        joint_name.startswith(ROBOT_GATEWAY_OPENARM_CAN_LEFT_JOINT_PREFIX)
        for joint_name in profile_by_side["left"].controlled_joint_names
    )
    assert all(
        joint_name.startswith(ROBOT_GATEWAY_OPENARM_CAN_RIGHT_JOINT_PREFIX)
        for joint_name in profile_by_side["right"].controlled_joint_names
    )
    assert manifest.camera_streams[0].id == ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID
    assert manifest.camera_streams[0].capabilities.point_cloud is True
    assert manifest.camera_streams[0].camera_pose is not None
    assert (
        manifest.camera_streams[0].camera_pose.position
        == ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_POSITION_XYZ_M
    )
    assert manifest.live_transport is not None
    assert manifest.live_transport.type == "moq"
    assert manifest.live_transport.namespace.endswith("/openarm")
    assert ROBOT_GATEWAY_MOQ_TRACK_JOINT_TELEMETRY in {
        track.track_name for track in manifest.live_transport.tracks
    }
    assert ROBOT_GATEWAY_MOQ_TRACK_ROBOT_STATE in {
        track.track_name for track in manifest.live_transport.tracks
    }
    assert (
        f"camera/{ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID}/{ROBOT_GATEWAY_MOQ_TRACK_CAMERA_VIDEO_SUFFIX}"
        in {track.track_name for track in manifest.live_transport.tracks}
    )
    assert (
        f"camera/{ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID}/{ROBOT_GATEWAY_MOQ_TRACK_CAMERA_POINT_CLOUD_SUFFIX}"
        in {track.track_name for track in manifest.live_transport.tracks}
    )
    assert manifest.control_transport is None


def test_robot_gateway_derives_split_arm_targets_for_lerobot_profiles() -> None:
    profile = RobotGatewayProfile(
        id="bi_openarm_follower_joint_jog",
        label="Bi OpenArm Follower joint jog",
        control_target_label="Bi OpenArm Follower robot gateway",
        robot_id="bi_openarm_follower",
        adapter_id=ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
        teleoperation_mode=ROBOT_GATEWAY_TELEOPERATION_MODE_REAL_HARDWARE,
        hardware_device_key="/dev/serial/by-id/bi-openarm",
        controlled_joint_names=[
            "left_shoulder_pan",
            "left_elbow_flex",
            "right_shoulder_pan",
            "right_elbow_flex",
        ],
    )

    profiles = build_robot_gateway_manifest_profiles(profile)

    profile_by_side = {
        candidate.control_target_side: candidate
        for candidate in profiles
        if candidate.control_target_side in {"left", "right"}
    }
    assert profile.control_target_side is None
    assert profiles[0].control_target_side == "both"
    assert set(profile_by_side) == {"left", "right"}
    assert profile_by_side["left"].controlled_joint_names == [
        "left_shoulder_pan",
        "left_elbow_flex",
    ]
    assert profile_by_side["right"].controlled_joint_names == [
        "right_shoulder_pan",
        "right_elbow_flex",
    ]
    assert profile_by_side["left"].hardware_device_key == (
        "bi_openarm_follower:left_arm"
    )
    assert profile_by_side["left"].hardware_device_keys == [
        "/dev/serial/by-id/bi-openarm"
    ]
    assert profile_by_side["right"].hardware_device_key == (
        "bi_openarm_follower:right_arm"
    )
    assert profile_by_side["right"].hardware_device_keys == [
        "/dev/serial/by-id/bi-openarm"
    ]


def test_robot_gateway_derives_split_arm_targets_for_camel_case_joints() -> None:
    profile = RobotGatewayProfile(
        id="dual_arm_joint_jog",
        label="Dual arm joint jog",
        control_target_label="Dual arm robot gateway",
        robot_id="camelbot",
        adapter_id=ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
        teleoperation_mode=ROBOT_GATEWAY_TELEOPERATION_MODE_REAL_HARDWARE,
        controlled_joint_names=[
            "leftShoulderPan",
            "leftElbowFlex",
            "rightShoulderPan",
            "rightElbowFlex",
        ],
    )

    profiles = build_robot_gateway_manifest_profiles(profile)

    profile_by_side = {
        candidate.control_target_side: candidate
        for candidate in profiles
        if candidate.control_target_side in {"left", "right"}
    }
    assert set(profile_by_side) == {"left", "right"}
    assert profile_by_side["left"].controlled_joint_names == [
        "leftShoulderPan",
        "leftElbowFlex",
    ]
    assert profile_by_side["right"].controlled_joint_names == [
        "rightShoulderPan",
        "rightElbowFlex",
    ]


def test_robot_gateway_does_not_split_explicit_single_arm_profiles() -> None:
    profile = RobotGatewayProfile(
        id="openarm_left_arm_joint_jog",
        label="OpenArm left arm joint jog",
        control_target_label="OpenArm left arm",
        control_target_side="left",
        robot_id="openarm",
        adapter_id=ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
        teleoperation_mode=ROBOT_GATEWAY_TELEOPERATION_MODE_REAL_HARDWARE,
        controlled_joint_names=[
            "openarm_left_joint1",
            "openarm_left_joint2",
        ],
    )

    profiles = build_robot_gateway_manifest_profiles(profile)

    assert len(profiles) == 1
    assert profiles[0].control_target_side == "left"
    assert profiles[0].id == profile.id


def test_robot_gateway_env_config_file_round_trips(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(robot_gateway_config_file, "BASE_DIR", tmp_path)
    monkeypatch.delenv(ROBOT_GATEWAY_ENV_SELECTOR_ENV, raising=False)
    monkeypatch.delenv(ROBOT_GATEWAY_ENV_FILE_ENV, raising=False)

    created = robot_gateway_config_file.read_robot_gateway_env_config_file()

    assert created.exists is True
    assert "npm run start -- --robot openarm-a" in created.content
    assert ".env.robots/so100-left-1.env" in created.content
    assert created.path == str(tmp_path / ".env.robot.local")
    assert (tmp_path / ".env.robots").is_dir()

    saved = robot_gateway_config_file.write_robot_gateway_env_config_file(
        "URDF_ROBOT_GATEWAY_RUNTIME_MODE=control\n"
        "URDF_BUTTERCLAW_ROBOT_USE_SSH_TUNNEL=true\n"
    )

    assert saved.exists is True
    assert "URDF_BUTTERCLAW_ROBOT_USE_SSH_TUNNEL=true" in saved.content
    assert (tmp_path / ".env.robot.local").read_text(encoding="utf-8") == saved.content


def test_robot_gateway_env_config_open_touches_file_without_reading_content(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    opened: list[list[str]] = []
    monkeypatch.setattr(robot_gateway_config_file, "BASE_DIR", tmp_path)
    monkeypatch.delenv(ROBOT_GATEWAY_ENV_SELECTOR_ENV, raising=False)
    monkeypatch.delenv(ROBOT_GATEWAY_ENV_FILE_ENV, raising=False)
    monkeypatch.setattr(
        robot_gateway_config_file.subprocess,
        "Popen",
        lambda command, **_kwargs: opened.append(command),
    )
    monkeypatch.setattr(
        robot_gateway_config_file.shutil,
        "which",
        lambda name: f"/usr/bin/{name}" if name == "cursor" else None,
    )
    monkeypatch.setattr(robot_gateway_config_file.shutil, "which", lambda _name: None)

    result = robot_gateway_config_file.open_robot_gateway_env_config_file()

    assert result.opened is True
    assert result.exists is True
    assert result.path == str(tmp_path / ".env.robot.local")
    assert opened == [["xdg-open", str(tmp_path / ".env.robot.local")]]
    assert "URDF_ROBOT_GATEWAY_RUNTIME_MODE=observe" in (
        tmp_path / ".env.robot.local"
    ).read_text(encoding="utf-8")


def test_robot_gateway_local_file_open_prefers_cursor_editor(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    opened: list[list[str]] = []
    path = tmp_path / "calibration.json"
    path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(
        robot_gateway_config_file.subprocess,
        "Popen",
        lambda command, **_kwargs: opened.append(command),
    )
    monkeypatch.setattr(
        robot_gateway_config_file.shutil,
        "which",
        lambda name: f"/usr/bin/{name}" if name == "cursor" else None,
    )

    result = robot_gateway_config_file.open_robot_gateway_local_file(
        path,
        success_message="Opened.",
        fallback_message="Open manually.",
    )

    assert result.opened is True
    assert opened == [["cursor", "--reuse-window", str(path)]]


def test_robot_gateway_env_config_selects_robot_overlay(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    selected_path = tmp_path / ".env.robots" / "so100-left-1.env"
    monkeypatch.setattr(robot_gateway_config_file, "BASE_DIR", tmp_path)
    monkeypatch.setenv(ROBOT_GATEWAY_ENV_SELECTOR_ENV, "so100-left-1")
    monkeypatch.delenv(ROBOT_GATEWAY_ENV_FILE_ENV, raising=False)

    created = robot_gateway_config_file.read_robot_gateway_env_config_file()
    connection_modes = robot_gateway_config_file.build_robot_gateway_connection_modes()

    assert created.exists is True
    assert created.path == str(selected_path)
    assert "URDF_ROBOT_GATEWAY_LEROBOT_ROBOT_TYPE=so100_follower" in created.content
    assert selected_path.exists()
    assert (tmp_path / ".env.robot.local").exists()
    assert connection_modes[0].config_ref == str(selected_path)


def test_robot_gateway_env_config_explicit_file_selects_robot_overlay(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    selected_path = tmp_path / ".env.robots" / "openarm-a.env"
    monkeypatch.setattr(robot_gateway_config_file, "BASE_DIR", tmp_path)
    monkeypatch.setenv(ROBOT_GATEWAY_ENV_SELECTOR_ENV, "so100-left-1")
    monkeypatch.setenv(
        ROBOT_GATEWAY_ENV_FILE_ENV,
        ".env.robots/openarm-a.env",
    )

    saved = robot_gateway_config_file.write_robot_gateway_env_config_file(
        "URDF_ROBOT_GATEWAY_ROBOT_ID=openarm-a\n"
    )

    assert saved.path == str(selected_path)
    assert selected_path.read_text(encoding="utf-8") == saved.content


def test_robot_gateway_control_transport_follows_sidecar_bind_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("URDF_ROBOT_GATEWAY_TELEOP_WEBTRANSPORT_URL", raising=False)
    monkeypatch.delenv("URDF_ROBOT_GATEWAY_TELEOP_NATIVE_QUIC_ADDRESS", raising=False)
    monkeypatch.setenv("TELEOP_SIDECAR_WEBTRANSPORT_BIND", "127.0.0.1:9002")
    monkeypatch.setenv("TELEOP_SIDECAR_WEBTRANSPORT_PATH", "teleop-stream")
    monkeypatch.setenv("TELEOP_SIDECAR_NATIVE_QUIC_BIND", "127.0.0.1:9003")
    monkeypatch.setenv("TELEOP_SIDECAR_READY", "true")

    manifest = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control")
    ).get_manifest()

    assert manifest.control_transport is not None
    assert (
        manifest.control_transport.webtransport_url
        == "https://127.0.0.1:9002/teleop-stream"
    )
    assert manifest.control_transport.native_quic_address == "127.0.0.1:9003"
    assert manifest.control_transport.sidecar_ready is True
    assert {
        control_input.id: control_input.kind
        for control_input in manifest.profiles[0].control_inputs
    } == {
        ROBOT_GATEWAY_CONTROL_INPUT_BROWSER_KEYBOARD_ID: "keyboard",
        ROBOT_GATEWAY_CONTROL_INPUT_BROWSER_JOYSTICK_ID: "joystick",
    }


def test_robot_gateway_session_and_stats_do_not_open_hardware_state() -> None:
    adapter = FakeOpenArmAdapter()

    def fail_read_state():
        raise AssertionError("session and stats must not read hardware state")

    adapter.read_state = fail_read_state  # type: ignore[method-assign]
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=adapter,
    )

    session = runtime.get_session()
    stats = runtime.get_stats()

    assert session.robot_id == adapter.config.robot_id
    assert session.active_profile_id == adapter.build_profile(
        control_enabled=True
    ).id
    assert stats.robot_state["mode"] == "manual"


def test_robot_gateway_live_transport_rejects_public_anonymous_relay_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(ROBOT_GATEWAY_MOQ_RELAY_URL_ENV, TEST_PUBLIC_MOQ_RELAY_URL)

    with pytest.raises(ValueError, match="public anonymous MoQ relay"):
        RobotGatewayRuntime().get_manifest()


def test_robot_gateway_live_transport_rejects_anon_relay_paths() -> None:
    with pytest.raises(ValueError, match="public anonymous MoQ relay"):
        validate_robot_gateway_live_relay_url(TEST_PUBLIC_ANON_MOQ_RELAY_URL)


def test_robot_gateway_live_transport_rejects_schemeless_public_relay_urls() -> None:
    with pytest.raises(ValueError, match="public anonymous MoQ relay"):
        validate_robot_gateway_live_relay_url(TEST_SCHEMELESS_PUBLIC_MOQ_RELAY_URL)


def test_robot_gateway_live_transport_accepts_private_relay_urls() -> None:
    assert (
        validate_robot_gateway_live_relay_url(TEST_PRIVATE_MOQ_RELAY_URL)
        == TEST_PRIVATE_MOQ_RELAY_URL
    )


def test_robot_gateway_control_datagram_packet_builds_capability_verify_payload() -> None:
    packet = RobotGatewayControlDatagramPacket(
        session_id="robot-session-a",
        peer_id=TEST_OPERATOR_ID,
        sequence=TEST_COMMAND_SEQUENCE,
        source_ts_ms=TEST_COMMAND_SEQUENCE,
        monotonic_timestamp_ns=TEST_MONOTONIC_TIMESTAMP_NS,
        command_kind="joint_jog",
        authorization={
            "collaboration_session_id": TEST_COLLABORATION_SESSION_ID,
            "teleop_capability_token": TEST_TELEOP_CAPABILITY_TOKEN,
        },
        payload={
            "joint_name": TEST_FIRST_JOINT_NAME,
            "delta_rad": TEST_JOINT_DELTA_RAD,
        },
    )

    assert packet.require_teleop_capability_session_id() == TEST_COLLABORATION_SESSION_ID
    assert packet.build_teleop_capability_verify_payload() == {
        "capability_token": TEST_TELEOP_CAPABILITY_TOKEN,
        "required_role": "teleop_operator",
        "transport": "moq",
    }


def test_robot_gateway_control_datagram_packet_requires_authorization_for_verify_payload() -> None:
    packet = RobotGatewayControlDatagramPacket(
        session_id="robot-session-a",
        peer_id=TEST_OPERATOR_ID,
        sequence=TEST_COMMAND_SEQUENCE,
        source_ts_ms=TEST_COMMAND_SEQUENCE,
        monotonic_timestamp_ns=TEST_MONOTONIC_TIMESTAMP_NS,
        command_kind="twist",
        ack_requested=False,
        payload=TEST_TWIST_PAYLOAD,
    )

    with pytest.raises(ValueError, match="missing teleop authorization"):
        packet.build_teleop_capability_verify_payload()


def test_robot_gateway_control_datagram_verifier_accepts_authorized_lease_holder() -> None:
    runtime = _build_control_runtime_with_lease()
    descriptor = _build_ready_control_transport_descriptor()
    verify_calls: list[tuple[str, dict[str, str]]] = []

    def verify_capability(session_id: str, payload: dict[str, str]) -> bool:
        verify_calls.append((session_id, payload))
        return True

    result = verify_robot_gateway_control_datagram(
        _build_control_datagram_packet(),
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=verify_capability,
    )

    assert result.accepted is True
    assert result.reason == ""
    assert verify_calls == [
        (
            TEST_COLLABORATION_SESSION_ID,
            {
                "capability_token": TEST_TELEOP_CAPABILITY_TOKEN,
                "required_role": "teleop_operator",
                "transport": "moq",
            },
        )
    ]


def test_robot_gateway_control_datagram_verifier_rejects_missing_capability() -> None:
    runtime = _build_control_runtime_with_lease()
    descriptor = _build_ready_control_transport_descriptor()

    result = verify_robot_gateway_control_datagram(
        _build_control_datagram_packet(with_authorization=False),
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=lambda _session_id, _payload: True,
    )

    assert result.accepted is False
    assert result.reason == "Control datagram is missing teleop authorization."


def test_robot_gateway_control_datagram_verifier_rejects_non_lease_holder() -> None:
    runtime = _build_control_runtime_with_lease()
    descriptor = _build_ready_control_transport_descriptor()

    result = verify_robot_gateway_control_datagram(
        _build_control_datagram_packet(peer_id="operator-b"),
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=lambda _session_id, _payload: True,
    )

    assert result.accepted is False
    assert result.reason == "Control datagram peer does not hold the active lease."


def test_robot_gateway_control_datagram_verifier_rejects_inactive_capability() -> None:
    runtime = _build_control_runtime_with_lease()
    descriptor = _build_ready_control_transport_descriptor()

    result = verify_robot_gateway_control_datagram(
        _build_control_datagram_packet(),
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=lambda _session_id, _payload: False,
    )

    assert result.accepted is False
    assert result.reason == "Teleop capability verification failed."


def test_robot_gateway_http_capability_verifier_posts_to_advertised_verify_path() -> None:
    descriptor = _build_ready_control_transport_descriptor()
    verifier = RobotGatewayHttpTeleopCapabilityVerifier(
        backend_base_url=TEST_BACKEND_BASE_URL,
        descriptor=descriptor,
    )

    with patch(
        "backend.robot_gateway.control_datagram_verifier.urlopen",
        return_value=FakeCapabilityVerifyResponse(b'{"active": true}'),
    ) as urlopen_mock:
        accepted = verifier(
            TEST_COLLABORATION_SESSION_ID,
            {
                "capability_token": TEST_TELEOP_CAPABILITY_TOKEN,
                "required_role": "teleop_operator",
                "transport": "moq",
            },
        )

    assert accepted is True
    request = urlopen_mock.call_args.args[0]
    assert request.full_url == build_teleop_capability_verify_url(
        backend_base_url=TEST_BACKEND_BASE_URL,
        descriptor=descriptor,
        collaboration_session_id=TEST_COLLABORATION_SESSION_ID,
    )
    assert json.loads(request.data.decode("utf-8")) == {
        "capability_token": TEST_TELEOP_CAPABILITY_TOKEN,
        "required_role": "teleop_operator",
        "transport": "moq",
    }


def test_robot_gateway_control_datagram_dispatches_verified_joint_jog() -> None:
    runtime = _build_control_runtime_with_lease()
    descriptor = _build_ready_control_transport_descriptor()

    ack = dispatch_robot_gateway_control_datagram(
        _build_control_datagram_packet(),
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=lambda _session_id, _payload: True,
        server_received_unix_ms=TEST_SERVER_RECEIVED_UNIX_MS,
    )

    assert ack.accepted is True
    assert ack.reason == "joint jog accepted"
    assert ack.sequence == TEST_COMMAND_SEQUENCE
    assert ack.session_id == ROBOT_GATEWAY_DEFAULT_SESSION_ID
    assert ack.peer_id == TEST_OPERATOR_ID


def test_robot_gateway_rejects_stale_rest_joint_jog_timestamp() -> None:
    runtime = _build_control_runtime_with_lease()

    ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_FIRST_JOINT_NAME,
            delta_rad=TEST_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
            source_ts_ms=TEST_TIMESTAMP_BOUNDARY_OFFSET_MS,
        )
    )
    state = runtime.read_state()

    assert ack.accepted is False
    assert ack.reason == ROBOT_GATEWAY_CONTROL_DATAGRAM_STALE_REASON
    assert state.joint_positions_rad[TEST_FIRST_JOINT_NAME] == 0.0


def test_robot_gateway_control_datagram_dispatches_stop_after_verification() -> None:
    runtime = _build_control_runtime_with_lease()
    descriptor = _build_ready_control_transport_descriptor()

    ack = dispatch_robot_gateway_control_datagram(
        _build_control_datagram_packet(command_kind="stop", payload={}),
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=lambda _session_id, _payload: True,
        server_received_unix_ms=TEST_SERVER_RECEIVED_UNIX_MS,
    )

    assert ack.accepted is True
    assert ack.reason == "safe hold requested"
    assert ack.sequence == TEST_COMMAND_SEQUENCE


def test_robot_gateway_control_datagram_dispatches_estop_after_verification() -> None:
    runtime = _build_control_runtime_with_lease()
    descriptor = _build_ready_control_transport_descriptor()

    ack = dispatch_robot_gateway_control_datagram(
        _build_control_datagram_packet(command_kind="estop", payload={}),
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=lambda _session_id, _payload: True,
        server_received_unix_ms=TEST_SERVER_RECEIVED_UNIX_MS,
    )

    assert ack.accepted is True
    assert ack.reason == "e-stop latched"
    assert ack.sequence == TEST_COMMAND_SEQUENCE


def test_robot_gateway_control_datagram_dispatch_rejects_replayed_sequence() -> None:
    runtime = _build_control_runtime_with_lease()
    descriptor = _build_ready_control_transport_descriptor()

    first_ack = dispatch_robot_gateway_control_datagram(
        _build_control_datagram_packet(),
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=lambda _session_id, _payload: True,
        server_received_unix_ms=TEST_SERVER_RECEIVED_UNIX_MS,
    )
    replay_ack = dispatch_robot_gateway_control_datagram(
        _build_control_datagram_packet(),
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=lambda _session_id, _payload: True,
        server_received_unix_ms=TEST_SERVER_RECEIVED_UNIX_MS,
    )

    assert first_ack.accepted is True
    assert replay_ack.accepted is False
    assert (
        replay_ack.reason
        == ROBOT_GATEWAY_CONTROL_DATAGRAM_REPLAYED_SEQUENCE_REASON
    )


def test_robot_gateway_control_datagram_dispatch_rejects_stale_timestamp() -> None:
    runtime = _build_control_runtime_with_lease()
    descriptor = _build_ready_control_transport_descriptor()

    ack = dispatch_robot_gateway_control_datagram(
        _build_control_datagram_packet(
            source_ts_ms=(
                TEST_SERVER_RECEIVED_UNIX_MS
                - ROBOT_GATEWAY_CONTROL_DATAGRAM_MAX_AGE_MS
                - TEST_TIMESTAMP_BOUNDARY_OFFSET_MS
            )
        ),
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=lambda _session_id, _payload: True,
        server_received_unix_ms=TEST_SERVER_RECEIVED_UNIX_MS,
    )

    assert ack.accepted is False
    assert ack.reason == ROBOT_GATEWAY_CONTROL_DATAGRAM_STALE_REASON


def test_robot_gateway_control_datagram_dispatch_rejects_future_timestamp() -> None:
    runtime = _build_control_runtime_with_lease()
    descriptor = _build_ready_control_transport_descriptor()

    ack = dispatch_robot_gateway_control_datagram(
        _build_control_datagram_packet(
            source_ts_ms=(
                TEST_SERVER_RECEIVED_UNIX_MS
                + ROBOT_GATEWAY_CONTROL_DATAGRAM_MAX_FUTURE_SKEW_MS
                + TEST_TIMESTAMP_BOUNDARY_OFFSET_MS
            )
        ),
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=lambda _session_id, _payload: True,
        server_received_unix_ms=TEST_SERVER_RECEIVED_UNIX_MS,
    )

    assert ack.accepted is False
    assert ack.reason == ROBOT_GATEWAY_CONTROL_DATAGRAM_FUTURE_TIMESTAMP_REASON


def test_robot_gateway_control_datagram_dispatch_rejects_before_command_execution() -> None:
    runtime = _build_control_runtime_with_lease()
    descriptor = _build_ready_control_transport_descriptor()

    ack = dispatch_robot_gateway_control_datagram(
        _build_control_datagram_packet(peer_id="operator-b"),
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=lambda _session_id, _payload: True,
        server_received_unix_ms=TEST_SERVER_RECEIVED_UNIX_MS,
    )

    assert ack.accepted is False
    assert ack.reason == "Control datagram peer does not hold the active lease."
    assert ack.sequence == TEST_COMMAND_SEQUENCE


def test_robot_gateway_control_datagram_dispatch_rejects_invalid_payload() -> None:
    runtime = _build_control_runtime_with_lease()
    descriptor = _build_ready_control_transport_descriptor()

    ack = dispatch_robot_gateway_control_datagram(
        _build_control_datagram_packet(payload={"joint_name": TEST_FIRST_JOINT_NAME}),
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=lambda _session_id, _payload: True,
        server_received_unix_ms=TEST_SERVER_RECEIVED_UNIX_MS,
    )

    assert ack.accepted is False
    assert ack.reason.startswith(
        ROBOT_GATEWAY_CONTROL_DATAGRAM_INVALID_PAYLOAD_REASON_PREFIX
    )


def test_robot_gateway_control_datagram_frame_decode_dispatch_and_ack_roundtrip() -> None:
    runtime = _build_control_runtime_with_lease()
    descriptor = _build_ready_control_transport_descriptor()
    frame = _build_control_datagram_packet().model_dump_json().encode("utf-8")

    packet = decode_robot_gateway_control_datagram(frame)
    ack = dispatch_robot_gateway_control_datagram_frame(
        frame,
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=lambda _session_id, _payload: True,
        server_received_unix_ms=TEST_SERVER_RECEIVED_UNIX_MS,
    )

    assert packet.sequence == TEST_COMMAND_SEQUENCE
    assert ack is not None
    assert ack.accepted is True
    assert json.loads(encode_robot_gateway_control_datagram_ack(ack))[
        "sequence"
    ] == TEST_COMMAND_SEQUENCE


def test_robot_gateway_control_datagram_frame_decode_ignores_malformed_frame() -> None:
    runtime = _build_control_runtime_with_lease()
    descriptor = _build_ready_control_transport_descriptor()

    ack = dispatch_robot_gateway_control_datagram_frame(
        b"not json",
        descriptor=descriptor,
        runtime=runtime,
        verify_teleop_capability=lambda _session_id, _payload: True,
    )

    assert ack is None


def test_robot_gateway_openarm_joint_names_match_bimanual_urdf() -> None:
    runtime = RobotGatewayRuntime()
    joint_names = runtime.get_manifest().profiles[0].controlled_joint_names

    assert "openarm_left_joint1" in joint_names
    assert "openarm_right_joint1" in joint_names
    assert "openarm_left_finger_joint1" in joint_names
    assert "openarm_right_finger_joint1" in joint_names
    assert "left_shoulder_pan" not in joint_names


def test_robot_gateway_rejects_joint_jog_until_control_mode_and_lease() -> None:
    runtime = RobotGatewayRuntime()

    ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_FIRST_JOINT_NAME,
            delta_rad=TEST_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert ack.accepted is False
    assert ack.reason == "Gateway is in observe mode."
    assert ack.sequence == TEST_COMMAND_SEQUENCE


def test_robot_gateway_control_mode_requires_lease_before_joint_jog() -> None:
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=FakeOpenArmAdapter(),
    )

    no_lease_ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_FIRST_JOINT_NAME, delta_rad=TEST_JOINT_DELTA_RAD
        )
    )
    lease = runtime.request_lease(
        RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID)
    )
    accepted_ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_FIRST_JOINT_NAME, delta_rad=TEST_JOINT_DELTA_RAD
        )
    )

    assert no_lease_ack.accepted is False
    assert no_lease_ack.reason == "No active control lease."
    assert lease.accepted is True
    assert accepted_ack.accepted is True
    assert accepted_ack.applied_joint_name == TEST_FIRST_JOINT_NAME
    assert accepted_ack.applied_delta_rad == TEST_JOINT_DELTA_RAD


def test_robot_gateway_control_mode_rejects_joint_jog_from_non_lease_owner() -> None:
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=FakeOpenArmAdapter(),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OTHER_OPERATOR_ID,
            joint_name=TEST_FIRST_JOINT_NAME,
            delta_rad=TEST_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )
    state = runtime.read_state()

    assert ack.accepted is False
    assert ack.reason == ROBOT_GATEWAY_CONTROL_LEASE_OWNER_MISMATCH_REASON
    assert ack.applied_joint_name == TEST_FIRST_JOINT_NAME
    assert state.joint_positions_rad[TEST_FIRST_JOINT_NAME] == 0.0


def test_robot_gateway_control_mode_rejects_joint_jog_dry_run_from_non_lease_owner() -> None:
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=FakeOpenArmAdapter(),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    plan = runtime.prepare_joint_jog_can_dry_run(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OTHER_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            delta_rad=TEST_RIGHT_CAN_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )
    state = runtime.read_state()

    assert plan.accepted is False
    assert plan.reason == ROBOT_GATEWAY_CONTROL_LEASE_OWNER_MISMATCH_REASON
    assert plan.frame is None
    assert state.joint_positions_rad[TEST_RIGHT_CAN_JOINT_NAME] == 0.0


def test_robot_gateway_prepares_openarm_can_dry_run_without_mutating_joint_state() -> (
    None
):
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=FakeOpenArmAdapter(),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))
    state_before = runtime.read_state()

    plan = runtime.prepare_joint_jog_can_dry_run(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            current_position_rad=TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
            delta_rad=TEST_RIGHT_CAN_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )
    state_after = runtime.read_state()

    assert plan.accepted is True
    assert plan.reason == "OpenArm CAN joint jog prepared; dry-run only, not sent."
    assert plan.applied_joint_name == TEST_RIGHT_CAN_JOINT_NAME
    assert plan.applied_delta_rad == TEST_RIGHT_CAN_JOINT_DELTA_RAD
    assert plan.frame is not None
    assert plan.frame.arm_side == ROBOT_GATEWAY_OPENARM_CAN_RIGHT_ARM_SIDE
    assert plan.frame.logical_bus == ROBOT_GATEWAY_OPENARM_CAN_RIGHT_LOGICAL_BUS
    assert plan.frame.protocol == ROBOT_GATEWAY_OPENARM_CAN_PROTOCOL
    assert (
        plan.frame.send_can_id
        == ROBOT_GATEWAY_OPENARM_CAN_SEND_IDS[TEST_RIGHT_CAN_MOTOR_INDEX]
    )
    assert (
        plan.frame.recv_can_id
        == ROBOT_GATEWAY_OPENARM_CAN_RECV_IDS[TEST_RIGHT_CAN_MOTOR_INDEX]
    )
    assert plan.frame.send_can_id_hex.startswith(ROBOT_GATEWAY_OPENARM_CAN_HEX_PREFIX)
    assert len(plan.frame.data_bytes) == plan.frame.dlc
    assert plan.frame.data_hex == "".join(
        f"{byte:0{ROBOT_GATEWAY_OPENARM_CAN_HEX_WIDTH}X}"
        for byte in plan.frame.data_bytes
    )
    assert plan.frame.mit_param.kp == ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_DEFAULT_KP
    assert plan.frame.mit_param.kd == ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_DEFAULT_KD
    assert (
        plan.frame.mit_param.q
        == pytest.approx(
            TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD + TEST_RIGHT_CAN_JOINT_DELTA_RAD
        )
    )
    assert plan.frame.mit_param.dq == ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_DEFAULT_DQ
    assert plan.frame.mit_param.tau == ROBOT_GATEWAY_OPENARM_CAN_DAMIAO_DEFAULT_TAU
    assert (
        plan.frame.transmission_state
        == ROBOT_GATEWAY_OPENARM_CAN_DRY_RUN_TRANSMISSION_STATE
    )
    assert (
        state_after.joint_positions_rad[TEST_RIGHT_CAN_JOINT_NAME]
        == state_before.joint_positions_rad[TEST_RIGHT_CAN_JOINT_NAME]
    )


def test_robot_gateway_rejects_oversized_joint_jog_dry_run_delta() -> None:
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=FakeOpenArmAdapter(),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    plan = runtime.prepare_joint_jog_can_dry_run(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            delta_rad=TEST_OVERSIZED_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )
    state = runtime.read_state()

    assert plan.accepted is False
    assert plan.reason == ROBOT_GATEWAY_JOINT_JOG_DELTA_LIMIT_REASON
    assert plan.frame is None
    assert state.joint_positions_rad[TEST_RIGHT_CAN_JOINT_NAME] == 0.0


def test_native_openarm_adapter_sends_joint_jog_over_can() -> None:
    can_bridge = FakeOpenArmCanBridge()
    joint_position_reader = FakeJointPositionReader(
        readings_rad=[
            {TEST_RIGHT_CAN_JOINT_NAME: TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD},
            {
                TEST_RIGHT_CAN_JOINT_NAME: TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD
                + 0.002
            },
        ]
    )
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=_native_openarm_adapter_allowing_unvalidated_self_collision(
            can_bridge,
            joint_position_reader=joint_position_reader,
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            current_position_rad=TEST_SPOOFED_RIGHT_CAN_JOINT_POSITION_RAD,
            delta_rad=TEST_RIGHT_CAN_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert ack.accepted is True
    assert ack.reason == "OpenArm CAN joint jog sent."
    assert ack.applied_joint_name == TEST_RIGHT_CAN_JOINT_NAME
    assert ack.applied_delta_rad == pytest.approx(TEST_RIGHT_CAN_JOINT_DELTA_RAD)
    assert joint_position_reader.read_joint_names == [
        ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES
    ]
    assert can_bridge.enabled_joints == [TEST_RIGHT_CAN_JOINT_NAME]
    assert len(can_bridge.sent_frames) == 1
    assert can_bridge.sent_frames[0].logical_bus == ROBOT_GATEWAY_OPENARM_CAN_RIGHT_LOGICAL_BUS
    assert (
        can_bridge.sent_frames[0].motor_type
        == ROBOT_GATEWAY_OPENARM_CAN_MOTOR_TYPES[TEST_RIGHT_CAN_MOTOR_INDEX]
    )
    assert (
        can_bridge.sent_frames[0].mit_param.q
        == pytest.approx(
            TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD + TEST_RIGHT_CAN_JOINT_DELTA_RAD
        )
    )


def test_native_openarm_adapter_applies_rotation_calibration_before_can_send() -> None:
    can_bridge = FakeOpenArmCanBridge()
    raw_position_rad = -0.30
    zero_offset_rad = 0.20
    calibrated_current_position_rad = 0.50
    calibrated_target_position_rad = (
        calibrated_current_position_rad + TEST_RIGHT_CAN_JOINT_DELTA_RAD
    )
    joint_position_reader = FakeJointPositionReader(
        {TEST_RIGHT_CAN_JOINT_NAME: raw_position_rad}
    )
    joint_rotation_calibration = OpenArmJointRotationCalibration(
        calibration_id="test-rotation-calibration",
        required_joint_names=ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES,
        joint_entries={
            joint_name: OpenArmJointRotationCalibrationEntry(
                direction=1,
                zero_offset_rad=0.0,
            )
            for joint_name in ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES
            if ROBOT_GATEWAY_OPENARM_SELF_COLLISION_FINGER_NAME_TOKEN not in joint_name
        }
        | {
            TEST_RIGHT_CAN_JOINT_NAME: OpenArmJointRotationCalibrationEntry(
                direction=-1,
                zero_offset_rad=zero_offset_rad,
            )
        },
    )
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=_native_openarm_adapter_allowing_unvalidated_self_collision(
            can_bridge,
            joint_position_reader=joint_position_reader,
            joint_rotation_calibration=joint_rotation_calibration,
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            current_position_rad=TEST_SPOOFED_RIGHT_CAN_JOINT_POSITION_RAD,
            delta_rad=TEST_RIGHT_CAN_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert ack.accepted is True
    assert ack.applied_delta_rad == pytest.approx(TEST_RIGHT_CAN_JOINT_DELTA_RAD)
    assert can_bridge.sent_frames[0].mit_param.q == pytest.approx(
        -(calibrated_target_position_rad - zero_offset_rad)
    )
    state = runtime.read_state()
    assert state.joint_positions_rad[TEST_RIGHT_CAN_JOINT_NAME] == pytest.approx(
        calibrated_current_position_rad
    )
    assert state.hardware_motion_safety.joint_rotation_calibration_ready is True
    assert (
        state.hardware_motion_safety.joint_rotation_calibration_id
        == "test-rotation-calibration"
    )


def test_native_openarm_adapter_requires_rotation_calibration_before_can_send() -> None:
    can_bridge = FakeOpenArmCanBridge()
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=NativeOpenArmAdapter(
            config=RobotGatewayAdapterConfig(
                adapter_kind="openarm_native",
                allow_unvalidated_self_collision=True,
            ),
            can_bridge=can_bridge,
            joint_position_reader=FakeJointPositionReader(
                {TEST_RIGHT_CAN_JOINT_NAME: TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD}
            ),
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            current_position_rad=TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
            delta_rad=TEST_RIGHT_CAN_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert ack.accepted is False
    assert "joint rotation calibration is required" in ack.reason
    assert len(can_bridge.sent_frames) == 0


def test_native_openarm_calibration_jog_sends_raw_relative_motion_without_rotation_calibration() -> None:
    can_bridge = FakeOpenArmCanBridge()
    joint_position_reader = FakeJointPositionReader(
        readings_rad=[
            {TEST_RIGHT_CAN_JOINT_NAME: TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD},
            {
                TEST_RIGHT_CAN_JOINT_NAME: TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD
                + 0.002
            },
        ]
    )
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=NativeOpenArmAdapter(
            config=RobotGatewayAdapterConfig(
                adapter_kind="openarm_native",
                allow_unvalidated_self_collision=True,
            ),
            can_bridge=can_bridge,
            joint_position_reader=joint_position_reader,
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_openarm_calibration_jog(
        RobotGatewayOpenArmCalibrationJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            delta_rad=0.002,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert ack.accepted is True
    assert ack.reason == ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_REASON
    assert ack.applied_delta_rad == pytest.approx(0.002)
    assert can_bridge.enabled_joints == [TEST_RIGHT_CAN_JOINT_NAME]
    assert len(can_bridge.sent_frames) == 1
    assert can_bridge.sent_frames[0].mit_param.q == pytest.approx(
        TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD + 0.002
    )
    assert len(joint_position_reader.read_joint_names) >= 2
    assert all(
        joint_names == ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES
        for joint_names in joint_position_reader.read_joint_names
    )


def test_native_openarm_calibration_jog_rejects_large_delta_before_can_send() -> None:
    can_bridge = FakeOpenArmCanBridge()
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=NativeOpenArmAdapter(
            config=RobotGatewayAdapterConfig(
                adapter_kind="openarm_native",
                allow_unvalidated_self_collision=True,
            ),
            can_bridge=can_bridge,
            joint_position_reader=FakeJointPositionReader(
                {TEST_RIGHT_CAN_JOINT_NAME: TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD}
            ),
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_openarm_calibration_jog(
        RobotGatewayOpenArmCalibrationJogRequest.model_construct(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            delta_rad=0.02,
            sequence=TEST_COMMAND_SEQUENCE,
            source_ts_ms=0,
            ack_requested=True,
        )
    )

    assert ack.accepted is False
    assert ack.reason == ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_DELTA_LIMIT_REASON
    assert len(can_bridge.sent_frames) == 0


def test_native_openarm_calibration_jog_rejects_when_encoder_does_not_move() -> None:
    can_bridge = FakeOpenArmCanBridge()
    stationary_positions = {
        TEST_RIGHT_CAN_JOINT_NAME: TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD
    }
    joint_position_reader = FakeJointPositionReader(
        positions_rad=stationary_positions,
        readings_rad=[
            stationary_positions,
            stationary_positions,
        ]
    )
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=NativeOpenArmAdapter(
            config=RobotGatewayAdapterConfig(
                adapter_kind="openarm_native",
                allow_unvalidated_self_collision=True,
            ),
            can_bridge=can_bridge,
            joint_position_reader=joint_position_reader,
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_openarm_calibration_jog(
        RobotGatewayOpenArmCalibrationJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            delta_rad=0.002,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert ack.accepted is False
    assert ack.reason == ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_NO_MOTION_REASON
    assert ack.applied_delta_rad == pytest.approx(0.0)
    assert can_bridge.enabled_joints == [TEST_RIGHT_CAN_JOINT_NAME]
    assert len(can_bridge.sent_frames) == 1
    assert len(joint_position_reader.read_joint_names) >= 2
    assert all(
        joint_names == ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES
        for joint_names in joint_position_reader.read_joint_names
    )


def test_native_openarm_calibration_jog_rejects_uncommanded_joint_motion() -> None:
    can_bridge = FakeOpenArmCanBridge()
    uncommanded_joint_name = "openarm_left_joint1"
    joint_position_reader = FakeJointPositionReader(
        readings_rad=[
            {
                TEST_RIGHT_CAN_JOINT_NAME: TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
                uncommanded_joint_name: 0.0,
            },
            {
                TEST_RIGHT_CAN_JOINT_NAME: TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD
                + 0.002,
                uncommanded_joint_name: 0.002,
            },
        ]
    )
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=NativeOpenArmAdapter(
            config=RobotGatewayAdapterConfig(
                adapter_kind="openarm_native",
                allow_unvalidated_self_collision=True,
            ),
            can_bridge=can_bridge,
            joint_position_reader=joint_position_reader,
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_openarm_calibration_jog(
        RobotGatewayOpenArmCalibrationJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            delta_rad=0.002,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert ack.accepted is False
    assert (
        ack.reason
        == f"{ROBOT_GATEWAY_OPENARM_CALIBRATION_JOG_UNCOMMANDED_MOTION_REASON} "
        f"{uncommanded_joint_name}"
    )
    assert ack.applied_delta_rad == pytest.approx(0.002)
    assert can_bridge.enabled_joints == [TEST_RIGHT_CAN_JOINT_NAME]
    assert len(can_bridge.sent_frames) == 1
    assert joint_position_reader.read_joint_names == [
        ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES,
        ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES,
    ]


def test_native_openarm_adapter_rejects_calibrated_soft_limit_before_can_send() -> None:
    can_bridge = FakeOpenArmCanBridge()
    joint_rotation_calibration = OpenArmJointRotationCalibration(
        calibration_id="test-soft-limit-calibration",
        required_joint_names=ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES,
        joint_entries={
            joint_name: OpenArmJointRotationCalibrationEntry(
                direction=1,
                zero_offset_rad=0.0,
                soft_min_rad=-1.0,
                soft_max_rad=1.0,
            )
            for joint_name in ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES
            if ROBOT_GATEWAY_OPENARM_SELF_COLLISION_FINGER_NAME_TOKEN not in joint_name
        },
    )
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=_native_openarm_adapter_allowing_unvalidated_self_collision(
            can_bridge,
            joint_position_reader=FakeJointPositionReader(
                {TEST_RIGHT_CAN_JOINT_NAME: 0.99}
            ),
            joint_rotation_calibration=joint_rotation_calibration,
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            current_position_rad=0.99,
            delta_rad=TEST_RIGHT_CAN_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert ack.accepted is False
    assert ack.reason == "Joint jog target exceeds the calibrated OpenArm soft joint limit."
    assert len(can_bridge.sent_frames) == 0


def test_native_openarm_adapter_rejects_joint_jog_without_authoritative_feedback_before_can_send() -> None:
    can_bridge = FakeOpenArmCanBridge()
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=NativeOpenArmAdapter(
            config=RobotGatewayAdapterConfig(
                adapter_kind="openarm_native",
                allow_unvalidated_self_collision=True,
            ),
            can_bridge=can_bridge,
            joint_rotation_calibration=build_identity_openarm_joint_rotation_calibration(
                ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES
            ),
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            current_position_rad=TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
            delta_rad=TEST_RIGHT_CAN_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert ack.accepted is False
    assert ack.reason == ROBOT_GATEWAY_JOINT_JOG_CURRENT_POSITION_REQUIRED_REASON
    assert len(can_bridge.sent_frames) == 0


def test_native_openarm_adapter_rejects_oversized_joint_jog_before_can_send() -> None:
    can_bridge = FakeOpenArmCanBridge()
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=_native_openarm_adapter_allowing_unvalidated_self_collision(
            can_bridge
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            current_position_rad=TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
            delta_rad=TEST_OVERSIZED_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert ack.accepted is False
    assert ack.reason == ROBOT_GATEWAY_JOINT_JOG_DELTA_LIMIT_REASON
    assert ack.applied_joint_name == TEST_RIGHT_CAN_JOINT_NAME
    assert len(can_bridge.sent_frames) == 0


def test_native_openarm_adapter_rejects_too_fast_consecutive_joint_jog_before_can_send() -> None:
    can_bridge = FakeOpenArmCanBridge()
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=_native_openarm_adapter_allowing_unvalidated_self_collision(
            can_bridge
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    with patch(
        "backend.robot_gateway.adapters.monotonic",
        side_effect=(
            TEST_MONOTONIC_SECONDS,
            TEST_MONOTONIC_SECONDS,
            TEST_MONOTONIC_SECONDS,
            TEST_MONOTONIC_SECONDS,
        ),
    ):
        first_ack = runtime.apply_joint_jog(
            RobotGatewayJointJogRequest(
                operator_id=TEST_OPERATOR_ID,
                joint_name=TEST_RIGHT_CAN_JOINT_NAME,
                current_position_rad=TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
                delta_rad=TEST_RIGHT_CAN_JOINT_DELTA_RAD,
                sequence=TEST_COMMAND_SEQUENCE,
            )
        )
        second_ack = runtime.apply_joint_jog(
            RobotGatewayJointJogRequest(
                operator_id=TEST_OPERATOR_ID,
                joint_name=TEST_RIGHT_CAN_JOINT_NAME,
                current_position_rad=(
                    TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD
                    + TEST_RIGHT_CAN_JOINT_DELTA_RAD
                ),
                delta_rad=TEST_SECOND_RIGHT_CAN_JOINT_DELTA_RAD,
                sequence=TEST_COMMAND_SEQUENCE + TEST_TIMESTAMP_BOUNDARY_OFFSET_MS,
            )
        )

    assert first_ack.accepted is True
    assert second_ack.accepted is False
    assert second_ack.reason == ROBOT_GATEWAY_JOINT_JOG_VELOCITY_LIMIT_REASON
    assert len(can_bridge.sent_frames) == 1
    assert can_bridge.sent_frames[0].mit_param.q == pytest.approx(
        TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD + TEST_RIGHT_CAN_JOINT_DELTA_RAD
    )


def test_native_openarm_adapter_fails_closed_when_can_send_fails() -> None:
    can_bridge = FakeOpenArmCanBridge(
        OpenArmCanTransportError("OpenArm CAN send failed")
    )
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=_native_openarm_adapter_allowing_unvalidated_self_collision(
            can_bridge
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            current_position_rad=TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
            delta_rad=TEST_RIGHT_CAN_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert ack.accepted is False
    assert ack.reason == "OpenArm CAN send failed"
    assert len(can_bridge.sent_frames) == 0


def test_native_openarm_adapter_requires_self_collision_preflight_before_can_send() -> None:
    can_bridge = FakeOpenArmCanBridge()
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=NativeOpenArmAdapter(
            can_bridge=can_bridge,
            joint_position_reader=FakeJointPositionReader(
                {TEST_RIGHT_CAN_JOINT_NAME: TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD}
            ),
            joint_rotation_calibration=build_identity_openarm_joint_rotation_calibration(
                ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES
            ),
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            current_position_rad=TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
            delta_rad=TEST_RIGHT_CAN_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert ack.accepted is False
    assert ack.reason == ROBOT_GATEWAY_JOINT_JOG_SELF_COLLISION_REQUIRED_REASON
    assert len(can_bridge.sent_frames) == 0


def test_native_openarm_adapter_rejects_self_collision_preflight_before_can_send() -> None:
    can_bridge = FakeOpenArmCanBridge()
    preflight_targets = []
    joint_position_reader = FakeJointPositionReader(
        {
            "openarm_left_joint1": TEST_AUTHORITATIVE_LEFT_CAN_JOINT_POSITION_RAD,
            TEST_RIGHT_CAN_JOINT_NAME: TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
        }
    )

    def reject_self_collision(target_positions, _request):
        preflight_targets.append(dict(target_positions))
        return ROBOT_GATEWAY_JOINT_JOG_SELF_COLLISION_LIMIT_REASON

    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=NativeOpenArmAdapter(
            config=RobotGatewayAdapterConfig(adapter_kind="openarm_native"),
            can_bridge=can_bridge,
            safety_preflight=reject_self_collision,
            joint_position_reader=joint_position_reader,
            joint_rotation_calibration=build_identity_openarm_joint_rotation_calibration(
                ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES
            ),
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            current_position_rad=TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
            delta_rad=TEST_RIGHT_CAN_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert ack.accepted is False
    assert ack.reason == ROBOT_GATEWAY_JOINT_JOG_SELF_COLLISION_LIMIT_REASON
    assert preflight_targets[0][TEST_RIGHT_CAN_JOINT_NAME] == pytest.approx(
        TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD
        + (TEST_RIGHT_CAN_JOINT_DELTA_RAD / 2.0)
    )
    assert preflight_targets[-1]["openarm_left_joint1"] == pytest.approx(
        TEST_AUTHORITATIVE_LEFT_CAN_JOINT_POSITION_RAD
    )
    assert len(can_bridge.sent_frames) == 0


def test_native_openarm_adapter_checks_swept_self_collision_before_can_send() -> None:
    can_bridge = FakeOpenArmCanBridge()
    preflight_targets = []

    def allow_self_collision(target_positions, _request):
        preflight_targets.append(dict(target_positions))
        return None

    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=NativeOpenArmAdapter(
            config=RobotGatewayAdapterConfig(adapter_kind="openarm_native"),
            can_bridge=can_bridge,
            safety_preflight=allow_self_collision,
            joint_position_reader=FakeJointPositionReader(
                {TEST_RIGHT_CAN_JOINT_NAME: TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD}
            ),
            joint_rotation_calibration=build_identity_openarm_joint_rotation_calibration(
                ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES
            ),
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            delta_rad=TEST_RIGHT_CAN_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert ack.accepted is True
    assert len(preflight_targets) == 2
    assert preflight_targets[0][TEST_RIGHT_CAN_JOINT_NAME] == pytest.approx(
        TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD
        + (TEST_RIGHT_CAN_JOINT_DELTA_RAD / 2.0)
    )
    assert preflight_targets[1][TEST_RIGHT_CAN_JOINT_NAME] == pytest.approx(
        TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD + TEST_RIGHT_CAN_JOINT_DELTA_RAD
    )
    assert len(can_bridge.sent_frames) == 1


def test_native_openarm_adapter_rejects_gripper_jog_until_collision_mapping_exists() -> None:
    can_bridge = FakeOpenArmCanBridge()
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=_native_openarm_adapter_allowing_unvalidated_self_collision(
            can_bridge
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name="openarm_right_finger_joint1",
            delta_rad=TEST_RIGHT_CAN_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert ack.accepted is False
    assert ack.reason == ROBOT_GATEWAY_JOINT_JOG_GRIPPER_COLLISION_MAPPING_REQUIRED_REASON
    assert len(can_bridge.sent_frames) == 0


def test_native_openarm_state_reports_hardware_motion_safety_readiness() -> None:
    def allow_self_collision(_target_positions, _request):
        return None

    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=NativeOpenArmAdapter(
            config=RobotGatewayAdapterConfig(adapter_kind="openarm_native"),
            can_bridge=FakeOpenArmCanBridge(),
            safety_preflight=allow_self_collision,
            joint_position_reader=FakeJointPositionReader(),
            joint_rotation_calibration=build_identity_openarm_joint_rotation_calibration(
                ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES
            ),
        ),
    )

    state = runtime.read_state()

    assert state.hardware_motion_safety.motion_ready is True
    assert state.hardware_motion_safety.authoritative_joint_feedback_ready is True
    assert state.hardware_motion_safety.joint_rotation_calibration_ready is True
    assert state.hardware_motion_safety.joint_rotation_calibration_id is not None
    assert state.hardware_motion_safety.self_collision_preflight_ready is True
    assert state.hardware_motion_safety.gripper_motion_enabled is False


def test_native_openarm_state_preserves_authoritative_joint_telemetry() -> None:
    def allow_self_collision(_target_positions, _request):
        return None

    def read_joint_telemetry(joint_names: tuple[str, ...]):
        return {
            joint_name: OpenArmCanJointState(
                position_rad=TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
                velocity_rad_per_sec=TEST_CURRENT_RIGHT_CAN_JOINT_VELOCITY_RAD_PER_SEC,
                torque_nm=TEST_CURRENT_RIGHT_CAN_JOINT_TORQUE_NM,
                temp_mos_c=TEST_CURRENT_RIGHT_CAN_JOINT_TEMP_MOS_C,
                temp_rotor_c=TEST_CURRENT_RIGHT_CAN_JOINT_TEMP_ROTOR_C,
            )
            for joint_name in joint_names
        }

    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=NativeOpenArmAdapter(
            config=RobotGatewayAdapterConfig(adapter_kind="openarm_native"),
            can_bridge=FakeOpenArmCanBridge(),
            safety_preflight=allow_self_collision,
            joint_telemetry_reader=read_joint_telemetry,
            joint_rotation_calibration=build_identity_openarm_joint_rotation_calibration(
                ROBOT_GATEWAY_DEFAULT_OPENARM_JOINT_NAMES
            ),
        ),
    )

    state = runtime.read_state()

    joint_telemetry = state.joint_telemetry[TEST_RIGHT_CAN_JOINT_NAME]
    assert state.joint_positions_rad[TEST_RIGHT_CAN_JOINT_NAME] == pytest.approx(
        TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
    )
    assert joint_telemetry.position_rad == pytest.approx(
        TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
    )
    assert joint_telemetry.velocity_rad_per_sec == pytest.approx(
        TEST_CURRENT_RIGHT_CAN_JOINT_VELOCITY_RAD_PER_SEC,
    )
    assert joint_telemetry.torque_nm == pytest.approx(
        TEST_CURRENT_RIGHT_CAN_JOINT_TORQUE_NM,
    )
    assert joint_telemetry.temp_mos_c == TEST_CURRENT_RIGHT_CAN_JOINT_TEMP_MOS_C
    assert joint_telemetry.temp_rotor_c == TEST_CURRENT_RIGHT_CAN_JOINT_TEMP_ROTOR_C
    assert joint_telemetry.fault_code is None


def test_native_openarm_adapter_rejects_physical_joint_limit_before_can_send() -> None:
    can_bridge = FakeOpenArmCanBridge()
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=_native_openarm_adapter_allowing_unvalidated_self_collision(
            can_bridge,
            joint_position_reader=FakeJointPositionReader(
                {"openarm_right_joint1": TEST_UNSAFE_RIGHT_CAN_JOINT_POSITION_RAD}
            ),
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    ack = runtime.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name="openarm_right_joint1",
            current_position_rad=TEST_UNSAFE_RIGHT_CAN_JOINT_POSITION_RAD,
            delta_rad=TEST_RIGHT_CAN_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert ack.accepted is False
    assert ack.reason == ROBOT_GATEWAY_JOINT_JOG_POSITION_LIMIT_REASON
    assert len(can_bridge.sent_frames) == 0


def test_openarm_can_bridge_uses_python_can_compatible_xoq_bus() -> None:
    can_module = FakePythonCanModule()
    bridge = OpenArmCanBridge(
        OpenArmCanBridgeConfig(
            interface="xoq",
            can_fd=True,
            bus_channels={
                ROBOT_GATEWAY_OPENARM_CAN_RIGHT_LOGICAL_BUS: "right-xoq-channel",
            },
        ),
        can_module=can_module,
    )
    runtime = _build_control_runtime_with_lease()
    plan = runtime.prepare_joint_jog_can_dry_run(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_RIGHT_CAN_JOINT_NAME,
            delta_rad=TEST_RIGHT_CAN_JOINT_DELTA_RAD,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert plan.frame is not None
    bridge.send_frame(plan.frame)

    assert len(can_module.created_buses) == 1
    bus = can_module.created_buses[0]
    assert bus.kwargs == {
        "channel": "right-xoq-channel",
        "fd": True,
        "interface": "xoq",
    }
    assert len(bus.sent_messages) == 1
    message = bus.sent_messages[0]
    assert message.kwargs["arbitration_id"] == plan.frame.send_can_id
    assert message.kwargs["data"] == bytes(plan.frame.data_bytes)
    assert message.kwargs["is_extended_id"] is False
    assert message.kwargs["is_fd"] is True


def test_openarm_can_bridge_enables_selected_joint_motor() -> None:
    can_module = FakePythonCanModule()
    bridge = OpenArmCanBridge(
        OpenArmCanBridgeConfig(
            interface="xoq",
            can_fd=True,
            bus_channels={
                ROBOT_GATEWAY_OPENARM_CAN_RIGHT_LOGICAL_BUS: "right-xoq-channel",
            },
        ),
        can_module=can_module,
    )

    bridge.enable_joint(TEST_RIGHT_CAN_JOINT_NAME)

    bus = can_module.created_buses[0]
    assert len(bus.sent_messages) == 1
    message = bus.sent_messages[0]
    assert message.kwargs["arbitration_id"] == ROBOT_GATEWAY_OPENARM_CAN_SEND_IDS[
        TEST_RIGHT_CAN_MOTOR_INDEX
    ]
    assert message.kwargs["data"] == bytes(
        [ROBOT_GATEWAY_OPENARM_CAN_BYTE_MASK]
        * (ROBOT_GATEWAY_OPENARM_CAN_DLC_BYTES - 1)
        + [ROBOT_GATEWAY_OPENARM_CAN_ENABLE_COMMAND]
    )
    assert message.kwargs["is_extended_id"] is False
    assert message.kwargs["is_fd"] is True


def test_openarm_can_bridge_reads_authoritative_joint_position_from_python_can() -> None:
    recv_can_id = ROBOT_GATEWAY_OPENARM_CAN_RECV_IDS[TEST_RIGHT_CAN_MOTOR_INDEX]
    send_can_id = ROBOT_GATEWAY_OPENARM_CAN_SEND_IDS[TEST_RIGHT_CAN_MOTOR_INDEX]
    can_module = FakePythonCanModule(
        state_positions_by_recv_id={
            recv_can_id: TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
        }
    )
    bridge = OpenArmCanBridge(
        OpenArmCanBridgeConfig(
            interface="xoq",
            can_fd=True,
            bus_channels={
                ROBOT_GATEWAY_OPENARM_CAN_RIGHT_LOGICAL_BUS: "right-xoq-channel",
            },
        ),
        can_module=can_module,
    )

    positions = bridge.read_joint_positions_rad((TEST_RIGHT_CAN_JOINT_NAME,))

    assert positions[TEST_RIGHT_CAN_JOINT_NAME] == pytest.approx(
        TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
        abs=1e-3,
    )
    bus = can_module.created_buses[0]
    assert bus.sent_messages[0].kwargs["arbitration_id"] == ROBOT_GATEWAY_OPENARM_CAN_PARAM_ID
    assert bus.sent_messages[0].kwargs["data"][0] == send_can_id
    assert bus.sent_messages[0].kwargs["data"][2] == ROBOT_GATEWAY_OPENARM_CAN_REFRESH_COMMAND


def test_openarm_can_bridge_reads_authoritative_joint_telemetry_from_python_can() -> None:
    recv_can_id = ROBOT_GATEWAY_OPENARM_CAN_RECV_IDS[TEST_RIGHT_CAN_MOTOR_INDEX]
    can_module = FakePythonCanModule(
        state_telemetry_by_recv_id={
            recv_can_id: {
                "position_rad": TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
                "velocity_rad_per_sec": TEST_CURRENT_RIGHT_CAN_JOINT_VELOCITY_RAD_PER_SEC,
                "torque_nm": TEST_CURRENT_RIGHT_CAN_JOINT_TORQUE_NM,
                "temp_mos_c": TEST_CURRENT_RIGHT_CAN_JOINT_TEMP_MOS_C,
                "temp_rotor_c": TEST_CURRENT_RIGHT_CAN_JOINT_TEMP_ROTOR_C,
                "motor_type": ROBOT_GATEWAY_OPENARM_CAN_MOTOR_TYPES[
                    TEST_RIGHT_CAN_MOTOR_INDEX
                ],
            },
        }
    )
    bridge = OpenArmCanBridge(
        OpenArmCanBridgeConfig(
            interface="xoq",
            can_fd=True,
            bus_channels={
                ROBOT_GATEWAY_OPENARM_CAN_RIGHT_LOGICAL_BUS: "right-xoq-channel",
            },
        ),
        can_module=can_module,
    )

    joint_states = bridge.read_joint_states((TEST_RIGHT_CAN_JOINT_NAME,))

    joint_state = joint_states[TEST_RIGHT_CAN_JOINT_NAME]
    assert joint_state.position_rad == pytest.approx(
        TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
        abs=1e-3,
    )
    assert joint_state.velocity_rad_per_sec == pytest.approx(
        TEST_CURRENT_RIGHT_CAN_JOINT_VELOCITY_RAD_PER_SEC,
        abs=1e-2,
    )
    assert joint_state.torque_nm == pytest.approx(
        TEST_CURRENT_RIGHT_CAN_JOINT_TORQUE_NM,
        abs=1e-2,
    )
    assert joint_state.temp_mos_c == TEST_CURRENT_RIGHT_CAN_JOINT_TEMP_MOS_C
    assert joint_state.temp_rotor_c == TEST_CURRENT_RIGHT_CAN_JOINT_TEMP_ROTOR_C
    assert joint_state.fault_code is None


def test_openarm_can_bridge_supports_injected_state_decoder() -> None:
    recv_can_id = ROBOT_GATEWAY_OPENARM_CAN_RECV_IDS[TEST_RIGHT_CAN_MOTOR_INDEX]
    decoded_motor_types: list[str] = []

    def decode_state(_data: bytes | bytearray, motor_type: str) -> OpenArmCanJointState:
        decoded_motor_types.append(motor_type)
        return OpenArmCanJointState(
            position_rad=TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
            velocity_rad_per_sec=TEST_CURRENT_RIGHT_CAN_JOINT_VELOCITY_RAD_PER_SEC,
            torque_nm=TEST_CURRENT_RIGHT_CAN_JOINT_TORQUE_NM,
            temp_mos_c=TEST_CURRENT_RIGHT_CAN_JOINT_TEMP_MOS_C,
            temp_rotor_c=TEST_CURRENT_RIGHT_CAN_JOINT_TEMP_ROTOR_C,
        )

    bridge = OpenArmCanBridge(
        OpenArmCanBridgeConfig(
            interface="xoq",
            can_fd=True,
            bus_channels={
                ROBOT_GATEWAY_OPENARM_CAN_RIGHT_LOGICAL_BUS: "right-xoq-channel",
            },
        ),
        can_module=FakePythonCanModule(
            state_raw_data_by_recv_id={
                recv_can_id: b"decoder-specific-payload",
            },
        ),
        state_decoder=decode_state,
    )

    joint_states = bridge.read_joint_states((TEST_RIGHT_CAN_JOINT_NAME,))

    assert decoded_motor_types == [
        ROBOT_GATEWAY_OPENARM_CAN_MOTOR_TYPES[TEST_RIGHT_CAN_MOTOR_INDEX]
    ]
    assert joint_states[TEST_RIGHT_CAN_JOINT_NAME].position_rad == pytest.approx(
        TEST_CURRENT_RIGHT_CAN_JOINT_POSITION_RAD,
    )


def test_openarm_can_bridge_rejects_malformed_state_response() -> None:
    recv_can_id = ROBOT_GATEWAY_OPENARM_CAN_RECV_IDS[TEST_RIGHT_CAN_MOTOR_INDEX]
    bridge = OpenArmCanBridge(
        OpenArmCanBridgeConfig(
            interface="xoq",
            can_fd=True,
            bus_channels={
                ROBOT_GATEWAY_OPENARM_CAN_RIGHT_LOGICAL_BUS: "right-xoq-channel",
            },
        ),
        can_module=FakePythonCanModule(
            state_raw_data_by_recv_id={
                recv_can_id: b"\x00",
            },
        ),
    )

    with pytest.raises(OpenArmCanTransportError, match="too short"):
        bridge.read_joint_states((TEST_RIGHT_CAN_JOINT_NAME,))


def test_robot_gateway_can_dry_run_keeps_control_and_lease_gates() -> None:
    observe_runtime = RobotGatewayRuntime()
    control_runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=FakeOpenArmAdapter(),
    )

    observe_plan = observe_runtime.prepare_joint_jog_can_dry_run(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_FIRST_JOINT_NAME, delta_rad=TEST_JOINT_DELTA_RAD
        )
    )
    no_lease_plan = control_runtime.prepare_joint_jog_can_dry_run(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name=TEST_FIRST_JOINT_NAME, delta_rad=TEST_JOINT_DELTA_RAD
        )
    )

    assert observe_plan.accepted is False
    assert observe_plan.reason == "Gateway is in observe mode."
    assert no_lease_plan.accepted is False
    assert no_lease_plan.reason == "No active control lease."


def test_robot_gateway_can_dry_run_rejects_unmapped_joint_names() -> None:
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=FakeOpenArmAdapter(
            RobotGatewayAdapterConfig(
                joint_names=(
                    TEST_FIRST_JOINT_NAME,
                    "custom_joint_without_openarm_can_mapping",
                )
            )
        ),
    )
    runtime.request_lease(RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID))

    plan = runtime.prepare_joint_jog_can_dry_run(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name="custom_joint_without_openarm_can_mapping",
            delta_rad=TEST_JOINT_DELTA_RAD,
        )
    )

    assert plan.accepted is False
    assert (
        plan.reason
        == "Joint is not mapped to an OpenArm CAN motor: custom_joint_without_openarm_can_mapping"
    )
    assert plan.frame is None


def test_robot_gateway_exposes_openarm_point_cloud_frame() -> None:
    runtime = RobotGatewayRuntime()

    frame = runtime.read_point_cloud(ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID)

    assert frame.camera_id == ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID
    assert frame.coordinate_frame == "robot_world"
    assert frame.intrinsics.width == ROBOT_GATEWAY_FAKE_POINT_CLOUD_WIDTH
    assert (
        len(frame.points_xyz)
        == ROBOT_GATEWAY_FAKE_POINT_CLOUD_WIDTH * ROBOT_GATEWAY_FAKE_POINT_CLOUD_HEIGHT
    )
    assert len(frame.colors_rgb) == len(frame.points_xyz)


def test_robot_gateway_adapter_factory_supports_openarm_backends() -> None:
    ros2_runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(
            adapter_config=RobotGatewayAdapterConfig(adapter_kind="openarm_ros2")
        )
    )
    native_runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(
            adapter_config=RobotGatewayAdapterConfig(adapter_kind="openarm_native")
        )
    )

    assert (
        ros2_runtime.get_manifest().profiles[0].adapter_id
        == ROBOT_GATEWAY_OPENARM_ROS2_ADAPTER_ID
    )
    assert (
        ros2_runtime.get_manifest().profiles[0].teleoperation_mode
        == ROBOT_GATEWAY_TELEOPERATION_MODE_REAL_HARDWARE
    )
    assert (
        native_runtime.get_manifest().profiles[0].adapter_id
        == ROBOT_GATEWAY_OPENARM_NATIVE_ADAPTER_ID
    )
    assert (
        native_runtime.get_manifest().profiles[0].teleoperation_mode
        == ROBOT_GATEWAY_TELEOPERATION_MODE_REAL_HARDWARE
    )


def test_robot_gateway_adapter_factory_wires_native_self_collision_preflight() -> None:
    def allow_motion_preflight(_target_positions, _request):
        return None

    with patch(
        "backend.robot_gateway.adapters.build_default_openarm_self_collision_preflight",
        return_value=allow_motion_preflight,
    ) as build_preflight:
        adapter = build_robot_gateway_adapter(
            RobotGatewayAdapterConfig(adapter_kind="openarm_native")
        )

    assert isinstance(adapter, NativeOpenArmAdapter)
    assert build_preflight.call_count == 1
    assert adapter._safety_preflight is allow_motion_preflight


def test_robot_gateway_adapter_factory_keeps_explicit_unvalidated_override() -> None:
    with patch(
        "backend.robot_gateway.adapters.build_default_openarm_self_collision_preflight",
    ) as build_preflight:
        adapter = build_robot_gateway_adapter(
            RobotGatewayAdapterConfig(
                adapter_kind="openarm_native",
                allow_unvalidated_self_collision=True,
            )
        )

    assert isinstance(adapter, NativeOpenArmAdapter)
    assert build_preflight.call_count == 0
    assert adapter._safety_preflight is None


def test_robot_gateway_runtime_can_be_enabled_from_env(monkeypatch) -> None:
    monkeypatch.setenv("URDF_ROBOT_GATEWAY_RUNTIME_MODE", "control")
    monkeypatch.setenv("URDF_ROBOT_GATEWAY_ADAPTER", "openarm_native")
    monkeypatch.setenv("URDF_ROBOT_GATEWAY_ROBOT_ID", "openarm-test")

    runtime = build_robot_gateway_runtime_from_env()
    manifest = runtime.get_manifest()
    session = runtime.get_session()

    assert manifest.capabilities.control is True
    assert manifest.profiles[0].adapter_id == ROBOT_GATEWAY_OPENARM_NATIVE_ADAPTER_ID
    assert (
        manifest.profiles[0].teleoperation_mode
        == ROBOT_GATEWAY_TELEOPERATION_MODE_REAL_HARDWARE
    )
    assert manifest.profiles[0].robot_id == "openarm-test"
    assert session.robot_id == "openarm-test"
    assert session.model_robot_id == ROBOT_GATEWAY_OPENARM_ROBOT_ID
    assert session.runtime_mode == "control"
    assert session.teleoperation_mode == ROBOT_GATEWAY_TELEOPERATION_MODE_REAL_HARDWARE


def test_robot_gateway_runtime_can_select_explicit_lerobot_robot_from_env(
    monkeypatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("URDF_ROBOT_GATEWAY_RUNTIME_MODE", "control")
    monkeypatch.setenv("URDF_ROBOT_GATEWAY_ADAPTER", ROBOT_GATEWAY_LEROBOT_ADAPTER_ID)
    monkeypatch.setenv(ROBOT_GATEWAY_LEROBOT_ROBOT_TYPE_ENV, "so100_follower")
    monkeypatch.setenv(ROBOT_GATEWAY_LEROBOT_PORT_ENV, "/dev/serial/by-id/so100")
    monkeypatch.setenv(ROBOT_GATEWAY_LEROBOT_ID_ENV, "my_awesome_follower_arm")
    monkeypatch.setenv(ROBOT_GATEWAY_LEROBOT_CALIBRATION_DIR_ENV, str(tmp_path))

    runtime = build_robot_gateway_runtime_from_env()
    manifest = runtime.get_manifest()
    session = runtime.get_session()

    assert manifest.capabilities.control is True
    assert manifest.profiles[0].id == "so100_follower_joint_jog"
    assert manifest.profiles[0].robot_id == "so100"
    assert session.robot_id == "so100"
    assert session.model_robot_id == "so100"
    assert manifest.profiles[0].adapter_id == ROBOT_GATEWAY_LEROBOT_ADAPTER_ID
    assert manifest.profiles[0].controlled_joint_names == list(
        TEST_LEROBOT_SO_STYLE_JOINT_NAMES
    )
    assert manifest.camera_streams == []


def test_robot_gateway_session_separates_lerobot_unit_and_model_ids(
    monkeypatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("URDF_ROBOT_GATEWAY_RUNTIME_MODE", "control")
    monkeypatch.setenv("URDF_ROBOT_GATEWAY_ADAPTER", ROBOT_GATEWAY_LEROBOT_ADAPTER_ID)
    monkeypatch.setenv(ROBOT_GATEWAY_ROBOT_ID_ENV, "so100-left-1")
    monkeypatch.setenv(ROBOT_GATEWAY_MODEL_ROBOT_ID_ENV, "so100")
    monkeypatch.setenv(ROBOT_GATEWAY_MODEL_ROBOT_ALIASES_ENV, "LeKiwi,so101")
    monkeypatch.setenv(ROBOT_GATEWAY_LEROBOT_ROBOT_TYPE_ENV, "so100_follower")
    monkeypatch.setenv(ROBOT_GATEWAY_LEROBOT_PORT_ENV, "/dev/serial/by-id/so100-left-1")
    monkeypatch.setenv(ROBOT_GATEWAY_LEROBOT_CALIBRATION_DIR_ENV, str(tmp_path))

    session = build_robot_gateway_runtime_from_env().get_session()

    assert session.robot_id == "so100-left-1"
    assert session.model_robot_id == "so100"
    assert session.model_robot_aliases == ["LeKiwi", "so101"]


def test_robot_gateway_runtime_rejects_removed_lerobot_adapter_id(
    monkeypatch,
) -> None:
    monkeypatch.setenv("URDF_ROBOT_GATEWAY_ADAPTER", "lerobot_so100")

    with pytest.raises(ValueError, match="Unsupported URDF_ROBOT_GATEWAY_ADAPTER"):
        build_robot_gateway_runtime_from_env()


def test_robot_gateway_runtime_maps_model_joints_to_lerobot_hardware_from_env(
    monkeypatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("URDF_ROBOT_GATEWAY_RUNTIME_MODE", "control")
    monkeypatch.setenv("URDF_ROBOT_GATEWAY_ADAPTER", ROBOT_GATEWAY_LEROBOT_ADAPTER_ID)
    monkeypatch.setenv(ROBOT_GATEWAY_LEROBOT_ROBOT_TYPE_ENV, "so100_follower")
    monkeypatch.setenv(ROBOT_GATEWAY_ROBOT_ID_ENV, "lekiwi")
    monkeypatch.setenv(
        ROBOT_GATEWAY_JOINT_NAMES_ENV,
        ROBOT_GATEWAY_JOINT_NAMES_SEPARATOR.join(
            TEST_LEROBOT_LEKIWI_MODEL_JOINT_NAMES
        ),
    )
    monkeypatch.setenv(
        ROBOT_GATEWAY_LEROBOT_HARDWARE_JOINT_NAMES_ENV,
        ROBOT_GATEWAY_JOINT_NAMES_SEPARATOR.join(TEST_LEROBOT_SO_STYLE_JOINT_NAMES),
    )
    monkeypatch.setenv(ROBOT_GATEWAY_LEROBOT_PORT_ENV, "/dev/serial/by-id/lekiwi-arm")
    monkeypatch.setenv(ROBOT_GATEWAY_LEROBOT_ID_ENV, "my_lekiwi_arm")
    monkeypatch.setenv(ROBOT_GATEWAY_LEROBOT_CALIBRATION_DIR_ENV, str(tmp_path))

    runtime = build_robot_gateway_runtime_from_env()
    manifest = runtime.get_manifest()

    assert manifest.profiles[0].id == "so100_follower_joint_jog"
    assert manifest.profiles[0].robot_id == "lekiwi"
    assert manifest.profiles[0].adapter_id == ROBOT_GATEWAY_LEROBOT_ADAPTER_ID
    assert manifest.profiles[0].hardware_device_key == "/dev/serial/by-id/lekiwi-arm"
    assert manifest.profiles[0].controlled_joint_names == list(
        TEST_LEROBOT_LEKIWI_MODEL_JOINT_NAMES
    )


def test_lerobot_adapter_reads_and_jogs_serial_robot() -> None:
    fake_robot = _FakeSO100Robot()
    adapter = LeRobotAdapter(
        RobotGatewayAdapterConfig(
            adapter_kind=ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
            robot_id="so100-test",
            joint_names=TEST_LEROBOT_SO_STYLE_JOINT_NAMES,
            lerobot_port="/dev/serial/by-id/so100",
            lerobot_robot_type="so100_follower",
        ),
        robot_factory=lambda _config: fake_robot,
    )

    state = adapter.read_state()
    ack = adapter.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name="shoulder_pan",
            delta_rad=0.01,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert state.profile_id == "so100_follower_joint_jog"
    assert state.heartbeat_ok is True
    assert state.joint_positions_rad["shoulder_pan"] == pytest.approx(
        -math.radians(10.0)
    )
    assert state.hardware_motion_safety.motion_ready is True
    assert state.hardware_motion_safety.joint_rotation_calibration_ready is True
    assert state.hardware_motion_safety.joint_rotation_calibration_required is False
    assert state.hardware_motion_safety.joint_rotation_calibration_id == (
        "fake-so100-calibration"
    )
    assert fake_robot.is_connected is True
    assert fake_robot.connect_calibrate_args == [False]
    assert ack.accepted is True
    assert ack.applied_delta_rad == pytest.approx(0.01)
    assert fake_robot.actions[-1]["shoulder_pan.pos"] == pytest.approx(
        math.degrees(math.radians(10.0) - 0.01)
    )


def test_lerobot_adapter_rejects_motion_until_lerobot_reports_calibrated() -> None:
    fake_robot = _FakeSO100Robot()
    fake_robot.calibrated = False
    adapter = LeRobotAdapter(
        RobotGatewayAdapterConfig(
            adapter_kind=ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
            robot_id="so100-test",
            joint_names=TEST_LEROBOT_SO_STYLE_JOINT_NAMES,
            lerobot_port="/dev/serial/by-id/so100",
            lerobot_robot_type="so100_follower",
        ),
        robot_factory=lambda _config: fake_robot,
    )

    state = adapter.read_state()
    ack = adapter.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name="shoulder_pan",
            delta_rad=0.01,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert state.heartbeat_ok is True
    assert state.hardware_motion_safety.motion_ready is False
    assert state.hardware_motion_safety.joint_rotation_calibration_ready is False
    assert state.hardware_motion_safety.joint_rotation_calibration_required is True
    assert (
        state.hardware_motion_safety.last_reject_reason
        == ROBOT_GATEWAY_LEROBOT_CALIBRATION_REQUIRED_REASON
    )
    assert ack.accepted is False
    assert ack.reason == ROBOT_GATEWAY_LEROBOT_CALIBRATION_REQUIRED_REASON
    assert fake_robot.connect_calibrate_args == [False]
    assert fake_robot.actions == []


def test_lerobot_adapter_does_not_report_calibration_required_for_read_failure() -> None:
    fake_robot = _FakeSO100Robot()
    fake_robot.calibrated = False
    fake_robot.observation_error = RuntimeError("Port is in use")
    adapter = LeRobotAdapter(
        RobotGatewayAdapterConfig(
            adapter_kind=ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
            robot_id="so100-test",
            joint_names=TEST_LEROBOT_SO_STYLE_JOINT_NAMES,
            lerobot_port="/dev/serial/by-id/so100",
            lerobot_robot_type="so100_follower",
        ),
        robot_factory=lambda _config: fake_robot,
    )

    state = adapter.read_state()

    assert state.heartbeat_ok is False
    assert state.hardware_motion_safety.motion_ready is False
    assert state.hardware_motion_safety.joint_rotation_calibration_ready is False
    assert state.hardware_motion_safety.joint_rotation_calibration_required is False
    assert state.hardware_motion_safety.last_reject_reason == (
        "LeRobot state read failed: Port is in use"
    )


def test_lerobot_adapter_does_not_require_calibration_file_for_calibrated_device() -> None:
    fake_robot = _FakeSO100Robot()
    fake_robot.calibration = {}
    adapter = LeRobotAdapter(
        RobotGatewayAdapterConfig(
            adapter_kind=ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
            robot_id="precalibrated-so100",
            joint_names=TEST_LEROBOT_SO_STYLE_JOINT_NAMES,
            lerobot_port="/dev/serial/by-id/so100",
            lerobot_robot_type="so100_follower",
        ),
        robot_factory=lambda _config: fake_robot,
    )

    state = adapter.read_state()

    assert state.heartbeat_ok is True
    assert state.hardware_motion_safety.motion_ready is True
    assert state.hardware_motion_safety.joint_rotation_calibration_ready is True
    assert state.hardware_motion_safety.joint_rotation_calibration_required is False
    assert state.hardware_motion_safety.last_reject_reason is None


def test_lerobot_adapter_reloads_active_calibration_file(tmp_path) -> None:
    calibration_path = tmp_path / "active-follower.json"
    calibration_path.write_text(
        json.dumps({"shoulder_pan": {"id": 1}}),
        encoding="utf-8",
    )
    fake_robot = _FakeSO100Robot()
    fake_robot.calibration_fpath = str(calibration_path)
    adapter = LeRobotAdapter(
        RobotGatewayAdapterConfig(
            adapter_kind=ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
            robot_id="active-follower",
            joint_names=TEST_LEROBOT_SO_STYLE_JOINT_NAMES,
            lerobot_port="/dev/serial/by-id/so100",
            lerobot_robot_type="so100_follower",
        ),
        robot_factory=lambda _config: fake_robot,
    )

    adapter.read_state()
    result = adapter.reload_lerobot_calibration_file(calibration_path)

    assert result.matched is True
    assert result.applied is True
    assert result.message == "Reloaded selected calibration file."
    assert fake_robot.loaded_calibration_paths == [str(calibration_path)]
    assert fake_robot.is_connected is True


def test_lerobot_calibration_command_uses_gateway_config(tmp_path) -> None:
    command = build_lerobot_calibration_command(
        RobotGatewayAdapterConfig(
            adapter_kind=ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
            robot_id="fallback-id",
            lerobot_port="/dev/serial/by-id/so100",
            lerobot_robot_type="so100_follower",
            lerobot_id="my_so100",
            lerobot_calibration_dir=tmp_path / "calibration",
            lerobot_config_json=json.dumps(
                {
                    "max_relative_target": 5,
                    "id": "ignored",
                    "port": "ignored",
                }
            ),
        )
    )

    assert "--robot.type=so100_follower" in command
    assert "--robot.port=/dev/serial/by-id/so100" in command
    assert "--robot.id=my_so100" in command
    assert f"--robot.calibration_dir={tmp_path / 'calibration'}" in command
    assert "--robot.max_relative_target=5" in command


def test_lerobot_calibration_command_can_use_selected_catalog_source(tmp_path) -> None:
    selected_dir = tmp_path / "teleoperators" / "so100_leader"
    selected_source = RobotGatewayLeRobotCalibrationSource(
        category="teleoperators",
        profileId="so100_leader",
        calibrationId="shared_arm",
        calibrationDir=str(selected_dir),
        groupId="all",
    )

    command = build_lerobot_calibration_command(
        RobotGatewayAdapterConfig(
            adapter_kind=ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
            robot_id="fallback-id",
            lerobot_port="/dev/serial/by-id/so100",
            lerobot_robot_type="so100_follower",
            lerobot_id="configured-id",
            lerobot_calibration_dir=tmp_path / "configured",
        ),
        calibration_source=selected_source,
    )

    assert "--robot.type=so100_follower" in command
    assert "--robot.id=shared_arm" in command
    assert f"--robot.calibration_dir={selected_dir}" in command
    assert "--robot.id=configured-id" not in command


def test_lerobot_calibration_catalog_lists_structured_and_extra_dirs(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calibration_root = tmp_path / "calibration-root"
    robot_dir = calibration_root / "robots" / "so100_follower"
    teleop_dir = calibration_root / "teleoperators" / "so100_leader"
    extra_dir = tmp_path / "custom-calibration"
    robot_dir.mkdir(parents=True)
    teleop_dir.mkdir(parents=True)
    extra_dir.mkdir()
    calibration_payload = {
        joint_name: {"id": motor_id}
        for joint_name, motor_id in zip(
            TEST_LEROBOT_SO_STYLE_JOINT_NAMES,
            TEST_LEROBOT_SO_STYLE_MOTOR_IDS,
            strict=True,
        )
    }
    (robot_dir / "so100-left-1.json").write_text(
        json.dumps(calibration_payload),
        encoding="utf-8",
    )
    (teleop_dir / "leader-blue.json").write_text(
        json.dumps(calibration_payload),
        encoding="utf-8",
    )
    (extra_dir / "reused-arm.json").write_text(
        json.dumps(calibration_payload),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        lerobot_calibration_catalog,
        "ROBOT_GATEWAY_LEROBOT_CALIBRATION_ROOT_DEFAULT",
        str(calibration_root),
    )

    catalog = list_lerobot_calibration_catalog(extra_calibration_dirs=[extra_dir])
    entries_by_id = {entry.id: entry for entry in catalog.entries}

    assert set(entries_by_id) == {
        "robots:custom-calibration:reused-arm:all",
        "robots:so100_follower:so100-left-1:all",
        "teleoperators:so100_leader:leader-blue:all",
    }
    assert entries_by_id[
        "robots:so100_follower:so100-left-1:all"
    ].motor_ids == list(TEST_LEROBOT_SO_STYLE_MOTOR_IDS)
    assert entries_by_id[
        "robots:custom-calibration:reused-arm:all"
    ].calibration_dir == str(extra_dir)


def test_lerobot_calibration_open_resolves_selected_file(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    opened: list[list[str]] = []
    calibration_dir = tmp_path / "so100_follower"
    calibration_dir.mkdir()
    calibration_path = calibration_dir / "mixed-arm.json"
    calibration_path.write_text(
        json.dumps({"shoulder_pan": {"id": 1}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        robot_gateway_config_file.subprocess,
        "Popen",
        lambda command, **_kwargs: opened.append(command),
    )
    monkeypatch.setattr(
        robot_gateway_config_file.shutil,
        "which",
        lambda cmd: cmd if cmd == "cursor" else None,
    )

    result = _run_api(
        robot_gateway_api.open_robot_gateway_lerobot_calibration(
            RobotGatewayLeRobotCalibrationStartRequest(
                calibrationSource=RobotGatewayLeRobotCalibrationSource(
                    category="robots",
                    profileId="so100_follower",
                    calibrationId="mixed-arm",
                    calibrationDir=str(calibration_dir),
                    groupId="all",
                )
            )
        )
    )

    assert result.opened is True
    assert result.exists is True
    assert result.path == str(calibration_path)
    assert result.message == "Opened LeRobot calibration file."
    assert opened == [["cursor", "--reuse-window", str(calibration_path)]]


def test_lerobot_calibration_sync_releases_only_selected_leader_reader(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    released_requests: list[dict[str, object]] = []
    calibration_dir = tmp_path / "openarm_mini"
    calibration_dir.mkdir()
    calibration_path = calibration_dir / "bimanual.json"
    calibration_path.write_text(
        json.dumps({"right_joint_1": {"id": 1}}),
        encoding="utf-8",
    )

    def fake_release(**kwargs: object) -> robot_gateway_api.OpenArmLeaderReleaseResult:
        released_requests.append(kwargs)
        return robot_gateway_api.OpenArmLeaderReleaseResult(released=1)

    monkeypatch.setattr(
        robot_gateway_api.openarm_leader_state_service,
        "release",
        fake_release,
    )

    result = _run_api(
        robot_gateway_api.sync_robot_gateway_lerobot_calibration_file(
            RobotGatewayLeRobotCalibrationFileSyncRequest(
                role="leader",
                lastMtimeNs=0,
                leaderPort="/dev/serial/by-id/openarm-right",
                leaderMotorIds=[1, 2, 3, 4, 5, 6, 7, 8],
                leaderMotorModel="sts3215",
                calibrationSource=RobotGatewayLeRobotCalibrationSource(
                    category="teleoperators",
                    profileId="openarm_mini",
                    calibrationId="bimanual",
                    calibrationDir=str(calibration_dir),
                    groupId="right",
                ),
            ),
        )
    )

    assert result.changed is True
    assert result.applied is True
    assert result.path == str(calibration_path)
    assert result.message == "Reloaded selected leader calibration."
    assert released_requests == [
        {
            "port": "/dev/serial/by-id/openarm-right",
            "motor_ids": [1, 2, 3, 4, 5, 6, 7, 8],
            "motor_model": "sts3215",
            "calibration_category": "teleoperators",
            "calibration_profile": "openarm_mini",
            "calibration_id": "bimanual",
            "calibration_group": "right",
        }
    ]


def test_lerobot_calibration_sync_reports_selected_group_motor_ids(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    shoulder_motor_id = 3
    elbow_motor_id = 1
    calibration_dir = tmp_path / "so100_leader"
    calibration_dir.mkdir()
    calibration_path = calibration_dir / "arm.json"
    calibration_path.write_text(
        json.dumps(
            {
                "shoulder_pan": {"id": shoulder_motor_id},
                "elbow_flex": {"id": elbow_motor_id},
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        robot_gateway_api.openarm_leader_state_service,
        "release",
        lambda **_kwargs: robot_gateway_api.OpenArmLeaderReleaseResult(released=0),
    )

    result = _run_api(
        robot_gateway_api.sync_robot_gateway_lerobot_calibration_file(
            RobotGatewayLeRobotCalibrationFileSyncRequest(
                role="leader",
                lastMtimeNs=0,
                leaderPort="/dev/serial/by-id/so100-arm",
                leaderMotorIds=[elbow_motor_id, shoulder_motor_id],
                leaderMotorModel="sts3215",
                calibrationSource=RobotGatewayLeRobotCalibrationSource(
                    category="teleoperators",
                    profileId="so100_leader",
                    calibrationId="arm",
                    calibrationDir=str(calibration_dir),
                    groupId="all",
                ),
            ),
        )
    )

    assert result.changed is True
    assert result.joint_names == ["elbow_flex", "shoulder_pan"]
    assert result.motor_ids == [elbow_motor_id, shoulder_motor_id]
    assert result.zero_positions_rad == {
        "elbow_flex": 0.0,
        "shoulder_pan": 0.0,
    }


def test_leader_state_falls_back_when_lerobot_teleoperator_type_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    generic_reader_requests: list[dict[str, object]] = []

    class MissingTeleoperatorReader:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            pass

        def read(self) -> dict[str, float]:
            raise ValueError("Couldn't find a choice class for 'so_leader'")

        def disconnect(self) -> None:
            pass

    class FakeGenericReader:
        def __init__(
            self,
            port: str,
            motor_ids: tuple[int, ...],
            motor_model: str | None,
            calibration_ref: object,
        ) -> None:
            generic_reader_requests.append(
                {
                    "port": port,
                    "motor_ids": motor_ids,
                    "motor_model": motor_model,
                    "calibration_ref": calibration_ref,
                }
            )

        def read(self) -> dict[str, float]:
            return {
                f"leader_axis_{motor_id}": float(motor_id)
                for motor_id in (1, 2, 3, 4, 5, 6)
            }

        def disconnect(self) -> None:
            pass

    monkeypatch.setattr(
        openarm_leader_state,
        "_LeRobotTeleoperatorLeaderReader",
        MissingTeleoperatorReader,
    )
    monkeypatch.setattr(
        openarm_leader_state,
        "_GenericFeetechLeaderReader",
        FakeGenericReader,
    )

    service = openarm_leader_state.OpenArmLeaderStateService()
    result = service.read_state(
        port="/dev/serial/by-id/so100-leader",
        motor_ids=[1, 2, 3, 4, 5, 6],
        motor_model="sts3215",
        calibration_category="teleoperators",
        calibration_profile="so_leader",
        calibration_id="my_awesome_leader_arm",
        calibration_group="all",
    )

    assert result.connected is True
    assert result.error is None
    assert result.joints["leader_axis_6"].position_rad == pytest.approx(
        math.radians(6)
    )
    assert result.joints["leader_axis_6"].motor_id == 6
    assert generic_reader_requests
    assert generic_reader_requests[0]["motor_ids"] == (1, 2, 3, 4, 5, 6)


def test_lerobot_calibration_start_returns_manual_command_without_terminal(
    monkeypatch,
    tmp_path,
) -> None:
    configured_port = tmp_path / "serial" / "by-id" / "so100"
    configured_port.parent.mkdir(parents=True)
    configured_port.touch()
    monkeypatch.setattr(lerobot_calibration.shutil, "which", lambda _name: None)
    monkeypatch.setattr(lerobot_calibration.Path, "is_file", lambda _self: False)

    result = start_lerobot_calibration(
        RobotGatewayAdapterConfig(
            adapter_kind=ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
            robot_id="so100-test",
            lerobot_port=str(configured_port),
            lerobot_robot_type="so100_follower",
        )
    )

    assert result.started is False
    assert result.command[0] == "lerobot-calibrate"
    assert "--robot.type=so100_follower" in result.command
    assert "Open a terminal" in result.message


def test_lerobot_calibration_start_rejects_missing_configured_port(
    tmp_path,
) -> None:
    missing_port = tmp_path / "serial" / "by-id" / "missing-so100"

    result = start_lerobot_calibration(
        RobotGatewayAdapterConfig(
            adapter_kind=ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
            robot_id="so100-test",
            lerobot_port=str(missing_port),
            lerobot_robot_type="so100_follower",
        )
    )

    assert result.started is False
    assert f"--robot.port={missing_port}" in result.command
    assert str(missing_port) in result.message
    assert "lerobot-find-port" in result.message
    assert "URDF_ROBOT_GATEWAY_LEROBOT_PORT" in result.message


def test_lerobot_leader_calibration_command_maps_follower_profile_to_teleop() -> None:
    command = build_lerobot_leader_calibration_command(
        port="/dev/serial/by-id/so100-arm",
        motor_ids=[1, 2, 3, 4, 5, 6],
        motor_model="sts3215",
        calibration_profile="so100_follower",
        calibration_id="shared_arm",
    )

    assert command[0].endswith("lerobot-calibrate")
    assert "--teleop.type=so100_leader" in command
    assert "--teleop.port=/dev/serial/by-id/so100-arm" in command
    assert "--teleop.id=shared_arm" in command
    assert all(not arg.startswith("--robot.") for arg in command)


def test_lerobot_leader_calibration_command_uses_openarm_mini_ports() -> None:
    command = build_lerobot_leader_calibration_command(
        port="/dev/serial/by-id/openarm-right",
        port_left="/dev/serial/by-id/openarm-left",
        port_right="/dev/serial/by-id/openarm-right",
        motor_ids=list(ROBOT_GATEWAY_OPENARM_MINI_MOTOR_IDS),
        motor_model=ROBOT_GATEWAY_OPENARM_MINI_MOTOR_MODEL,
        calibration_group=ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT,
        calibration_id="openarm_pair",
    )

    assert f"--teleop.type={ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE}" in command
    assert "--teleop.port_right=/dev/serial/by-id/openarm-right" in command
    assert "--teleop.port_left=/dev/serial/by-id/openarm-left" in command
    assert "--teleop.id=openarm_pair" in command
    assert all(not arg.startswith("--teleop.port=") for arg in command)


def test_lerobot_calibration_terminal_script_activates_repo_venv(monkeypatch) -> None:
    monkeypatch.setattr(
        lerobot_calibration.Path,
        "is_file",
        lambda path: str(path).endswith(".venv-lerobot/bin/activate"),
    )
    monkeypatch.setattr(
        lerobot_calibration,
        "_resolve_lerobot_cmeel_lib_path",
        lambda: Path("/tmp/urdf-studio/cmeel.prefix/lib"),
    )

    script = build_lerobot_calibration_terminal_script(
        "lerobot-calibrate --robot.type=lekiwi"
    )

    assert "cd " in script
    assert ".venv-lerobot/bin/activate" in script
    assert "export LD_LIBRARY_PATH=/tmp/urdf-studio/cmeel.prefix/lib" in script
    assert "lerobot-calibrate --robot.type=lekiwi" in script
    assert "status=$?" in script
    assert "Calibration finished. Press ENTER to close." in script
    assert "LeRobot calibration failed" in script
    assert 'exit "$status"' in script


def test_lerobot_adapter_maps_model_joint_names_to_hardware_joint_names() -> None:
    fake_robot = _FakeSO100Robot()
    adapter = LeRobotAdapter(
        RobotGatewayAdapterConfig(
            adapter_kind=ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
            robot_id="lekiwi",
            joint_names=TEST_LEROBOT_LEKIWI_MODEL_JOINT_NAMES,
            lerobot_port="/dev/serial/by-id/lekiwi-arm",
            lerobot_robot_type="so100_follower",
            lerobot_hardware_joint_names=TEST_LEROBOT_SO_STYLE_JOINT_NAMES,
        ),
        robot_factory=lambda _config: fake_robot,
    )

    state = adapter.read_state()
    ack = adapter.apply_joint_jog(
        RobotGatewayJointJogRequest(
            operator_id=TEST_OPERATOR_ID,
            joint_name="arm_shoulder_pan",
            delta_rad=0.01,
            sequence=TEST_COMMAND_SEQUENCE,
        )
    )

    assert state.profile_id == "so100_follower_joint_jog"
    assert state.joint_positions_rad["arm_shoulder_pan"] == pytest.approx(
        -math.radians(10.0)
    )
    assert ack.accepted is True
    assert fake_robot.actions[-1]["shoulder_pan.pos"] == pytest.approx(
        math.degrees(math.radians(10.0) - 0.01)
    )


def test_robot_gateway_public_manifest_redacts_direct_transport_origins() -> None:
    payload = _run_api(robot_gateway_api.get_robot_gateway_manifest()).model_dump(
        by_alias=False,
        mode="json",
    )

    assert payload["contract_version"] == "urdf-studio.teleop.v1"
    assert payload["capabilities"]["observe"] is True
    assert payload["capabilities"]["control"] is False
    assert (
        payload["profiles"][0]["teleoperation_mode"]
        == ROBOT_GATEWAY_TELEOPERATION_MODE_SIMULATED
    )
    assert payload["profiles"][0]["controlled_joint_names"]
    assert payload["camera_streams"][0]["id"] == ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID
    assert payload["camera_streams"][0]["camera_pose"] == {
        "position": list(ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_POSITION_XYZ_M),
        "rotation_rpy_deg": list(ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ROTATION_RPY_DEG),
        "scale": ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_POINT_SCALE,
        "world_frame": ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_WORLD_FRAME,
    }
    assert payload["live_transport"] is None
    assert payload["control_transport"] is None


def test_robot_gateway_authorized_manifest_exposes_transport_descriptors(
    monkeypatch,
) -> None:
    monkeypatch.setenv(ROBOT_GATEWAY_MOQ_RELAY_URL_ENV, TEST_PRIVATE_MOQ_RELAY_URL)

    with patch("backend.api.robot_gateway.runtime", RobotGatewayRuntime()):
        client = AsgiTestClient(create_app(), client=("127.0.0.1", 50000))
        response = client.get("/robot-gateway/manifest")

    assert response.status_code == 200
    payload = response.json()
    assert payload["live_transport"]["relay_url"] == TEST_PRIVATE_MOQ_RELAY_URL
    assert payload["live_transport"]["namespace"].startswith("robot-gateway/")


def test_robot_gateway_authorized_manifest_accepts_collaboration_teleop_capability(
    monkeypatch,
) -> None:
    monkeypatch.setenv(ROBOT_GATEWAY_MOQ_RELAY_URL_ENV, TEST_PRIVATE_MOQ_RELAY_URL)
    created = _create_robot_gateway_collaboration_session()
    capability = collaboration_service.issue_capability(
        created.session_id,
        CollaborationCapabilityIssueRequest(
            role="teleop_operator",
            allowed_transports=[ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_TRANSPORT],
        ),
        session_token=created.owner_token,
    )
    client = AsgiTestClient(create_app(), client=("127.0.0.1", 50000))

    with patch("backend.api.robot_gateway.runtime", RobotGatewayRuntime()):
        response = client.get(
            "/robot-gateway/manifest",
            headers={
                ROBOT_GATEWAY_DEV_PROXY_CLIENT_HOST_HEADER: TEST_REMOTE_BROWSER_HOST,
                ROBOT_GATEWAY_COLLABORATION_SESSION_HEADER: created.session_id,
                ROBOT_GATEWAY_COLLABORATION_TELEOP_CAPABILITY_HEADER: capability.capability_token,
            },
        )
        rejected_response = client.get(
            "/robot-gateway/manifest",
            headers={
                ROBOT_GATEWAY_DEV_PROXY_CLIENT_HOST_HEADER: TEST_REMOTE_BROWSER_HOST,
            },
        )

    assert response.status_code == 200
    assert response.json()["live_transport"]["relay_url"] == TEST_PRIVATE_MOQ_RELAY_URL
    assert rejected_response.status_code == 401


def test_robot_gateway_control_routes_dispatch_to_runtime() -> None:
    control_runtime = _build_control_runtime_with_lease()
    joint_jog_request = RobotGatewayJointJogRequest(
        operator_id=TEST_OPERATOR_ID,
        joint_name=TEST_FIRST_JOINT_NAME,
        delta_rad=TEST_JOINT_DELTA_RAD,
        sequence=TEST_COMMAND_SEQUENCE,
    )
    twist_request = RobotGatewayTwistRequest(
        x=TEST_TWIST_PAYLOAD["x"],
        y=TEST_TWIST_PAYLOAD["y"],
        omega=TEST_TWIST_PAYLOAD["omega"],
        sequence=TEST_COMMAND_SEQUENCE,
    )

    with patch("backend.api.robot_gateway.runtime", control_runtime):
        joint_ack = _run_api(robot_gateway_api.apply_robot_gateway_joint_jog(joint_jog_request))
        twist_ack = _run_api(robot_gateway_api.apply_robot_gateway_twist(twist_request))
        stop_ack = _run_api(robot_gateway_api.stop_robot_gateway())
        estop_ack = _run_api(robot_gateway_api.estop_robot_gateway())

    assert joint_ack.accepted is True
    assert joint_ack.applied_joint_name == TEST_FIRST_JOINT_NAME
    assert twist_ack.accepted is False
    assert twist_ack.reason == "Selected OpenArm profile does not support base twist."
    assert stop_ack.accepted is True
    assert stop_ack.reason == "safe hold requested"
    assert estop_ack.accepted is True
    assert estop_ack.reason == "e-stop latched"


def test_robot_gateway_follower_release_route_dispatches_to_runtime() -> None:
    release_runtime = SimpleNamespace(release_hardware=lambda: 1)

    with patch("backend.api.robot_gateway.runtime", release_runtime):
        client = AsgiTestClient(create_app(), client=("127.0.0.1", 50000))
        response = client.post("/robot-gateway/hardware/follower/release")

    assert response.status_code == 200
    assert response.json() == {"released": 1}


def test_robot_gateway_follower_calibration_route_releases_before_start() -> None:
    events: list[str] = []
    adapter_config = RobotGatewayAdapterConfig(
        adapter_kind=ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
        robot_id="so100-test",
        lerobot_port="/dev/serial/by-id/so100",
        lerobot_robot_type="so100_follower",
    )
    calibration_runtime = SimpleNamespace(
        config=SimpleNamespace(adapter_config=adapter_config),
        release_hardware=lambda: events.append("release"),
    )

    def start_calibration(
        config: RobotGatewayAdapterConfig,
        calibration_source=None,
    ) -> RobotGatewayLeRobotCalibrationStartResult:
        assert config is adapter_config
        assert calibration_source is None
        events.append("start")
        return RobotGatewayLeRobotCalibrationStartResult(
            started=False,
            command=["lerobot-calibrate"],
            display_command="lerobot-calibrate",
            message="Open a terminal.",
        )

    with (
        patch("backend.api.robot_gateway.runtime", calibration_runtime),
        patch(
            "backend.api.robot_gateway.start_lerobot_calibration",
            start_calibration,
        ),
    ):
        result = _run_api(robot_gateway_api.start_robot_gateway_follower_calibration())

    assert result.model_dump(by_alias=False) == {
        "started": False,
        "command": ["lerobot-calibrate"],
        "display_command": "lerobot-calibrate",
        "message": "Open a terminal.",
    }
    assert events == ["release", "start"]


def test_robot_gateway_leader_calibration_route_releases_before_start() -> None:
    events: list[str] = []
    request = robot_gateway_api.OpenArmLeaderReleaseRequest(
        port="/dev/serial/by-id/leader-arm",
        port_left="/dev/serial/by-id/openarm-left",
        port_right="/dev/serial/by-id/leader-arm",
        motor_ids=[1, 2, 3, 4, 5, 6],
        motor_model="sts3215",
        calibration_profile="so100_follower",
        calibration_id="shared_arm",
        calibration_group="right",
    )

    def release(**kwargs: object) -> robot_gateway_api.OpenArmLeaderReleaseResult:
        assert kwargs["port"] == "/dev/serial/by-id/leader-arm"
        assert kwargs["motor_ids"] == [1, 2, 3, 4, 5, 6]
        assert kwargs["calibration_profile"] == "so100_follower"
        events.append("release")
        return robot_gateway_api.OpenArmLeaderReleaseResult(released=1)

    def start_leader_calibration(
        **kwargs: object,
    ) -> RobotGatewayLeRobotCalibrationStartResult:
        assert kwargs["port"] == "/dev/serial/by-id/leader-arm"
        assert kwargs["port_left"] == "/dev/serial/by-id/openarm-left"
        assert kwargs["port_right"] == "/dev/serial/by-id/leader-arm"
        assert kwargs["motor_ids"] == [1, 2, 3, 4, 5, 6]
        assert kwargs["calibration_profile"] == "so100_follower"
        assert kwargs["calibration_id"] == "shared_arm"
        assert kwargs["calibration_group"] == "right"
        events.append("start")
        return RobotGatewayLeRobotCalibrationStartResult(
            started=False,
            command=["lerobot-calibrate", "--teleop.type=so100_leader"],
            display_command="lerobot-calibrate --teleop.type=so100_leader",
            message="Open a terminal.",
        )

    with (
        patch.object(
            robot_gateway_api.openarm_leader_state_service,
            "release",
            release,
        ),
        patch(
            "backend.api.robot_gateway.start_lerobot_leader_calibration",
            start_leader_calibration,
        ),
    ):
        result = _run_api(robot_gateway_api.start_robot_gateway_leader_calibration(request))

    assert result.model_dump(by_alias=False) == {
        "started": False,
        "command": ["lerobot-calibrate", "--teleop.type=so100_leader"],
        "display_command": "lerobot-calibrate --teleop.type=so100_leader",
        "message": "Open a terminal.",
    }
    assert events == ["release", "start"]


def test_robot_gateway_control_rest_rejects_remote_proxy_without_teleop_access() -> None:
    with pytest.raises(HTTPException) as exc_info:
        require_robot_gateway_control_access(
            _robot_gateway_authorization_request(
                {
                    ROBOT_GATEWAY_DEV_PROXY_CLIENT_HOST_HEADER: TEST_REMOTE_BROWSER_HOST,
                }
            )
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == ROBOT_GATEWAY_CONTROL_AUTH_REQUIRED_DETAIL


def test_robot_gateway_control_rest_accepts_collaboration_teleop_capability() -> None:
    created = _create_robot_gateway_collaboration_session()
    capability = collaboration_service.issue_capability(
        created.session_id,
        CollaborationCapabilityIssueRequest(
            role="teleop_operator",
            allowed_transports=[ROBOT_GATEWAY_CONTROL_TRANSPORT_TELEOP_CAPABILITY_TRANSPORT],
        ),
        session_token=created.owner_token,
    )

    require_robot_gateway_control_access(
        _robot_gateway_authorization_request(
            {
                ROBOT_GATEWAY_DEV_PROXY_CLIENT_HOST_HEADER: TEST_REMOTE_BROWSER_HOST,
                ROBOT_GATEWAY_COLLABORATION_SESSION_HEADER: created.session_id,
                ROBOT_GATEWAY_COLLABORATION_TELEOP_CAPABILITY_HEADER: capability.capability_token,
            }
        )
    )


def test_robot_gateway_control_rest_accepts_collaboration_owner_token() -> None:
    created = _create_robot_gateway_collaboration_session()

    require_robot_gateway_control_access(
        _robot_gateway_authorization_request(
            {
                ROBOT_GATEWAY_DEV_PROXY_CLIENT_HOST_HEADER: TEST_REMOTE_BROWSER_HOST,
                ROBOT_GATEWAY_COLLABORATION_SESSION_HEADER: created.session_id,
                COLLABORATION_SESSION_TOKEN_HEADER: created.owner_token,
            }
        )
    )


def test_robot_gateway_control_rest_keeps_owner_teleop_when_sharing_paused() -> None:
    created = _create_robot_gateway_collaboration_session()
    collaboration_service.update_access(
        created.session_id,
        CollaborationAccessUpdateRequest(sharing_enabled=False),
        session_token=created.owner_token,
    )

    require_robot_gateway_control_access(
        _robot_gateway_authorization_request(
            {
                ROBOT_GATEWAY_DEV_PROXY_CLIENT_HOST_HEADER: TEST_REMOTE_BROWSER_HOST,
                ROBOT_GATEWAY_COLLABORATION_SESSION_HEADER: created.session_id,
                COLLABORATION_SESSION_TOKEN_HEADER: created.owner_token,
            }
        )
    )


def test_robot_gateway_control_rest_rejects_plain_editor_token() -> None:
    created = _create_robot_gateway_collaboration_session()

    with pytest.raises(HTTPException) as exc_info:
        require_robot_gateway_control_access(
            _robot_gateway_authorization_request(
                {
                    ROBOT_GATEWAY_DEV_PROXY_CLIENT_HOST_HEADER: TEST_REMOTE_BROWSER_HOST,
                    ROBOT_GATEWAY_COLLABORATION_SESSION_HEADER: created.session_id,
                    COLLABORATION_SESSION_TOKEN_HEADER: created.editor_token,
                }
            )
        )

    assert exc_info.value.status_code == 401


def test_robot_gateway_control_rest_accepts_simulator_operator_token() -> None:
    with patch(
        "backend.robot_gateway.rest_authorization.settings",
        SimpleNamespace(simulator_api_token=TEST_SIMULATOR_TOKEN),
    ):
        require_robot_gateway_control_access(
            _robot_gateway_authorization_request(
                {
                    ROBOT_GATEWAY_DEV_PROXY_CLIENT_HOST_HEADER: TEST_REMOTE_BROWSER_HOST,
                    SIMULATOR_TOKEN_HEADER: TEST_SIMULATOR_TOKEN,
                }
            )
        )


def test_robot_gateway_api_exposes_point_cloud_frame() -> None:
    frame = _run_api(
        robot_gateway_api.get_robot_gateway_point_cloud(
            ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID
        )
    )

    payload = frame.model_dump(by_alias=False, mode="json")
    assert payload["camera_id"] == ROBOT_GATEWAY_OPENARM_DEPTH_CAMERA_ID
    assert (
        len(payload["points_xyz"])
        == ROBOT_GATEWAY_FAKE_POINT_CLOUD_WIDTH * ROBOT_GATEWAY_FAKE_POINT_CLOUD_HEIGHT
    )


def test_robot_gateway_api_prepares_can_dry_run_without_sending() -> None:
    dry_run_runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(runtime_mode="control"),
        adapter=FakeOpenArmAdapter(),
    )
    dry_run_runtime.request_lease(
        RobotGatewayLeaseRequest(operator_id=TEST_OPERATOR_ID)
    )

    with patch("backend.api.robot_gateway.runtime", dry_run_runtime):
        plan = _run_api(
            robot_gateway_api.prepare_robot_gateway_joint_jog_can_dry_run(
                RobotGatewayJointJogRequest(
                    operator_id=TEST_OPERATOR_ID,
                    joint_name=TEST_RIGHT_CAN_JOINT_NAME,
                    delta_rad=TEST_RIGHT_CAN_JOINT_DELTA_RAD,
                    sequence=TEST_COMMAND_SEQUENCE,
                )
            )
        )

    payload = plan.model_dump(by_alias=False, mode="json")
    assert payload["accepted"] is True
    assert payload["frame"]["joint_name"] == TEST_RIGHT_CAN_JOINT_NAME
    assert (
        payload["frame"]["send_can_id"]
        == ROBOT_GATEWAY_OPENARM_CAN_SEND_IDS[TEST_RIGHT_CAN_MOTOR_INDEX]
    )
    assert (
        payload["frame"]["recv_can_id"]
        == ROBOT_GATEWAY_OPENARM_CAN_RECV_IDS[TEST_RIGHT_CAN_MOTOR_INDEX]
    )
    assert (
        payload["frame"]["transmission_state"]
        == ROBOT_GATEWAY_OPENARM_CAN_DRY_RUN_TRANSMISSION_STATE
    )
