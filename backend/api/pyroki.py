from __future__ import annotations

from fastapi import APIRouter

from backend.models.kinematics import FKRequest, FKResponse, IKRequest, IKResponse
from backend.services.kinematics import forward_kinematics, inverse_kinematics

router = APIRouter(prefix="/pyroki", tags=["pyroki"])


@router.post("/fk", response_model=FKResponse)
def pyroki_fk(req: FKRequest) -> FKResponse:
    """
    Forward kinematics via PyRoki.
    - URDF XML string is parsed + cached as a Robot.
    - Joint values are mapped into actuated order.
    - Returns link poses (wxyz_xyz) keyed by link name.
    """
    return forward_kinematics(req)


@router.post("/ik", response_model=IKResponse)
def pyroki_ik(req: IKRequest) -> IKResponse:
    """
    Single-target inverse kinematics via PyRoki + JAXLS.
    Returns the solved configuration and basic diagnostics.
    """
    return inverse_kinematics(req)
