from __future__ import annotations

from typing import TypeVar

from backend.models.ik_tasks import (
    JointLimitConstraint,
    OrientationTask,
    PoseTask,
    PositionTask,
    PostureTask,
)
from backend.models.kinematics import IKRequest, IkSolveRequest

TaskT = TypeVar("TaskT", PoseTask, PositionTask, OrientationTask, PostureTask)
ConstraintT = TypeVar("ConstraintT")


def _first_matching_task(
    solve_request: IkSolveRequest, task_type: type[TaskT]
) -> TaskT | None:
    if not solve_request.tasks:
        return None
    for task in solve_request.tasks:
        if isinstance(task, task_type):
            return task
    return None


def _first_matching_constraint(
    solve_request: IkSolveRequest, constraint_type: type[ConstraintT]
) -> ConstraintT | None:
    if not solve_request.constraints:
        return None
    for constraint in solve_request.constraints:
        if isinstance(constraint, constraint_type):
            return constraint
    return None


def compile_ik_request(solve_request: IkSolveRequest) -> IKRequest:
    """
    Build a compatibility IKRequest from the task IR, falling back to the original fields.
    """
    pose_task = _first_matching_task(solve_request, PoseTask)
    position_task = _first_matching_task(solve_request, PositionTask)
    orientation_task = _first_matching_task(solve_request, OrientationTask)
    posture_task = _first_matching_task(solve_request, PostureTask)
    joint_limit_constraint = _first_matching_constraint(
        solve_request, JointLimitConstraint
    )

    if pose_task:
        return IKRequest(
            urdf=solve_request.urdf,
            joint_values=solve_request.joint_values,
            target_link=pose_task.link,
            target_position=pose_task.position,
            target_rotation=pose_task.rotation,
            target_wxyz=pose_task.wxyz,
            position_weight=pose_task.weight_position,
            orientation_weight=pose_task.weight_orientation,
            posture_joint_values=posture_task.joint_values if posture_task else None,
            posture_weight=posture_task.weight if posture_task else None,
            limit_weight=(
                0.0
                if joint_limit_constraint and not joint_limit_constraint.enabled
                else None
            ),
        )

    compiled_target_link = solve_request.target_link
    compiled_target_position = solve_request.target_position
    compiled_target_rotation = solve_request.target_rotation
    compiled_target_wxyz = solve_request.target_wxyz

    if position_task:
        compiled_target_link = position_task.link
        compiled_target_position = position_task.position
    position_weight = position_task.weight if position_task else None
    if orientation_task:
        compiled_target_link = orientation_task.link
        compiled_target_rotation = orientation_task.rotation
        compiled_target_wxyz = orientation_task.wxyz
    orientation_weight = orientation_task.weight if orientation_task else None

    return IKRequest(
        urdf=solve_request.urdf,
        joint_values=solve_request.joint_values,
        target_link=compiled_target_link,
        target_position=compiled_target_position,
        target_rotation=compiled_target_rotation,
        target_wxyz=compiled_target_wxyz,
        position_weight=position_weight,
        orientation_weight=orientation_weight,
        posture_joint_values=posture_task.joint_values if posture_task else None,
        posture_weight=posture_task.weight if posture_task else None,
        limit_weight=(
            0.0 if joint_limit_constraint and not joint_limit_constraint.enabled else None
        ),
    )
