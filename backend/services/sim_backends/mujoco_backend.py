from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from backend.models.scenario import EpisodeManifest, ScenarioDocument
from backend.services.scenario_loader import ScenarioLoadError
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
from backend.services.world_layout_transfer_mujoco import (
    append_dynamic_primitives_to_mujoco_mjcf,
)

_ROBOT_ATTACH_PREFIX = "robot/"
_ACTUATOR_KP = 60.0
_ACTUATOR_KV = 4.0


class MujocoBackendError(RuntimeError):
    ...


class MujocoBackend(SimBackend):
    """In-process MuJoCo episode backend.

    Combines the world's primitives (fixed geoms + free bodies) with the robot
    URDF via MjSpec attach, adds position actuators for every actuated robot
    joint, and exposes the APICore accessor surface the vendored checkers use.
    """

    backend_id = "mujoco"
    robot_prim_path = ROBOT_PRIM_PATH

    def __init__(self, scene: SimulatorSceneSpec, scenario: ScenarioDocument) -> None:
        self._scene = scene
        self._scenario = scenario
        self._model: Any = None
        self._data: Any = None
        self._mujoco: Any = None
        self._actuated_joint_names: list[str] = []
        self._free_joint_by_object: dict[str, str] = {}
        self._initial_qpos: np.ndarray | None = None

    # --- lifecycle ---

    def load_scene(self, *, physics_timestep_s: float) -> None:
        import mujoco

        self._mujoco = mujoco
        scene_mjcf = self._build_scene_mjcf(physics_timestep_s)
        spec = mujoco.MjSpec.from_string(scene_mjcf)
        robot_spec = self._load_robot_spec(mujoco)
        if robot_spec is not None:
            frame = spec.worldbody.add_frame(
                pos=list(self._scenario.robot.base_pose.xyz),
            )
            spec.attach(robot_spec, prefix=_ROBOT_ATTACH_PREFIX, frame=frame)
            self._add_position_actuators(spec)
        self._model = spec.compile()
        self._data = mujoco.MjData(self._model)
        self._model.opt.timestep = physics_timestep_s
        self._index_scene()
        mujoco.mj_forward(self._model, self._data)
        self._initial_qpos = np.copy(self._data.qpos)

    def _build_scene_mjcf(self, physics_timestep_s: float) -> str:
        base = (
            "<mujoco model='scenario_world'>"
            "<compiler angle='radian'/>"
            f"<option timestep='{physics_timestep_s}' gravity='0 0 -9.81'/>"
            "<worldbody/>"
            "</mujoco>"
        )
        return append_dynamic_primitives_to_mujoco_mjcf(
            base,
            self._scene.primitives,
            include_floor=True,
            asset_roots=tuple(self._scene.robot.asset_roots),
        )

    def _load_robot_spec(self, mujoco: Any) -> Any | None:
        urdf_path = Path(self._scene.robot.urdf_path)
        if not urdf_path.is_file():
            raise MujocoBackendError(f"Robot URDF was not found: {urdf_path}")
        urdf_xml = urdf_path.read_text(encoding="utf-8")
        robot_spec = mujoco.MjSpec.from_string(urdf_xml)
        if not robot_spec.joints and not robot_spec.bodies:
            return None
        return robot_spec

    def _add_position_actuators(self, spec: Any) -> None:
        for joint in spec.joints:
            joint_name = str(joint.name)
            if not joint_name.startswith(_ROBOT_ATTACH_PREFIX):
                continue
            if joint.type not in (
                self._mujoco.mjtJoint.mjJNT_HINGE,
                self._mujoco.mjtJoint.mjJNT_SLIDE,
            ):
                continue
            actuator = spec.add_actuator()
            actuator.name = f"{joint_name}_position"
            actuator.target = joint_name
            actuator.trntype = self._mujoco.mjtTrn.mjTRN_JOINT
            actuator.gainprm[0] = _ACTUATOR_KP
            actuator.biasprm[1] = -_ACTUATOR_KP
            actuator.biasprm[2] = -_ACTUATOR_KV
            actuator.biastype = self._mujoco.mjtBias.mjBIAS_AFFINE
            self._actuated_joint_names.append(joint_name)

    def _index_scene(self) -> None:
        self._free_joint_by_object = {}
        for primitive in self._scene.primitives:
            if primitive.fixed:
                continue
            joint_name = f"{primitive.sim_name}_freejoint"
            joint_id = self._mujoco.mj_name2id(
                self._model, self._mujoco.mjtObj.mjOBJ_JOINT, joint_name
            )
            if joint_id >= 0:
                self._free_joint_by_object[primitive.source_id] = joint_name

    # --- episode control ---

    def reset_episode(self, manifest: EpisodeManifest) -> Observation:
        if self._model is None:
            raise MujocoBackendError("load_scene must be called before reset_episode.")
        self.reset()
        for object_id, placement in manifest.object_placements.items():
            self._place_object(object_id, placement.position_xyz, placement.rotation_rpy_rad)
        for joint_name, position in manifest.init_joint_positions.items():
            self._set_robot_joint(joint_name, position)
        self._mujoco.mj_forward(self._model, self._data)
        return self.get_observation()

    def reset(self) -> None:
        self._mujoco.mj_resetData(self._model, self._data)
        if self._initial_qpos is not None:
            self._data.qpos[:] = self._initial_qpos
        self._mujoco.mj_forward(self._model, self._data)

    def _place_object(
        self,
        object_id: str,
        position_xyz: tuple[float, float, float],
        rotation_rpy_rad: tuple[float, float, float],
    ) -> None:
        joint_name = self._free_joint_by_object.get(object_id)
        if joint_name is None:
            raise MujocoBackendError(
                f"Cannot place object {object_id!r}: it has no free joint "
                "(is it fixed in the world package?)."
            )
        from scipy.spatial.transform import Rotation

        joint_id = self._mujoco.mj_name2id(self._model, self._mujoco.mjtObj.mjOBJ_JOINT, joint_name)
        address = self._model.jnt_qposadr[joint_id]
        quat_xyzw = Rotation.from_euler("xyz", rotation_rpy_rad).as_quat()
        self._data.qpos[address : address + 3] = position_xyz
        self._data.qpos[address + 3 : address + 7] = (
            quat_xyzw[3], quat_xyzw[0], quat_xyzw[1], quat_xyzw[2],
        )
        velocity_address = self._model.jnt_dofadr[joint_id]
        self._data.qvel[velocity_address : velocity_address + 6] = 0.0

    def _set_robot_joint(self, joint_name: str, position: float) -> None:
        prefixed = f"{_ROBOT_ATTACH_PREFIX}{joint_name}"
        joint_id = self._mujoco.mj_name2id(self._model, self._mujoco.mjtObj.mjOBJ_JOINT, prefixed)
        if joint_id < 0:
            raise MujocoBackendError(f"Unknown robot joint: {joint_name}")
        self._data.qpos[self._model.jnt_qposadr[joint_id]] = position

    def step(self, joint_targets: dict[str, float] | None, substeps: int) -> None:
        if joint_targets:
            for joint_name, target in joint_targets.items():
                self._set_actuator_target(joint_name, target)
        for _ in range(max(1, substeps)):
            self._mujoco.mj_step(self._model, self._data)

    def _set_actuator_target(self, joint_name: str, target: float) -> None:
        prefixed = f"{_ROBOT_ATTACH_PREFIX}{joint_name}"
        actuator_id = self._mujoco.mj_name2id(
            self._model, self._mujoco.mjtObj.mjOBJ_ACTUATOR, f"{prefixed}_position"
        )
        if actuator_id < 0:
            raise MujocoBackendError(f"No position actuator for joint: {joint_name}")
        self._data.ctrl[actuator_id] = target

    # --- observation / state ---

    @property
    def sim_time_s(self) -> float:
        return float(self._data.time)

    def get_observation(self) -> Observation:
        return Observation(
            sim_time_s=self.sim_time_s,
            joint_positions=self.get_joint_state_dict(),
            object_poses={
                object_id: self._object_pose(object_id)
                for object_id in self._free_joint_by_object
            },
        )

    def get_state(self) -> SimState:
        return SimState(
            sim_time_s=self.sim_time_s,
            joint_positions=self.get_joint_state_dict(),
            joint_velocities=self._robot_joint_velocities(),
            object_poses={
                object_id: self._object_pose(object_id)
                for object_id in self._free_joint_by_object
            },
        )

    def set_state(self, state: SimState) -> None:
        for object_id, pose in state.object_poses.items():
            joint_name = self._free_joint_by_object.get(object_id)
            if joint_name is None:
                continue
            joint_id = self._mujoco.mj_name2id(
                self._model, self._mujoco.mjtObj.mjOBJ_JOINT, joint_name
            )
            address = self._model.jnt_qposadr[joint_id]
            self._data.qpos[address : address + 3] = pose.position_xyz
            self._data.qpos[address + 3 : address + 7] = pose.quat_wxyz
        for joint_name, position in state.joint_positions.items():
            self._set_robot_joint(joint_name, position)
        self._mujoco.mj_forward(self._model, self._data)

    def _object_pose(self, object_id: str) -> ObjectPose:
        body_name = self._object_body_name(object_id)
        body_id = self._mujoco.mj_name2id(self._model, self._mujoco.mjtObj.mjOBJ_BODY, body_name)
        if body_id < 0:
            raise MujocoBackendError(f"Unknown world object body: {object_id}")
        position = tuple(float(v) for v in self._data.xpos[body_id])
        quat = tuple(float(v) for v in self._data.xquat[body_id])
        return ObjectPose(position_xyz=position, quat_wxyz=quat)

    def _sim_name_for_object(self, object_id: str) -> str:
        for primitive in self._scene.primitives:
            if primitive.source_id == object_id:
                return primitive.sim_name
        raise MujocoBackendError(f"Unknown world object id: {object_id}")

    def _object_body_name(self, object_id: str) -> str:
        sim_name = self._sim_name_for_object(object_id)
        for primitive in self._scene.primitives:
            if primitive.source_id == object_id and not primitive.fixed:
                return f"{sim_name}_body"
        return sim_name

    def _robot_joint_velocities(self) -> dict[str, float]:
        velocities: dict[str, float] = {}
        for joint_name in self._actuated_joint_names:
            joint_id = self._mujoco.mj_name2id(
                self._model, self._mujoco.mjtObj.mjOBJ_JOINT, joint_name
            )
            address = self._model.jnt_dofadr[joint_id]
            bare = joint_name.removeprefix(_ROBOT_ATTACH_PREFIX)
            velocities[bare] = float(self._data.qvel[address])
        return velocities

    def check_contacts(
        self,
        body_a: str | None = None,
        body_b: str | None = None,
    ) -> tuple[ContactRecord, ...]:
        records: list[ContactRecord] = []
        for index in range(self._data.ncon):
            contact = self._data.contact[index]
            name_a = self._contact_entity_name(int(contact.geom1))
            name_b = self._contact_entity_name(int(contact.geom2))
            if body_a is not None and body_a not in (name_a, name_b):
                continue
            if body_b is not None and body_b not in (name_a, name_b):
                continue
            records.append(
                ContactRecord(
                    body_a=name_a,
                    body_b=name_b,
                    position_xyz=tuple(float(v) for v in contact.pos),
                )
            )
        return tuple(records)

    def _contact_entity_name(self, geom_id: int) -> str:
        geom_name = self._mujoco.mj_id2name(self._model, self._mujoco.mjtObj.mjOBJ_GEOM, geom_id)
        if geom_name is None:
            body_id = int(self._model.geom_bodyid[geom_id])
            geom_name = (
                self._mujoco.mj_id2name(self._model, self._mujoco.mjtObj.mjOBJ_BODY, body_id)
                or f"geom_{geom_id}"
            )
        if geom_name.startswith(_ROBOT_ATTACH_PREFIX):
            return "robot"
        for primitive in self._scene.primitives:
            if geom_name in (primitive.sim_name, f"{primitive.sim_name}_body"):
                return primitive.source_id
        return geom_name

    # --- APICore accessor surface (consumed by vendored checkers) ---

    def get_obj_world_pose_matrix(self, prim_path: str) -> np.ndarray:
        pose = self._object_pose(world_object_id_from_prim_path(prim_path))
        from scipy.spatial.transform import Rotation

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
        sim_name = self._sim_name_for_object(object_id)
        geom_id = self._mujoco.mj_name2id(self._model, self._mujoco.mjtObj.mjOBJ_GEOM, sim_name)
        if geom_id < 0:
            raise MujocoBackendError(f"Unknown world object geom: {object_id}")
        center = self._data.geom_xpos[geom_id]
        rotation = np.array(self._data.geom_xmat[geom_id]).reshape(3, 3)
        half_extents = self._geom_half_extents(geom_id)
        world_half = np.abs(rotation) @ half_extents
        minimum = center - world_half
        maximum = center + world_half
        return (
            float(minimum[0]), float(minimum[1]), float(minimum[2]),
            float(maximum[0]), float(maximum[1]), float(maximum[2]),
        )

    def _geom_half_extents(self, geom_id: int) -> np.ndarray:
        geom_type = int(self._model.geom_type[geom_id])
        size = self._model.geom_size[geom_id]
        if geom_type == int(self._mujoco.mjtGeom.mjGEOM_BOX):
            return np.array([size[0], size[1], size[2]])
        if geom_type == int(self._mujoco.mjtGeom.mjGEOM_SPHERE):
            return np.array([size[0], size[0], size[0]])
        if geom_type == int(self._mujoco.mjtGeom.mjGEOM_CYLINDER):
            return np.array([size[0], size[0], size[1]])
        return np.array([size[0], size[1] or size[0], size[2] or size[0]])

    def get_obj_joint(self, prim_path: str) -> dict:
        return {"joint_positions": []}

    def get_joint_state_dict(self) -> dict[str, float]:
        positions: dict[str, float] = {}
        for joint_name in self._actuated_joint_names:
            joint_id = self._mujoco.mj_name2id(
                self._model, self._mujoco.mjtObj.mjOBJ_JOINT, joint_name
            )
            address = self._model.jnt_qposadr[joint_id]
            positions[joint_name.removeprefix(_ROBOT_ATTACH_PREFIX)] = float(
                self._data.qpos[address]
            )
        return positions


def build_mujoco_backend(
    scenario: ScenarioDocument,
    scenario_path: str | Path,
) -> MujocoBackend:
    from backend.services.scenario_loader import resolve_scenario_asset_path
    from backend.services.simulator_adapters.world_scene import prepare_simulator_scene

    world_path = resolve_scenario_asset_path(scenario_path, scenario.world.package)
    robot_urdf_path = _resolve_robot_urdf(scenario, scenario_path, world_path)
    scene = prepare_simulator_scene(
        world_package_path=world_path,
        robot_urdf_path=robot_urdf_path,
        frame_map=scenario.world.frame_map,
        include_hidden=scenario.world.include_hidden,
    )
    return MujocoBackend(scene, scenario)


def _resolve_robot_urdf(
    scenario: ScenarioDocument,
    scenario_path: str | Path,
    world_path: Path,
) -> Path:
    import json
    import tempfile

    from backend.services.scenario_loader import resolve_scenario_asset_path

    if scenario.robot.urdf is not None:
        return resolve_scenario_asset_path(scenario_path, scenario.robot.urdf)
    payload = json.loads(world_path.read_text(encoding="utf-8"))
    world = payload.get("world") if isinstance(payload, dict) else None
    urdf_xml = world.get("urdf_xml") if isinstance(world, dict) else None
    if not isinstance(urdf_xml, str) or not urdf_xml.strip():
        raise ScenarioLoadError(
            "Scenario has no robot.urdf and the world package carries no urdf_xml snapshot."
        )
    handle = tempfile.NamedTemporaryFile(
        mode="w", suffix=".urdf", prefix="scenario-robot-", delete=False, encoding="utf-8"
    )
    with handle as file:
        file.write(urdf_xml)
    return Path(handle.name)
