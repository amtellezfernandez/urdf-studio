from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

from backend.models.genesis_world import (
    GenesisJointStateResponse,
    GenesisLiveStateResponse,
    GenesisWorldPose,
    GenesisWorldStateResponse,
)


@dataclass
class _GenesisLiveState:
    lock: threading.Lock = field(default_factory=threading.Lock)
    joint_sequence: int = 0
    joint_values: dict[str, float] = field(default_factory=dict)
    joint_updated_at: float = 0.0
    robot_sequence: int = 0
    robot_joint_values: dict[str, float] = field(default_factory=dict)
    robot_updated_at: float = 0.0
    live_sequence: int = 0
    live_updated_at: float = 0.0
    world_sequence: int = 0
    world_source_sequence: int = 0
    world_poses: list[GenesisWorldPose] = field(default_factory=list)
    world_updated_at: float = 0.0


_STATE = _GenesisLiveState()


def store_genesis_joint_state(joint_values: dict[str, float]) -> GenesisJointStateResponse:
    with _STATE.lock:
        _STATE.joint_sequence += 1
        _STATE.joint_values = dict(joint_values)
        _STATE.joint_updated_at = time.monotonic()
        return GenesisJointStateResponse(
            sequence=_STATE.joint_sequence,
            joint_values=_STATE.joint_values,
            updated_at_monotonic_sec=_STATE.joint_updated_at,
        )


def read_genesis_joint_state() -> GenesisJointStateResponse:
    with _STATE.lock:
        return GenesisJointStateResponse(
            sequence=_STATE.joint_sequence,
            joint_values=dict(_STATE.joint_values),
            updated_at_monotonic_sec=_STATE.joint_updated_at,
        )


def store_genesis_robot_state(joint_values: dict[str, float]) -> GenesisJointStateResponse:
    with _STATE.lock:
        _STATE.robot_sequence += 1
        _STATE.robot_joint_values = dict(joint_values)
        _STATE.robot_updated_at = time.monotonic()
        return GenesisJointStateResponse(
            sequence=_STATE.robot_sequence,
            joint_values=_STATE.robot_joint_values,
            updated_at_monotonic_sec=_STATE.robot_updated_at,
        )


def read_genesis_robot_state() -> GenesisJointStateResponse:
    with _STATE.lock:
        return GenesisJointStateResponse(
            sequence=_STATE.robot_sequence,
            joint_values=dict(_STATE.robot_joint_values),
            updated_at_monotonic_sec=_STATE.robot_updated_at,
        )


def store_genesis_live_state(
    *,
    robot_joint_values: dict[str, float],
    world_source_sequence: int,
    poses: list[GenesisWorldPose],
) -> GenesisLiveStateResponse:
    with _STATE.lock:
        now = time.monotonic()
        _STATE.live_sequence += 1
        _STATE.live_updated_at = now
        _STATE.robot_sequence += 1
        _STATE.robot_joint_values = dict(robot_joint_values)
        _STATE.robot_updated_at = now
        _STATE.world_sequence += 1
        _STATE.world_source_sequence = world_source_sequence
        _STATE.world_poses = list(poses)
        _STATE.world_updated_at = now
        return GenesisLiveStateResponse(
            sequence=_STATE.live_sequence,
            robot_joint_values=dict(_STATE.robot_joint_values),
            world_source_sequence=_STATE.world_source_sequence,
            poses=list(_STATE.world_poses),
            updated_at_monotonic_sec=_STATE.live_updated_at,
        )


def read_genesis_live_state() -> GenesisLiveStateResponse:
    with _STATE.lock:
        return GenesisLiveStateResponse(
            sequence=_STATE.live_sequence,
            robot_joint_values=dict(_STATE.robot_joint_values),
            world_source_sequence=_STATE.world_source_sequence,
            poses=list(_STATE.world_poses),
            updated_at_monotonic_sec=_STATE.live_updated_at,
        )


def store_genesis_world_state(
    *,
    source_sequence: int,
    poses: list[GenesisWorldPose],
) -> GenesisWorldStateResponse:
    with _STATE.lock:
        _STATE.world_sequence += 1
        _STATE.world_source_sequence = source_sequence
        _STATE.world_poses = list(poses)
        _STATE.world_updated_at = time.monotonic()
        return GenesisWorldStateResponse(
            sequence=_STATE.world_sequence,
            source_sequence=_STATE.world_source_sequence,
            poses=list(_STATE.world_poses),
            updated_at_monotonic_sec=_STATE.world_updated_at,
        )


def read_genesis_world_state() -> GenesisWorldStateResponse:
    with _STATE.lock:
        return GenesisWorldStateResponse(
            sequence=_STATE.world_sequence,
            source_sequence=_STATE.world_source_sequence,
            poses=list(_STATE.world_poses),
            updated_at_monotonic_sec=_STATE.world_updated_at,
        )


def clear_genesis_world_state() -> None:
    with _STATE.lock:
        _STATE.world_sequence = 0
        _STATE.world_source_sequence = 0
        _STATE.world_poses = []
        _STATE.world_updated_at = 0.0


def clear_genesis_runtime_state() -> None:
    with _STATE.lock:
        _STATE.joint_sequence = 0
        _STATE.joint_values = {}
        _STATE.joint_updated_at = 0.0
        _STATE.robot_sequence = 0
        _STATE.robot_joint_values = {}
        _STATE.robot_updated_at = 0.0
        _STATE.live_sequence = 0
        _STATE.live_updated_at = 0.0
        _STATE.world_sequence = 0
        _STATE.world_source_sequence = 0
        _STATE.world_poses = []
        _STATE.world_updated_at = 0.0


def reset_genesis_live_state_for_tests() -> None:
    clear_genesis_runtime_state()
