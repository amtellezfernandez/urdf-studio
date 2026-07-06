# URDF Studio shim — NOT part of the vendored Genie Sim sources.
#
# This module replaces Genie Sim's Isaac-based APICore
# (source/geniesim_benchmark/src/geniesim_benchmark/app/controllers/api_core.py,
# which imports pxr/omni/isaacsim) with an abstract, engine-neutral contract at
# the exact module path the vendored code imports. Every simulator backend in
# URDF Studio (backend/services/sim_backends/) implements this surface so the
# vendored Ader checkers, AderEnv, and DataCourier run unmodified.
from __future__ import annotations

import abc
from typing import Any

import numpy as np


class APICore(abc.ABC):
    """Engine-neutral simulator accessor surface consumed by vendored Genie Sim code.

    Method names, signatures, and return conventions mirror Genie Sim's APICore
    exactly (world-frame poses, wxyz quaternions, AABB as a 6-tuple of floats,
    joint dicts keyed like the vendored checkers expect).
    """

    # Attributes read by vendored code (common_actions.py, data_courier.py).
    robot_prim_path: str | None = None
    sub_task_name: str | None = None
    local_recorder: Any | None = None
    benchmark_ros_node: Any | None = None

    # --- Required by the vendored MVP subset (checkers + AderEnv) ---

    @abc.abstractmethod
    def get_obj_world_pose_matrix(self, prim_path: str) -> np.ndarray:
        """Return the 4x4 world-frame pose matrix of the object at prim_path."""

    @abc.abstractmethod
    def get_obj_world_pose(self, prim_path: str) -> tuple[np.ndarray, np.ndarray]:
        """Return (position(3,), quaternion wxyz(4,)) in the world frame."""

    @abc.abstractmethod
    def get_obj_aabb(self, prim_path: str) -> tuple[float, float, float, float, float, float]:
        """Return the world-frame AABB as (min_x, min_y, min_z, max_x, max_y, max_z)."""

    @abc.abstractmethod
    def get_obj_joint(self, prim_path: str) -> dict:
        """Return joint state for an articulated object: {"joint_positions": [...]}."""

    @abc.abstractmethod
    def get_joint_state_dict(self) -> dict[str, float]:
        """Return the robot's joint positions keyed by joint name (radians)."""

    @abc.abstractmethod
    def reset(self) -> None:
        """Reset the simulation to the episode's initial state."""

    # --- Declared for API parity; required only by non-MVP vendored checkers ---

    def get_observation_image(self, dir: dict | None = None) -> dict:
        raise NotImplementedError("This backend does not provide camera images yet.")

    def get_observation_depth(self, dir: dict | None = None) -> dict:
        raise NotImplementedError("This backend does not provide depth images yet.")

    def get_obs_bundle(self, *args: Any, **kwargs: Any) -> dict:
        raise NotImplementedError("This backend does not provide observation bundles yet.")

    def set_prim_visibility(self, prim_path: str, visible: bool) -> None:
        raise NotImplementedError("This backend does not support visibility toggling yet.")
