from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.core.simulator_security import require_simulator_operator_access
from backend.models.genesis_world import (
    GenesisJointStateRequest,
    GenesisJointStateResponse,
    GenesisLiveStateRequest,
    GenesisLiveStateResponse,
    GenesisWorldStateRequest,
    GenesisWorldStateResponse,
    GenesisWorldOpenRequest,
    GenesisWorldOpenResponse,
)
from backend.services.genesis_live_state import (
    read_genesis_joint_state,
    read_genesis_live_state,
    read_genesis_robot_state,
    read_genesis_world_state,
    clear_genesis_runtime_state,
    store_genesis_joint_state,
    store_genesis_live_state,
    store_genesis_robot_state,
    store_genesis_world_state,
)
from backend.services.genesis_world_launcher import (
    GenesisWorldLaunchError,
    launch_default_genesis_world,
)

router = APIRouter(prefix="/worlds/genesis", tags=["genesis-world"])


@router.post("/open", response_model=GenesisWorldOpenResponse)
def open_genesis_world(
    request: GenesisWorldOpenRequest,
    _access: None = Depends(require_simulator_operator_access),
) -> GenesisWorldOpenResponse:
    clear_genesis_runtime_state()
    try:
        return launch_default_genesis_world(
            dynamic_container_mode=request.dynamic_container_mode,
            robot_mode=request.robot_mode,
        )
    except GenesisWorldLaunchError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/joint-state", response_model=GenesisJointStateResponse)
def publish_genesis_joint_state(
    request: GenesisJointStateRequest,
    _access: None = Depends(require_simulator_operator_access),
) -> GenesisJointStateResponse:
    return store_genesis_joint_state(request.joint_values)


@router.get("/joint-state/latest", response_model=GenesisJointStateResponse)
def get_latest_genesis_joint_state(
    _access: None = Depends(require_simulator_operator_access),
) -> GenesisJointStateResponse:
    return read_genesis_joint_state()


@router.post("/robot-state", response_model=GenesisJointStateResponse)
def publish_genesis_robot_state(
    request: GenesisJointStateRequest,
    _access: None = Depends(require_simulator_operator_access),
) -> GenesisJointStateResponse:
    return store_genesis_robot_state(request.joint_values)


@router.get("/robot-state/latest", response_model=GenesisJointStateResponse)
def get_latest_genesis_robot_state(
    _access: None = Depends(require_simulator_operator_access),
) -> GenesisJointStateResponse:
    return read_genesis_robot_state()


@router.post("/live-state", response_model=GenesisLiveStateResponse)
def publish_genesis_live_state(
    request: GenesisLiveStateRequest,
    _access: None = Depends(require_simulator_operator_access),
) -> GenesisLiveStateResponse:
    return store_genesis_live_state(
        robot_joint_values=request.robot_joint_values,
        world_source_sequence=request.world_source_sequence,
        poses=request.poses,
    )


@router.get("/live-state/latest", response_model=GenesisLiveStateResponse)
def get_latest_genesis_live_state(
    _access: None = Depends(require_simulator_operator_access),
) -> GenesisLiveStateResponse:
    return read_genesis_live_state()


@router.post("/world-state", response_model=GenesisWorldStateResponse)
def publish_genesis_world_state(
    request: GenesisWorldStateRequest,
    _access: None = Depends(require_simulator_operator_access),
) -> GenesisWorldStateResponse:
    return store_genesis_world_state(
        source_sequence=request.source_sequence,
        poses=request.poses,
    )


@router.get("/world-state/latest", response_model=GenesisWorldStateResponse)
def get_latest_genesis_world_state(
    _access: None = Depends(require_simulator_operator_access),
) -> GenesisWorldStateResponse:
    return read_genesis_world_state()
