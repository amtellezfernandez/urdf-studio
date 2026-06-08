from __future__ import annotations

from typing import Optional

from backend.models.ik_tasks import (
    JointLimitConstraint,
    OrientationTask,
    PoseTask,
    PositionTask,
    PostureTask,
)
from backend.models.kinematics import IKRequest, IkSolveRequest


def _first_task(req: IkSolveRequest, task_type):
    if not req.tasks:
        return None
    for task in req.tasks:
        if isinstance(task, task_type):
            return task
    return None


def compile_ik_request(req: IkSolveRequest) -> IKRequest:
    """
    Build a compatibility IKRequest from the task IR, falling back to the original fields.
    """
    pose_task: Optional[PoseTask] = _first_task(req, PoseTask)
    position_task: Optional[PositionTask] = _first_task(req, PositionTask)
    orientation_task: Optional[OrientationTask] = _first_task(req, OrientationTask)
    posture_task: Optional[PostureTask] = _first_task(req, PostureTask)
    joint_limit_constraint: Optional[JointLimitConstraint] = None
    if req.constraints:
        for constraint in req.constraints:
            if isinstance(constraint, JointLimitConstraint):
                joint_limit_constraint = constraint
                break

    if pose_task:
        return IKRequest(
            urdf=req.urdf,
            joint_values=req.joint_values,
            target_link=pose_task.link,
            target_position=pose_task.position,
            target_rotation=pose_task.rotation,
            target_wxyz=pose_task.wxyz,
            position_weight=pose_task.weight_position,
            orientation_weight=pose_task.weight_orientation,
            posture_joint_values=posture_task.joint_values if posture_task else None,
            posture_weight=posture_task.weight if posture_task else None,
            limit_weight=0.0 if joint_limit_constraint and not joint_limit_constraint.enabled else None,
        )

    target_link = req.target_link
    target_position = req.target_position
    target_rotation = req.target_rotation
    target_wxyz = req.target_wxyz

    if position_task:
        target_link = position_task.link
        target_position = position_task.position
    position_weight = position_task.weight if position_task else None
    if orientation_task:
        target_link = orientation_task.link
        target_rotation = orientation_task.rotation
        target_wxyz = orientation_task.wxyz
    orientation_weight = orientation_task.weight if orientation_task else None

    return IKRequest(
        urdf=req.urdf,
        joint_values=req.joint_values,
        target_link=target_link,
        target_position=target_position,
        target_rotation=target_rotation,
        target_wxyz=target_wxyz,
        position_weight=position_weight,
        orientation_weight=orientation_weight,
        posture_joint_values=posture_task.joint_values if posture_task else None,
        posture_weight=posture_task.weight if posture_task else None,
        limit_weight=0.0 if joint_limit_constraint and not joint_limit_constraint.enabled else None,
    )
