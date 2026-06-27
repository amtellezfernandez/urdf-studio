from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from backend.api import robot_gateway as robot_gateway_api
from backend.models.robot_gateway import (
    RobotGatewayLeRobotDirectTeleopLeaderRequest,
    RobotGatewayLeRobotDirectTeleopStartRequest,
)
from backend.robot_gateway.adapters import RobotGatewayAdapterConfig
from backend.robot_gateway.lerobot_direct_teleop import (
    LeRobotDirectTeleopService,
    build_lerobot_direct_teleop_command,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
    ROBOT_GATEWAY_LEROBOT_BI_OPENARM_MINI_TELEOPERATOR_TYPE,
    ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE,
    ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT,
)

TEST_OPERATOR_ID = "operator-direct"
TEST_SINGLE_LEADER_PORT = "/dev/serial/by-id/leader"
TEST_LEFT_LEADER_PORT = "/dev/serial/by-id/leader-left"
TEST_RIGHT_LEADER_PORT = "/dev/serial/by-id/leader-right"
TEST_FOLLOWER_PORT = "/dev/serial/by-id/follower"
TEST_LEADER_PROFILE = "so100_leader"
TEST_LEADER_ID = "leader-a"
TEST_FOLLOWER_ID = "follower-a"
TEST_FOLLOWER_ROBOT_TYPE = "so100_follower"
TEST_FPS = 60
TEST_PROCESS_PID = 4242
TEST_EXIT_CODE = 17
TEST_STOP_EXIT_CODE = -15
TEST_OPENARM_PAIR_ID = "openarm-pair"


class _FakeTeleopProcess:
    pid = TEST_PROCESS_PID

    def __init__(self) -> None:
        self.returncode: int | None = None
        self.terminated = False
        self.killed = False

    def poll(self) -> int | None:
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = TEST_STOP_EXIT_CODE

    def kill(self) -> None:
        self.killed = True
        self.returncode = TEST_STOP_EXIT_CODE

    def wait(self, timeout: float | None = None) -> int:
        return self.returncode if self.returncode is not None else 0


def _build_start_request(
    leader: RobotGatewayLeRobotDirectTeleopLeaderRequest | None = None,
) -> RobotGatewayLeRobotDirectTeleopStartRequest:
    return RobotGatewayLeRobotDirectTeleopStartRequest(
        operatorId=TEST_OPERATOR_ID,
        leader=leader
        or RobotGatewayLeRobotDirectTeleopLeaderRequest(
            port=TEST_SINGLE_LEADER_PORT,
            calibrationProfile=TEST_LEADER_PROFILE,
            calibrationId=TEST_LEADER_ID,
        ),
        fps=TEST_FPS,
    )


def _build_adapter_config(
    *,
    adapter_kind: str = ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
) -> RobotGatewayAdapterConfig:
    return RobotGatewayAdapterConfig(
        adapter_kind=adapter_kind,
        robot_id="fallback-follower",
        lerobot_port=TEST_FOLLOWER_PORT,
        lerobot_robot_type=TEST_FOLLOWER_ROBOT_TYPE,
        lerobot_id=TEST_FOLLOWER_ID,
        lerobot_calibration_dir=Path("/tmp/lerobot-calibration"),
    )


def test_lerobot_direct_teleop_command_wraps_lerobot_teleoperate() -> None:
    command = build_lerobot_direct_teleop_command(
        _build_adapter_config(),
        _build_start_request(),
    )

    assert command[0].endswith("lerobot-teleoperate")
    assert f"--robot.type={TEST_FOLLOWER_ROBOT_TYPE}" in command
    assert f"--robot.port={TEST_FOLLOWER_PORT}" in command
    assert f"--robot.id={TEST_FOLLOWER_ID}" in command
    assert f"--teleop.type={TEST_LEADER_PROFILE}" in command
    assert f"--teleop.port={TEST_SINGLE_LEADER_PORT}" in command
    assert f"--teleop.id={TEST_LEADER_ID}" in command
    assert f"--fps={TEST_FPS}" in command


def test_lerobot_direct_teleop_command_requires_openarm_mini_pair() -> None:
    with pytest.raises(ValueError, match="both left and right leader ports"):
        build_lerobot_direct_teleop_command(
            _build_adapter_config(),
            _build_start_request(
                RobotGatewayLeRobotDirectTeleopLeaderRequest(
                    port=TEST_RIGHT_LEADER_PORT,
                    calibrationProfile=ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE,
                    calibrationGroup=ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT,
                    calibrationId=TEST_OPENARM_PAIR_ID,
                )
            ),
        )


def test_lerobot_direct_teleop_command_uses_openarm_mini_pair() -> None:
    command = build_lerobot_direct_teleop_command(
        _build_adapter_config(),
        _build_start_request(
            RobotGatewayLeRobotDirectTeleopLeaderRequest(
                port=TEST_RIGHT_LEADER_PORT,
                portLeft=TEST_LEFT_LEADER_PORT,
                portRight=TEST_RIGHT_LEADER_PORT,
                calibrationProfile=ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE,
                calibrationGroup=ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT,
                calibrationId=TEST_OPENARM_PAIR_ID,
            )
        ),
    )

    assert f"--teleop.type={ROBOT_GATEWAY_LEROBOT_BI_OPENARM_MINI_TELEOPERATOR_TYPE}" in command
    assert f"--teleop.left_arm_config.port={TEST_LEFT_LEADER_PORT}" in command
    assert f"--teleop.right_arm_config.port={TEST_RIGHT_LEADER_PORT}" in command
    assert "--teleop.port=" not in " ".join(command)
    assert "port_left" not in " ".join(command)
    assert "port_right" not in " ".join(command)


def test_lerobot_direct_teleop_release_helper_releases_unique_leader_ports() -> None:
    released_ports: list[str] = []
    request = _build_start_request(
        RobotGatewayLeRobotDirectTeleopLeaderRequest(
            port=TEST_RIGHT_LEADER_PORT,
            portLeft=TEST_LEFT_LEADER_PORT,
            portRight=TEST_RIGHT_LEADER_PORT,
            calibrationCategory="teleoperators",
            calibrationProfile=ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE,
            calibrationId=TEST_OPENARM_PAIR_ID,
            calibrationGroup=ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT,
        )
    )

    def release_leader(**kwargs: object) -> robot_gateway_api.OpenArmLeaderReleaseResult:
        released_ports.append(str(kwargs["port"]))
        assert kwargs["calibration_category"] == "teleoperators"
        assert (
            kwargs["calibration_profile"]
            == ROBOT_GATEWAY_LEROBOT_OPENARM_MINI_TELEOPERATOR_TYPE
        )
        assert kwargs["calibration_id"] == TEST_OPENARM_PAIR_ID
        assert kwargs["calibration_group"] == ROBOT_GATEWAY_OPENARM_LEADER_STATE_SIDE_RIGHT
        return robot_gateway_api.OpenArmLeaderReleaseResult(released=1)

    with patch.object(
        robot_gateway_api.openarm_leader_state_service,
        "release",
        release_leader,
    ):
        robot_gateway_api._release_lerobot_direct_teleop_ports(request)

    assert released_ports == [TEST_RIGHT_LEADER_PORT, TEST_LEFT_LEADER_PORT]


def test_lerobot_direct_teleop_service_starts_and_stops_process() -> None:
    started: list[dict[str, object]] = []
    fake_process = _FakeTeleopProcess()

    def fake_process_factory(command: list[str], **kwargs: object) -> _FakeTeleopProcess:
        started.append({"command": command, **kwargs})
        return fake_process

    service = LeRobotDirectTeleopService(process_factory=fake_process_factory)

    start_status = service.start(
        _build_start_request(),
        adapter_config=_build_adapter_config(),
    )
    stop_status = service.stop()

    assert started
    assert start_status.state == "running"
    assert start_status.running is True
    assert start_status.pid == TEST_PROCESS_PID
    assert start_status.command == started[0]["command"]
    assert fake_process.terminated is True
    assert fake_process.killed is False
    assert stop_status.state == "stopped"
    assert stop_status.running is False
    assert stop_status.return_code == TEST_STOP_EXIT_CODE


def test_lerobot_direct_teleop_service_reports_process_failure() -> None:
    fake_process = _FakeTeleopProcess()
    service = LeRobotDirectTeleopService(
        process_factory=lambda *_args, **_kwargs: fake_process
    )

    service.start(_build_start_request(), adapter_config=_build_adapter_config())
    fake_process.returncode = TEST_EXIT_CODE
    status = service.status()

    assert status.state == "error"
    assert status.running is False
    assert status.return_code == TEST_EXIT_CODE
    assert status.last_error == f"LeRobot teleop exited with code {TEST_EXIT_CODE}."


def test_lerobot_direct_teleop_service_surfaces_spawn_error() -> None:
    service = LeRobotDirectTeleopService(
        process_factory=lambda *_args, **_kwargs: (_ for _ in ()).throw(
            OSError("missing binary")
        )
    )

    status = service.start(_build_start_request(), adapter_config=_build_adapter_config())

    assert status.state == "error"
    assert status.running is False
    assert status.pid is None
    assert status.last_error == "Failed to start LeRobot teleop: missing binary"


def test_lerobot_direct_teleop_rejects_non_lerobot_follower() -> None:
    service = LeRobotDirectTeleopService()

    with pytest.raises(ValueError, match="active follower adapter"):
        service.start(
            _build_start_request(),
            adapter_config=_build_adapter_config(adapter_kind="fake_openarm"),
        )
