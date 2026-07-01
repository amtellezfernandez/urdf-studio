from __future__ import annotations

import math
from time import time

import pytest

from backend.models.robot_gateway import RobotGatewayStateFrame
from backend.robot_gateway.adapters import (
    FeetechSo101Adapter,
    RobotGatewayAdapterConfig,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_CONTROL_DATAGRAM_MAX_AGE_MS,
    ROBOT_GATEWAY_FEETECH_SO101_ADAPTER_ID,
    ROBOT_GATEWAY_FEETECH_SO101_PROFILE_ID,
    ROBOT_GATEWAY_FEETECH_SO101_ROBOT_ID,
)
from backend.robot_gateway.providers.feetech_provider import (
    RobotGatewayFeetechBusError,
)
from backend.robot_gateway.providers.provider_contract import (
    RobotGatewayTeleopProviderContract,
)
from backend.robot_gateway.runtime import RobotGatewayRuntime, RobotGatewayRuntimeConfig
from backend.robot_gateway.teleop_calibration import (
    TeleopCalibration,
    TeleopCalibrationEntry,
)


class _FakeFeetechBus:
    def __init__(self, positions_by_motor_id: dict[int, float]) -> None:
        self.positions_by_motor_id = positions_by_motor_id
        self.read_motor_ids: list[tuple[int, ...]] = []
        self.disconnected = False

    def read_present_positions(self, motor_ids: tuple[int, ...]) -> dict[int, float]:
        self.read_motor_ids.append(motor_ids)
        return {
            motor_id: self.positions_by_motor_id[motor_id]
            for motor_id in motor_ids
            if motor_id in self.positions_by_motor_id
        }

    def disconnect(self) -> None:
        self.disconnected = True


class _UnavailableFeetechBus:
    def read_present_positions(self, motor_ids: tuple[int, ...]) -> dict[int, float]:
        raise RobotGatewayFeetechBusError("/dev/ttyUSB404 is not available")

    def disconnect(self) -> None:
        return None


class _StaleAdapter:
    config = RobotGatewayAdapterConfig()
    adapter_id = "stale_provider"
    teleoperation_mode = "simulated"

    def build_profile(self, *, control_enabled: bool):
        from backend.robot_gateway.adapters import FakeOpenArmAdapter

        return FakeOpenArmAdapter().build_profile(control_enabled=control_enabled)

    def build_camera_streams(self):
        return []

    def read_state(self) -> RobotGatewayStateFrame:
        return RobotGatewayStateFrame(
            robot_id="stale",
            adapter_id=self.adapter_id,
            profile_id="stale",
            sequence=1,
            source_ts_ms=int(time() * 1000)
            - ROBOT_GATEWAY_CONTROL_DATAGRAM_MAX_AGE_MS
            - 10,
            joint_positions_rad={"joint_a": 0.0},
        )

    def read_point_cloud(self, camera_id: str):
        raise AssertionError("not used")

    def apply_joint_jog(self, req):
        raise AssertionError("not used")

    def prepare_joint_jog_can_dry_run(self, req):
        raise AssertionError("not used")

    def stop(self, *, sequence: int = 0):
        raise AssertionError("not used")

    def estop(self, *, sequence: int = 0):
        raise AssertionError("not used")

    def disconnect(self) -> int:
        return 0


def _calibration() -> TeleopCalibration:
    return TeleopCalibration(
        robotModelId=ROBOT_GATEWAY_FEETECH_SO101_ROBOT_ID,
        providerFamily="feetech",
        entries=[
            TeleopCalibrationEntry(
                motorId=1,
                jointName="shoulder_pan",
                sourceUnit="ticks",
                zeroOffset=1000.0,
                direction=-1,
                scaleToRad=math.pi / 2048.0,
            ),
            TeleopCalibrationEntry(
                motorId=2,
                jointName="shoulder_lift",
                sourceUnit="ticks",
                zeroOffset=1500.0,
                direction=1,
                scaleToRad=math.pi / 2048.0,
            ),
        ],
    )


def test_provider_contract_declares_model_space_radian_joints() -> None:
    contract = RobotGatewayTeleopProviderContract(
        providerId="feetech",
        robotModelId=ROBOT_GATEWAY_FEETECH_SO101_ROBOT_ID,
        jointNames=["shoulder_pan", "shoulder_lift"],
    )

    assert contract.contract_version == "urdf-studio.teleop-provider.v1"
    assert contract.joint_units == "rad"
    assert contract.capabilities.read_state is True


def test_runtime_rejects_stale_provider_state_timestamp() -> None:
    runtime = RobotGatewayRuntime(
        RobotGatewayRuntimeConfig(),
        adapter=_StaleAdapter(),
    )

    state = runtime.read_state()

    assert state.heartbeat_ok is False
    assert state.mode == "safe_hold"
    assert state.provider_health.status == "unavailable"
    assert state.provider_health.error_code == "provider_state_stale"
    assert (
        state.hardware_motion_safety.last_reject_reason
        == "Provider state timestamp is stale."
    )


def test_feetech_so101_provider_maps_fake_bus_to_urdf_joints() -> None:
    bus = _FakeFeetechBus({1: 900.0, 2: 1600.0})
    adapter = FeetechSo101Adapter(
        RobotGatewayAdapterConfig(
            adapter_kind=ROBOT_GATEWAY_FEETECH_SO101_ADAPTER_ID,
            robot_id=ROBOT_GATEWAY_FEETECH_SO101_ROBOT_ID,
            feetech_port="/dev/ttyUSB0",
        ),
        bus_factory=lambda _config: bus,
        calibration=_calibration(),
    )

    state = adapter.read_state()

    assert state.adapter_id == ROBOT_GATEWAY_FEETECH_SO101_ADAPTER_ID
    assert state.profile_id == ROBOT_GATEWAY_FEETECH_SO101_PROFILE_ID
    assert state.heartbeat_ok is True
    assert bus.read_motor_ids == [(1, 2)]
    assert state.joint_positions_rad["shoulder_pan"] == pytest.approx(
        100.0 * math.pi / 2048.0
    )
    assert state.joint_positions_rad["shoulder_lift"] == pytest.approx(
        100.0 * math.pi / 2048.0
    )


def test_feetech_provider_requires_calibration_before_teleop() -> None:
    adapter = FeetechSo101Adapter(
        RobotGatewayAdapterConfig(
            adapter_kind=ROBOT_GATEWAY_FEETECH_SO101_ADAPTER_ID,
            feetech_port="/dev/ttyUSB0",
        ),
        bus_factory=lambda _config: _FakeFeetechBus({1: 900.0}),
    )

    state = adapter.read_state()

    assert state.heartbeat_ok is False
    assert state.hardware_motion_safety.joint_rotation_calibration_ready is False
    assert "Feetech calibration missing" in (
        state.hardware_motion_safety.last_reject_reason or ""
    )


def test_feetech_provider_reports_mismatched_motor_ids() -> None:
    adapter = FeetechSo101Adapter(
        RobotGatewayAdapterConfig(
            adapter_kind=ROBOT_GATEWAY_FEETECH_SO101_ADAPTER_ID,
            feetech_port="/dev/ttyUSB0",
        ),
        bus_factory=lambda _config: _FakeFeetechBus({1: 900.0}),
        calibration=_calibration(),
    )

    state = adapter.read_state()

    assert state.heartbeat_ok is False
    assert "Feetech calibration mismatch" in (
        state.hardware_motion_safety.last_reject_reason or ""
    )
    assert "2" in (state.hardware_motion_safety.last_reject_reason or "")


def test_feetech_provider_reports_unavailable_port_without_crashing() -> None:
    adapter = FeetechSo101Adapter(
        RobotGatewayAdapterConfig(
            adapter_kind=ROBOT_GATEWAY_FEETECH_SO101_ADAPTER_ID,
            feetech_port="/dev/ttyUSB404",
        ),
        bus_factory=lambda _config: _UnavailableFeetechBus(),
        calibration=_calibration(),
    )

    state = adapter.read_state()

    assert state.heartbeat_ok is False
    assert "Feetech port unavailable" in (
        state.hardware_motion_safety.last_reject_reason or ""
    )


def test_feetech_provider_stays_read_only_for_control() -> None:
    adapter = FeetechSo101Adapter(
        RobotGatewayAdapterConfig(
            adapter_kind=ROBOT_GATEWAY_FEETECH_SO101_ADAPTER_ID,
            feetech_port="/dev/ttyUSB0",
        ),
        bus_factory=lambda _config: _FakeFeetechBus({1: 900.0, 2: 1600.0}),
        calibration=_calibration(),
    )

    from backend.models.robot_gateway import RobotGatewayJointJogRequest

    ack = adapter.apply_joint_jog(
        RobotGatewayJointJogRequest(
            joint_name="shoulder_pan",
            delta_rad=0.01,
        )
    )

    assert ack.accepted is False
    assert "read-only" in ack.reason
