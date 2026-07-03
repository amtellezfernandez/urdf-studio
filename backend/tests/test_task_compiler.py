from __future__ import annotations

from typing import Any

from backend.models.ik_tasks import (
    JointLimitConstraint,
    OrientationTask,
    PoseTask,
    PositionTask,
    PostureTask,
)
from backend.models.kinematics import IkSolveRequest
from backend.services.task_compiler import compile_ik_request


def _base_solve_request(**overrides: Any) -> IkSolveRequest:
    payload: dict[str, Any] = {
        "urdf": "<robot name='demo'/>",
        "joint_values": {"joint_a": 0.25},
        "target_link": "fallback_tool",
        "target_position": [0.0, 0.0, 0.0],
    }
    payload.update(overrides)
    return IkSolveRequest(**payload)


def test_pose_task_takes_precedence_over_legacy_target_fields():
    solve_request = _base_solve_request(
        target_wxyz=[1.0, 0.0, 0.0, 0.0],
        tasks=[
            PoseTask(
                link="task_tool",
                position=[0.1, 0.2, 0.3],
                wxyz=[0.0, 1.0, 0.0, 0.0],
                weight_position=2.0,
                weight_orientation=3.0,
            ),
            PostureTask(joint_values={"joint_a": 0.5}, weight=0.25),
        ],
        constraints=[JointLimitConstraint(enabled=False)],
    )

    compiled_request = compile_ik_request(solve_request)

    assert compiled_request.urdf == solve_request.urdf
    assert compiled_request.joint_values == solve_request.joint_values
    assert compiled_request.target_link == "task_tool"
    assert compiled_request.target_position == [0.1, 0.2, 0.3]
    assert compiled_request.target_wxyz == [0.0, 1.0, 0.0, 0.0]
    assert compiled_request.position_weight == 2.0
    assert compiled_request.orientation_weight == 3.0
    assert compiled_request.posture_joint_values == {"joint_a": 0.5}
    assert compiled_request.posture_weight == 0.25
    assert compiled_request.limit_weight == 0.0


def test_position_and_orientation_tasks_compile_into_single_request():
    rotation_matrix = [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    ]
    solve_request = _base_solve_request(
        target_wxyz=[1.0, 0.0, 0.0, 0.0],
        tasks=[
            PositionTask(link="position_tool", position=[0.4, 0.5, 0.6], weight=4.0),
            OrientationTask(
                link="orientation_tool",
                rotation=rotation_matrix,
                wxyz=[0.0, 0.0, 1.0, 0.0],
                weight=5.0,
            ),
        ],
    )

    compiled_request = compile_ik_request(solve_request)

    assert compiled_request.target_link == "orientation_tool"
    assert compiled_request.target_position == [0.4, 0.5, 0.6]
    assert compiled_request.target_rotation == rotation_matrix
    assert compiled_request.target_wxyz == [0.0, 0.0, 1.0, 0.0]
    assert compiled_request.position_weight == 4.0
    assert compiled_request.orientation_weight == 5.0
    assert compiled_request.limit_weight is None


def test_request_without_tasks_preserves_legacy_target_fields():
    solve_request = _base_solve_request(
        target_link="legacy_tool",
        target_position=[0.7, 0.8, 0.9],
        target_wxyz=[0.0, 0.0, 0.0, 1.0],
    )

    compiled_request = compile_ik_request(solve_request)

    assert compiled_request.target_link == "legacy_tool"
    assert compiled_request.target_position == [0.7, 0.8, 0.9]
    assert compiled_request.target_wxyz == [0.0, 0.0, 0.0, 1.0]
    assert compiled_request.position_weight is None
    assert compiled_request.orientation_weight is None
