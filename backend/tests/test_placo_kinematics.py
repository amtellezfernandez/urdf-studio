from __future__ import annotations

import numpy as np
import pytest
from fastapi import HTTPException

from backend.services.placo_kinematics import (
    _quat_to_matrix,
    _resolved_weight,
    _set_placo_posture_target,
)


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
