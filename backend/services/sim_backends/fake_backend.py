from __future__ import annotations

import numpy as np

from backend.models.scenario import EpisodeManifest, ScenarioDocument
from backend.models.world_scene_package import WorldSceneRegistryEnvelope
from backend.services.sim_backends.base import SimBackend, world_object_id_from_prim_path
from backend.services.sim_backends.types import (
    ContactRecord,
    ObjectPose,
    Observation,
    SimState,
)


class FakeBackendError(RuntimeError):
    ...


class FakeBackend(SimBackend):
    """Kinematic pure-python backend for tests.

    Objects hold their poses unless a test scripts them (``move_object``) or a
    ``step`` applies joint targets verbatim. No physics, no dependencies —
    exercises the exact SimBackend/APICore surface the real backends implement.
    """

    backend_id = "fake"

    def __init__(self, scenario: ScenarioDocument, world: WorldSceneRegistryEnvelope) -> None:
        self._scenario = scenario
        self._world = world
        self._time_s = 0.0
        self._physics_timestep_s = 0.002
        self._joints: dict[str, float] = {}
        self._object_poses: dict[str, ObjectPose] = {}
        self._object_sizes: dict[str, tuple[float, float, float]] = {}
        self._contacts: list[ContactRecord] = []

    # --- test scripting hooks ---

    def move_object(self, object_id: str, position_xyz: tuple[float, float, float]) -> None:
        pose = self._require_pose(object_id)
        self._object_poses[object_id] = ObjectPose(
            position_xyz=position_xyz, quat_wxyz=pose.quat_wxyz
        )

    def set_contacts(self, contacts: list[ContactRecord]) -> None:
        self._contacts = contacts

    # --- lifecycle ---

    def load_scene(self, *, physics_timestep_s: float) -> None:
        self._physics_timestep_s = physics_timestep_s
        self._object_poses = {}
        self._object_sizes = {}
        for world_object in self._world.world.objects:
            if not isinstance(world_object, dict):
                continue
            object_id = str(world_object.get("id", "")).strip()
            if not object_id:
                continue
            position = tuple(float(v) for v in world_object.get("position_xyz", (0, 0, 0)))
            self._object_poses[object_id] = ObjectPose(
                position_xyz=position, quat_wxyz=(1.0, 0.0, 0.0, 0.0)
            )
            self._object_sizes[object_id] = tuple(
                float(v) for v in world_object.get("size_xyz", (0.1, 0.1, 0.1))
            )

    def reset_episode(self, manifest: EpisodeManifest) -> Observation:
        self.reset()
        for object_id, placement in manifest.object_placements.items():
            self._require_pose(object_id)
            self._object_poses[object_id] = ObjectPose(
                position_xyz=placement.position_xyz, quat_wxyz=(1.0, 0.0, 0.0, 0.0)
            )
        self._joints.update(manifest.init_joint_positions)
        return self.get_observation()

    def reset(self) -> None:
        self._time_s = 0.0
        self._joints = dict(self._scenario.robot.init_joint_positions)

    def step(self, joint_targets: dict[str, float] | None, substeps: int) -> None:
        if joint_targets:
            self._joints.update(joint_targets)
        self._time_s += self._physics_timestep_s * max(1, substeps)

    # --- observation / state ---

    @property
    def sim_time_s(self) -> float:
        return self._time_s

    def get_observation(self) -> Observation:
        return Observation(
            sim_time_s=self._time_s,
            joint_positions=dict(self._joints),
            object_poses=dict(self._object_poses),
        )

    def get_state(self) -> SimState:
        return SimState(
            sim_time_s=self._time_s,
            joint_positions=dict(self._joints),
            joint_velocities={name: 0.0 for name in self._joints},
            object_poses=dict(self._object_poses),
        )

    def set_state(self, state: SimState) -> None:
        self._time_s = state.sim_time_s
        self._joints = dict(state.joint_positions)
        self._object_poses.update(state.object_poses)

    def check_contacts(
        self,
        body_a: str | None = None,
        body_b: str | None = None,
    ) -> tuple[ContactRecord, ...]:
        return tuple(
            contact
            for contact in self._contacts
            if (body_a is None or body_a in (contact.body_a, contact.body_b))
            and (body_b is None or body_b in (contact.body_a, contact.body_b))
        )

    # --- APICore accessor surface ---

    def _require_pose(self, object_id: str) -> ObjectPose:
        pose = self._object_poses.get(object_id)
        if pose is None:
            raise FakeBackendError(f"Unknown world object id: {object_id}")
        return pose

    def get_obj_world_pose_matrix(self, prim_path: str) -> np.ndarray:
        pose = self._require_pose(world_object_id_from_prim_path(prim_path))
        matrix = np.eye(4)
        matrix[:3, 3] = pose.position_xyz
        return matrix

    def get_obj_world_pose(self, prim_path: str) -> tuple[np.ndarray, np.ndarray]:
        pose = self._require_pose(world_object_id_from_prim_path(prim_path))
        return np.array(pose.position_xyz), np.array(pose.quat_wxyz)

    def get_obj_aabb(self, prim_path: str) -> tuple[float, float, float, float, float, float]:
        object_id = world_object_id_from_prim_path(prim_path)
        pose = self._require_pose(object_id)
        half = tuple(v / 2.0 for v in self._object_sizes.get(object_id, (0.1, 0.1, 0.1)))
        cx, cy, cz = pose.position_xyz
        return (cx - half[0], cy - half[1], cz - half[2], cx + half[0], cy + half[1], cz + half[2])

    def get_obj_joint(self, prim_path: str) -> dict:
        return {"joint_positions": []}

    def get_joint_state_dict(self) -> dict[str, float]:
        return dict(self._joints)
