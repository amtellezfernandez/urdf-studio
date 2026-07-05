from __future__ import annotations

import builtins
import numpy as np
import pytest
from fastapi import HTTPException

from backend.services import placo_kinematics as placo_kinematics_module
from backend.services.placo_kinematics import (
    _get_or_create_frame_task,
    _load_placo,
    _quat_to_matrix,
    _resolved_weight,
    _set_placo_posture_target,
    inverse_kinematics,
)
from backend.models.kinematics import IKRequest


class _FakeJointsTask:
    def __init__(self, rejected_call_count: int = 0) -> None:
        self.rejected_call_count = rejected_call_count
        self.calls: list[object] = []

    def set_joints(self, joint_target: object) -> None:
        self.calls.append(joint_target)
        if len(self.calls) <= self.rejected_call_count:
            raise RuntimeError("unsupported joint target")


def test_quat_to_matrix_returns_identity_for_identity_quaternion() -> None:
    assert np.allclose(
        _quat_to_matrix([1.0, 0.0, 0.0, 0.0]),
        np.eye(3, dtype=np.float64),
    )


def test_quat_to_matrix_normalizes_input_quaternion() -> None:
    normalized_rotation = _quat_to_matrix([1.0, 0.0, 0.0, 0.0])
    scaled_rotation = _quat_to_matrix([2.0, 0.0, 0.0, 0.0])

    assert np.allclose(scaled_rotation, normalized_rotation)


def test_quat_to_matrix_returns_identity_for_zero_quaternion() -> None:
    assert np.allclose(
        _quat_to_matrix([0.0, 0.0, 0.0, 0.0]),
        np.eye(3, dtype=np.float64),
    )


def test_quat_to_matrix_rejects_invalid_length() -> None:
    with pytest.raises(HTTPException) as exc_info:
        _quat_to_matrix([1.0, 0.0, 0.0])

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "target_wxyz must have length 4 when provided"


def test_resolved_weight_prefers_request_value() -> None:
    assert _resolved_weight(2.5, 1.0) == 2.5


def test_resolved_weight_uses_configured_default_when_request_is_empty() -> None:
    assert _resolved_weight(None, 1.75) == 1.75


def test_set_placo_posture_target_uses_named_mapping_first() -> None:
    joints_task = _FakeJointsTask()
    posture_target = {"joint_a": 0.5}

    _set_placo_posture_target(joints_task, posture_target, ("joint_a", "joint_b"))

    assert joints_task.calls == [posture_target]


def test_set_placo_posture_target_falls_back_to_ordered_list() -> None:
    joints_task = _FakeJointsTask(rejected_call_count=1)
    posture_target = {"joint_b": 0.75}

    _set_placo_posture_target(joints_task, posture_target, ("joint_a", "joint_b"))

    assert joints_task.calls[0] == posture_target
    assert joints_task.calls[1] == [0.0, 0.75]


def test_set_placo_posture_target_falls_back_to_numpy_array() -> None:
    joints_task = _FakeJointsTask(rejected_call_count=2)
    posture_target = {"joint_b": 0.75}

    _set_placo_posture_target(joints_task, posture_target, ("joint_a", "joint_b"))

    assert joints_task.calls[0] == posture_target
    assert joints_task.calls[1] == [0.0, 0.75]
    assert isinstance(joints_task.calls[2], np.ndarray)
    assert np.allclose(joints_task.calls[2], np.array([0.0, 0.75]))


def test_set_placo_posture_target_preserves_unexpected_errors() -> None:
    class _BrokenJointsTask:
        @staticmethod
        def set_joints(_joint_target: object) -> None:
            raise KeyError("unexpected joint target failure")

    with pytest.raises(KeyError, match="unexpected joint target failure"):
        _set_placo_posture_target(
            _BrokenJointsTask(),
            {"joint_a": 0.5},
            ("joint_a", "joint_b"),
        )


def test_get_or_create_frame_task_wraps_expected_missing_link_errors() -> None:
    class _BrokenSolver:
        @staticmethod
        def add_frame_task(_target_link: str, _frame: np.ndarray) -> object:
            raise ValueError("missing frame")

    entry = placo_kinematics_module.PlacoRobotEntry(
        urdf_hash="demo",
        urdf_xml="<robot name='demo'/>",
        robot=object(),
        solver=_BrokenSolver(),
        joint_names=[],
        joints_task=None,
    )

    with pytest.raises(HTTPException) as exc_info:
        _get_or_create_frame_task(entry, "tool")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Target link 'tool' not found in URDF."


def test_get_or_create_frame_task_preserves_unexpected_errors() -> None:
    class _BrokenSolver:
        @staticmethod
        def add_frame_task(_target_link: str, _frame: np.ndarray) -> object:
            raise AttributeError("unexpected frame task failure")

    entry = placo_kinematics_module.PlacoRobotEntry(
        urdf_hash="demo",
        urdf_xml="<robot name='demo'/>",
        robot=object(),
        solver=_BrokenSolver(),
        joint_names=[],
        joints_task=None,
    )

    with pytest.raises(AttributeError, match="unexpected frame task failure"):
        _get_or_create_frame_task(entry, "tool")


def test_load_placo_wraps_expected_robot_build_errors(monkeypatch) -> None:
    class _FakeRobotWrapper:
        def __init__(self, _path: str) -> None:
            raise ValueError("bad placo robot")

    class _FakePlacoModule:
        RobotWrapper = _FakeRobotWrapper

    real_import = builtins.__import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "placo":
            return _FakePlacoModule()
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    with pytest.raises(HTTPException) as exc_info:
        _load_placo("<robot name='demo'/>")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Failed to build Placo robot: bad placo robot"


def test_load_placo_preserves_unexpected_robot_build_errors(monkeypatch) -> None:
    class _FakeRobotWrapper:
        def __init__(self, _path: str) -> None:
            raise KeyError("unexpected placo robot failure")

    class _FakePlacoModule:
        RobotWrapper = _FakeRobotWrapper

    real_import = builtins.__import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "placo":
            return _FakePlacoModule()
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    with pytest.raises(KeyError, match="unexpected placo robot failure"):
        _load_placo("<robot name='demo'/>")


def test_placo_inverse_kinematics_wraps_expected_setup_errors(monkeypatch) -> None:
    class _FakeRobot:
        @staticmethod
        def set_joint(_joint_name: str, _joint_value: float) -> None:
            return None

        @staticmethod
        def update_kinematics() -> None:
            return None

    class _BrokenFrameTask:
        T_world_frame = None

        @staticmethod
        def configure(*_args) -> None:
            raise RuntimeError("bad frame task setup")

    class _FakeSolver:
        @staticmethod
        def add_frame_task(_target_link: str, _frame: np.ndarray) -> object:
            return _BrokenFrameTask()

        @staticmethod
        def enable_joint_limits(_enabled: bool) -> None:
            return None

    entry = placo_kinematics_module.PlacoRobotEntry(
        urdf_hash="demo",
        urdf_xml="<robot name='demo'/>",
        robot=_FakeRobot(),
        solver=_FakeSolver(),
        joint_names=["joint_a"],
        joints_task=None,
    )

    monkeypatch.setattr(placo_kinematics_module, "_load_placo", lambda _urdf_xml: entry)

    with pytest.raises(HTTPException) as exc_info:
        inverse_kinematics(
            IKRequest(
                urdf="<robot name='demo'/>",
                target_link="tool",
                target_position=[0.0, 0.0, 0.0],
                joint_values={"joint_a": 0.0},
            )
        )

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "Placo IK setup failed: bad frame task setup"


def test_placo_inverse_kinematics_preserves_unexpected_setup_errors(monkeypatch) -> None:
    class _FakeRobot:
        @staticmethod
        def set_joint(_joint_name: str, _joint_value: float) -> None:
            return None

        @staticmethod
        def update_kinematics() -> None:
            return None

    class _BrokenFrameTask:
        T_world_frame = None

        @staticmethod
        def configure(*_args) -> None:
            raise KeyError("unexpected frame task setup failure")

    class _FakeSolver:
        @staticmethod
        def add_frame_task(_target_link: str, _frame: np.ndarray) -> object:
            return _BrokenFrameTask()

        @staticmethod
        def enable_joint_limits(_enabled: bool) -> None:
            return None

    entry = placo_kinematics_module.PlacoRobotEntry(
        urdf_hash="demo",
        urdf_xml="<robot name='demo'/>",
        robot=_FakeRobot(),
        solver=_FakeSolver(),
        joint_names=["joint_a"],
        joints_task=None,
    )

    monkeypatch.setattr(placo_kinematics_module, "_load_placo", lambda _urdf_xml: entry)

    with pytest.raises(KeyError, match="unexpected frame task setup failure"):
        inverse_kinematics(
            IKRequest(
                urdf="<robot name='demo'/>",
                target_link="tool",
                target_position=[0.0, 0.0, 0.0],
                joint_values={"joint_a": 0.0},
            )
        )


def test_placo_inverse_kinematics_wraps_expected_solve_errors(monkeypatch) -> None:
    class _FakeRobot:
        @staticmethod
        def set_joint(_joint_name: str, _joint_value: float) -> None:
            return None

        @staticmethod
        def update_kinematics() -> None:
            return None

        @staticmethod
        def get_joint(_joint_name: str) -> float:
            return 0.0

    class _FrameTask:
        T_world_frame = None

        @staticmethod
        def configure(*_args) -> None:
            return None

    class _BrokenSolver:
        @staticmethod
        def add_frame_task(_target_link: str, _frame: np.ndarray) -> object:
            return _FrameTask()

        @staticmethod
        def enable_joint_limits(_enabled: bool) -> None:
            return None

        @staticmethod
        def solve(_allow_limits: bool) -> None:
            raise RuntimeError("bad solve")

    entry = placo_kinematics_module.PlacoRobotEntry(
        urdf_hash="demo",
        urdf_xml="<robot name='demo'/>",
        robot=_FakeRobot(),
        solver=_BrokenSolver(),
        joint_names=["joint_a"],
        joints_task=None,
    )

    monkeypatch.setattr(placo_kinematics_module, "_load_placo", lambda _urdf_xml: entry)

    with pytest.raises(HTTPException) as exc_info:
        inverse_kinematics(
            IKRequest(
                urdf="<robot name='demo'/>",
                target_link="tool",
                target_position=[0.0, 0.0, 0.0],
                joint_values={"joint_a": 0.0},
            )
        )

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "Placo IK solve failed: bad solve"


def test_placo_inverse_kinematics_preserves_unexpected_solve_errors(monkeypatch) -> None:
    class _FakeRobot:
        @staticmethod
        def set_joint(_joint_name: str, _joint_value: float) -> None:
            return None

        @staticmethod
        def update_kinematics() -> None:
            return None

        @staticmethod
        def get_joint(_joint_name: str) -> float:
            return 0.0

    class _FrameTask:
        T_world_frame = None

        @staticmethod
        def configure(*_args) -> None:
            return None

    class _BrokenSolver:
        @staticmethod
        def add_frame_task(_target_link: str, _frame: np.ndarray) -> object:
            return _FrameTask()

        @staticmethod
        def enable_joint_limits(_enabled: bool) -> None:
            return None

        @staticmethod
        def solve(_allow_limits: bool) -> None:
            raise KeyError("unexpected solve failure")

    entry = placo_kinematics_module.PlacoRobotEntry(
        urdf_hash="demo",
        urdf_xml="<robot name='demo'/>",
        robot=_FakeRobot(),
        solver=_BrokenSolver(),
        joint_names=["joint_a"],
        joints_task=None,
    )

    monkeypatch.setattr(placo_kinematics_module, "_load_placo", lambda _urdf_xml: entry)

    with pytest.raises(KeyError, match="unexpected solve failure"):
        inverse_kinematics(
            IKRequest(
                urdf="<robot name='demo'/>",
                target_link="tool",
                target_position=[0.0, 0.0, 0.0],
                joint_values={"joint_a": 0.0},
            )
        )
