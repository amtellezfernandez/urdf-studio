from __future__ import annotations

from pathlib import Path

from backend.models.robot_gateway import RobotGatewayJointJogRequest
from backend.robot_gateway.openarm_self_collision import (
    OpenArmSelfCollisionPreflight,
    build_openarm_self_collision_preflight,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_DEFAULT_JOINT_JOG_STEP_RAD,
    ROBOT_GATEWAY_JOINT_JOG_SELF_COLLISION_LIMIT_REASON,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_CHECKED_JOINT_NAMES,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_MISSING_STATE_REASON_PREFIX,
    ROBOT_GATEWAY_OPENARM_SELF_COLLISION_UNAVAILABLE_REASON_PREFIX,
)


TEST_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
TEST_OPERATOR_ID = "operator-a"
TEST_JOINT_NAME = "openarm_right_joint3"
TEST_ZERO_JOINT_POSITION_RAD = 0.0
TEST_BODY_COLLISION_GEOMETRY_NAME = "openarm_body_link0_0"
TEST_RIGHT_HAND_COLLISION_GEOMETRY_NAME = "openarm_right_hand_0"
TEST_MISSING_JOINT_NAME = "openarm_right_joint7"
TEST_REQUEST = RobotGatewayJointJogRequest(
    operator_id=TEST_OPERATOR_ID,
    joint_name=TEST_JOINT_NAME,
    delta_rad=ROBOT_GATEWAY_DEFAULT_JOINT_JOG_STEP_RAD,
)
TEST_NEUTRAL_OPENARM_ARM_POSITIONS_RAD = {
    joint_name: TEST_ZERO_JOINT_POSITION_RAD
    for joint_name in ROBOT_GATEWAY_OPENARM_SELF_COLLISION_CHECKED_JOINT_NAMES
}
TEST_BODY_COLLIDING_OPENARM_ARM_POSITIONS_RAD = {
    "openarm_left_joint1": -0.834,
    "openarm_left_joint2": -0.927,
    "openarm_left_joint3": -1.002,
    "openarm_left_joint4": 1.062,
    "openarm_left_joint5": -1.22,
    "openarm_left_joint6": 0.417,
    "openarm_left_joint7": 0.622,
    "openarm_right_joint1": -0.291,
    "openarm_right_joint2": 0.904,
    "openarm_right_joint3": -0.957,
    "openarm_right_joint4": 2.317,
    "openarm_right_joint5": 0.65,
    "openarm_right_joint6": -0.434,
    "openarm_right_joint7": -0.738,
}


def test_openarm_self_collision_preflight_accepts_neutral_openarm_pose() -> None:
    preflight = _build_preflight()

    reason = preflight(TEST_NEUTRAL_OPENARM_ARM_POSITIONS_RAD, TEST_REQUEST)

    assert reason is None


def test_openarm_self_collision_preflight_rejects_body_hand_collision() -> None:
    preflight = _build_preflight()

    reason = preflight(TEST_BODY_COLLIDING_OPENARM_ARM_POSITIONS_RAD, TEST_REQUEST)

    assert reason is not None
    assert reason.startswith(ROBOT_GATEWAY_JOINT_JOG_SELF_COLLISION_LIMIT_REASON)
    assert TEST_BODY_COLLISION_GEOMETRY_NAME in reason
    assert TEST_RIGHT_HAND_COLLISION_GEOMETRY_NAME in reason


def test_openarm_self_collision_preflight_fails_closed_when_joint_state_missing() -> None:
    preflight = _build_preflight()
    target_positions_rad = dict(TEST_NEUTRAL_OPENARM_ARM_POSITIONS_RAD)
    target_positions_rad.pop(TEST_MISSING_JOINT_NAME)

    reason = preflight(target_positions_rad, TEST_REQUEST)

    assert (
        reason
        == f"{ROBOT_GATEWAY_OPENARM_SELF_COLLISION_MISSING_STATE_REASON_PREFIX} "
        f"{TEST_MISSING_JOINT_NAME}"
    )


def test_openarm_self_collision_preflight_fails_closed_when_urdf_is_missing(
    tmp_path: Path,
) -> None:
    preflight = build_openarm_self_collision_preflight(
        repo_root=TEST_REPO_ROOT,
        urdf_path=tmp_path / "missing-openarm.urdf",
    )

    reason = preflight(TEST_NEUTRAL_OPENARM_ARM_POSITIONS_RAD, TEST_REQUEST)

    assert reason.startswith(
        ROBOT_GATEWAY_OPENARM_SELF_COLLISION_UNAVAILABLE_REASON_PREFIX
    )


def _build_preflight() -> OpenArmSelfCollisionPreflight:
    preflight = build_openarm_self_collision_preflight(repo_root=TEST_REPO_ROOT)
    assert isinstance(preflight, OpenArmSelfCollisionPreflight)
    return preflight
