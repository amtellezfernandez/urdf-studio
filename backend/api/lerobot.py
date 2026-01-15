from __future__ import annotations

from fastapi import APIRouter

from backend.models.kinematics import IKRequest, IKResponse
from backend.services.lerobot_kinematics import inverse_kinematics

router = APIRouter(prefix="/lerobot", tags=["lerobot"])


@router.post("/ik", response_model=IKResponse)
def lerobot_ik(req: IKRequest) -> IKResponse:
    """
    Single-target inverse kinematics via Placo (LeRobot).
    Returns the solved configuration and basic diagnostics.
    """
    return inverse_kinematics(req)
