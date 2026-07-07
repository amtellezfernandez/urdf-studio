from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import numpy as np

from backend.models.scenario import EpisodeManifest, ScenarioDocument
from backend.services.sim_backends.base import (
    ROBOT_PRIM_PATH,
    SimBackend,
    world_object_id_from_prim_path,
)
from backend.services.sim_backends.types import (
    ContactRecord,
    ObjectPose,
    Observation,
    SimState,
)
from backend.services.simulator_adapters.world_scene import SimulatorSceneSpec

_GENESIS_INITIALIZED = False

GENESIS_BACKEND_ENV_VAR = "STUDIO_GENESIS_EPISODE_BACKEND"


class GenesisBackendError(RuntimeError):
    ...


def _ensure_genesis_initialized(gs: Any) -> None:
    global _GENESIS_INITIALIZED
    if _GENESIS_INITIALIZED:
        return
    requested = os.environ.get(GENESIS_BACKEND_ENV_VAR, "cpu").strip().lower()
    backend = gs.gpu if requested == "gpu" else gs.cpu
    try:
        gs.init(backend=backend, precision="32", logging_level="warning")
    except gs.GenesisException as exc:
        # gs.init is once-per-process; another component (test, prepare script)
        # may have initialized it already — reuse that runtime.
        if "already initialized" not in str(exc).lower():
            raise
    _GENESIS_INITIALIZED = True


def _to_floats(value: Any) -> tuple[float, ...]:
    array = np.asarray(
        value.detach().cpu() if hasattr(value, "detach") else value, dtype=float
    ).reshape(-1)
    return tuple(float(v) for v in array)


class GenesisBackend(SimBackend):
    """In-process Genesis episode backend.

    Reuses the existing Genesis adapter helpers (primitive entities honoring
    fixed/collision/mass/friction, URDF robot morph, position controller) and
    answers the vendored APICore accessor surface from entity handles.
    Genesis initializes once per process (gs.init), so one worker process runs
    one backend.
    """

    backend_id = "genesis"
    robot_prim_path = ROBOT_PRIM_PATH

    def __init__(self, scene: SimulatorSceneSpec, scenario: ScenarioDocument) -> None:
        self._scene_spec = scene
        self._scenario = scenario
        self._gs: Any = None
        self._scene: Any = None
        self._robot: Any = None
        self._joint_dof_indices: dict[str, int] = {}
        self._entities: dict[str, Any] = {}
        self._dt_s = 0.002
        self._steps = 0
        self._attached: tuple[str, np.ndarray] | None = None

    # --- lifecycle ---

    def load_scene(self, *, physics_timestep_s: float) -> None:
        import genesis as gs

        from backend.services.simulator_adapters.genesis_robot import (
            configure_robot_position_controller,
            joint_dof_indices_by_name,
            robot_urdf_morph_kwargs,
        )
        from backend.services.simulator_adapters.genesis_scene import (
            add_floor_entity,
            add_primitive_entity,
        )

        self._gs = gs
        self._dt_s = physics_timestep_s
        _ensure_genesis_initialized(gs)
        self._scene = gs.Scene(
            show_viewer=False,
            sim_options=gs.options.SimOptions(
                dt=physics_timestep_s,
                gravity=(0.0, 0.0, -9.81),
            ),
            profiling_options=gs.options.ProfilingOptions(show_FPS=False),
        )
        add_floor_entity(gs, self._scene)
        for primitive in self._scene_spec.primitives:
            entity = add_primitive_entity(
                gs, self._scene, primitive,
                asset_roots=tuple(self._scene_spec.robot.asset_roots),
            )
            if entity is not None:
                self._entities[primitive.source_id] = entity
        morph_kwargs = robot_urdf_morph_kwargs(Path(self._scene_spec.robot.urdf_path))
        morph_kwargs["pos"] = tuple(self._scenario.robot.base_pose.xyz)
        self._robot = self._scene.add_entity(gs.morphs.URDF(**morph_kwargs), name="robot")
        self._scene.build()
        self._joint_dof_indices = joint_dof_indices_by_name(self._robot)
        configure_robot_position_controller(self._robot, self._joint_dof_indices)

    def reset_episode(self, manifest: EpisodeManifest) -> Observation:
        if self._scene is None:
            raise GenesisBackendError("load_scene must be called before reset_episode.")
        self.reset()
        for object_id, placement in manifest.object_placements.items():
            self._place_object(object_id, placement.position_xyz, placement.rotation_rpy_rad)
        if manifest.init_joint_positions:
            from backend.services.simulator_adapters.genesis_robot import apply_joint_values

            apply_joint_values(self._robot, self._joint_dof_indices, manifest.init_joint_positions)
        return self.get_observation()

    def reset(self) -> None:
        self._attached = None
        self._steps = 0
        self._scene.reset()
        from backend.services.simulator_adapters.genesis_robot import apply_joint_values

        joint_positions = {
            **dict(self._scene_spec.robot.joint_positions),
            **self._scenario.robot.init_joint_positions,
        }
        if joint_positions:
            apply_joint_values(self._robot, self._joint_dof_indices, joint_positions)

    def _place_object(
        self,
        object_id: str,
        position_xyz: tuple[float, float, float],
        rotation_rpy_rad: tuple[float, float, float],
    ) -> None:
        from scipy.spatial.transform import Rotation

        entity = self._require_entity(object_id)
        quat_xyzw = Rotation.from_euler("xyz", rotation_rpy_rad).as_quat()
        entity.set_pos(np.array(position_xyz))
        entity.set_quat(np.array([quat_xyzw[3], quat_xyzw[0], quat_xyzw[1], quat_xyzw[2]]))

    def step(self, joint_targets: dict[str, float] | None, substeps: int) -> None:
        if joint_targets:
            dof_indices = []
            positions = []
            for joint_name, target in joint_targets.items():
                dof_index = self._joint_dof_indices.get(joint_name)
                if dof_index is None:
                    raise GenesisBackendError(f"Unknown robot joint: {joint_name}")
                dof_indices.append(dof_index)
                positions.append(float(target))
            self._robot.control_dofs_position(positions, dofs_idx_local=dof_indices)
        for _ in range(max(1, substeps)):
            self._scene.step()
            self._steps += 1
            self._apply_attachment()

    # --- kinematic grasp-attach (runtime.grasp_attach: weld) ---

    def attach_object(self, object_id: str) -> None:
        link_pose = self._attach_link_pose_matrix()
        object_pose = self.get_obj_world_pose_matrix(f"/World/Objects/{object_id}")
        self._require_entity(object_id)
        self._attached = (object_id, np.linalg.inv(link_pose) @ object_pose)

    def detach_object(self) -> None:
        if self._attached is None:
            return
        object_id, _ = self._attached
        self._attached = None
        entity = self._require_entity(object_id)
        if hasattr(entity, "zero_all_dofs_velocity"):
            entity.zero_all_dofs_velocity()

    def _apply_attachment(self) -> None:
        if self._attached is None:
            return
        from scipy.spatial.transform import Rotation

        object_id, offset = self._attached
        target = self._attach_link_pose_matrix() @ offset
        entity = self._require_entity(object_id)
        quat_xyzw = Rotation.from_matrix(target[:3, :3]).as_quat()
        entity.set_pos(target[:3, 3])
        entity.set_quat(np.array([quat_xyzw[3], quat_xyzw[0], quat_xyzw[1], quat_xyzw[2]]))
        if hasattr(entity, "zero_all_dofs_velocity"):
            entity.zero_all_dofs_velocity()

    def _attach_link_pose_matrix(self) -> np.ndarray:
        from scipy.spatial.transform import Rotation

        link_name = self._scenario.runtime.attach_link
        if not link_name:
            raise GenesisBackendError("runtime.attach_link is required when grasp_attach is used.")
        link = self._robot.get_link(link_name)
        if link is None:
            raise GenesisBackendError(f"runtime.attach_link not found on robot: {link_name}")
        position = np.array(_to_floats(link.get_pos()))
        w, x, y, z = _to_floats(link.get_quat())
        matrix = np.eye(4)
        matrix[:3, :3] = Rotation.from_quat([x, y, z, w]).as_matrix()
        matrix[:3, 3] = position
        return matrix

    # --- observation / state ---

    @property
    def sim_time_s(self) -> float:
        return self._steps * self._dt_s

    def get_observation(self) -> Observation:
        return Observation(
            sim_time_s=self.sim_time_s,
            joint_positions=self.get_joint_state_dict(),
            object_poses={
                object_id: self._object_pose(object_id)
                for object_id, primitive in self._movable_objects()
            },
        )

    def get_state(self) -> SimState:
        return SimState(
            sim_time_s=self.sim_time_s,
            joint_positions=self.get_joint_state_dict(),
            joint_velocities={},
            object_poses={
                object_id: self._object_pose(object_id)
                for object_id, primitive in self._movable_objects()
            },
        )

    def set_state(self, state: SimState) -> None:
        from scipy.spatial.transform import Rotation

        for object_id, pose in state.object_poses.items():
            entity = self._entities.get(object_id)
            if entity is None:
                continue
            entity.set_pos(np.array(pose.position_xyz))
            entity.set_quat(np.array(pose.quat_wxyz))
        if state.joint_positions:
            from backend.services.simulator_adapters.genesis_robot import apply_joint_values

            apply_joint_values(self._robot, self._joint_dof_indices, state.joint_positions)
        del Rotation

    def _movable_objects(self):
        for primitive in self._scene_spec.primitives:
            if not primitive.fixed and primitive.source_id in self._entities:
                yield primitive.source_id, primitive

    def check_contacts(
        self,
        body_a: str | None = None,
        body_b: str | None = None,
    ) -> tuple[ContactRecord, ...]:
        records: list[ContactRecord] = []
        for object_id, entity in self._entities.items():
            if not hasattr(entity, "get_contacts"):
                continue
            try:
                contacts = entity.get_contacts()
            except (RuntimeError, TypeError):
                continue
            other_entities = contacts.get("entity_b") if isinstance(contacts, dict) else None
            positions = contacts.get("position") if isinstance(contacts, dict) else None
            if other_entities is None:
                continue
            for index, other in enumerate(other_entities):
                other_name = self._entity_name(other)
                position = (
                    tuple(_to_floats(positions[index]))[:3]
                    if positions is not None and index < len(positions)
                    else (0.0, 0.0, 0.0)
                )
                records.append(
                    ContactRecord(body_a=object_id, body_b=other_name, position_xyz=position)
                )
        filtered = [
            record
            for record in records
            if (body_a is None or body_a in (record.body_a, record.body_b))
            and (body_b is None or body_b in (record.body_a, record.body_b))
        ]
        return tuple(filtered)

    def _entity_name(self, entity: Any) -> str:
        if entity is self._robot:
            return "robot"
        for object_id, handle in self._entities.items():
            if handle is entity:
                return object_id
        return str(getattr(entity, "name", entity))

    def _require_entity(self, object_id: str) -> Any:
        entity = self._entities.get(object_id)
        if entity is None:
            raise GenesisBackendError(f"Unknown world object id: {object_id}")
        return entity

    def _object_pose(self, object_id: str) -> ObjectPose:
        entity = self._require_entity(object_id)
        position = _to_floats(entity.get_pos())[:3]
        quat = _to_floats(entity.get_quat())[:4]
        return ObjectPose(position_xyz=position, quat_wxyz=quat)

    # --- APICore accessor surface ---

    def get_obj_world_pose_matrix(self, prim_path: str) -> np.ndarray:
        from scipy.spatial.transform import Rotation

        pose = self._object_pose(world_object_id_from_prim_path(prim_path))
        w, x, y, z = pose.quat_wxyz
        matrix = np.eye(4)
        matrix[:3, :3] = Rotation.from_quat([x, y, z, w]).as_matrix()
        matrix[:3, 3] = pose.position_xyz
        return matrix

    def get_obj_world_pose(self, prim_path: str) -> tuple[np.ndarray, np.ndarray]:
        pose = self._object_pose(world_object_id_from_prim_path(prim_path))
        return np.array(pose.position_xyz), np.array(pose.quat_wxyz)

    def get_obj_aabb(self, prim_path: str) -> tuple[float, float, float, float, float, float]:
        object_id = world_object_id_from_prim_path(prim_path)
        entity = self._require_entity(object_id)
        try:
            values = _to_floats(entity.get_AABB())
        except Exception:
            # Genesis has no AABB for entities without collision geometry
            # (e.g. non-colliding zone volumes); derive it from the declared
            # primitive size and the entity's current pose.
            values = self._analytic_aabb(object_id)
        if len(values) != 6:
            raise GenesisBackendError(f"Unexpected Genesis AABB shape for {prim_path}: {values}")
        return (values[0], values[1], values[2], values[3], values[4], values[5])

    def _analytic_aabb(self, object_id: str) -> tuple[float, ...]:
        from scipy.spatial.transform import Rotation

        primitive = next(
            (p for p in self._scene_spec.primitives if p.source_id == object_id), None
        )
        if primitive is None:
            raise GenesisBackendError(f"Unknown world object id: {object_id}")
        pose = self._object_pose(object_id)
        w, x, y, z = pose.quat_wxyz
        rotation = Rotation.from_quat([x, y, z, w]).as_matrix()
        half = np.array(primitive.size_xyz) / 2.0
        world_half = np.abs(rotation) @ half
        center = np.array(pose.position_xyz)
        minimum = center - world_half
        maximum = center + world_half
        return (*map(float, minimum), *map(float, maximum))

    def get_obj_joint(self, prim_path: str) -> dict:
        return {"joint_positions": []}

    def get_joint_state_dict(self) -> dict[str, float]:
        if not self._joint_dof_indices:
            return {}
        positions = _to_floats(self._robot.get_dofs_position())
        return {
            joint_name: positions[dof_index]
            for joint_name, dof_index in self._joint_dof_indices.items()
            if dof_index < len(positions)
        }


def build_genesis_backend(
    scenario: ScenarioDocument,
    scenario_path: str | Path,
) -> GenesisBackend:
    from backend.services.scenario_loader import resolve_scenario_asset_path
    from backend.services.sim_backends.mujoco_backend import _resolve_robot_urdf
    from backend.services.simulator_adapters.world_scene import prepare_simulator_scene

    world_path = resolve_scenario_asset_path(scenario_path, scenario.world.package)
    robot_urdf_path = _resolve_robot_urdf(scenario, scenario_path, world_path)
    scene = prepare_simulator_scene(
        world_package_path=world_path,
        robot_urdf_path=robot_urdf_path,
        frame_map=scenario.world.frame_map,
        include_hidden=scenario.world.include_hidden,
    )
    return GenesisBackend(scene, scenario)
