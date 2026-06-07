from __future__ import annotations

import argparse
import json
import math
import threading
import time
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

from backend.core.settings import settings
from backend.services.genesis_world_scene import (
    DEFAULT_DYNAMIC_CONTAINER_MODE,
    DEFAULT_SO101_URDF_PATH,
    DEFAULT_WORLD_LAYOUT_PATH,
    GenesisElementPhysics,
    GenesisDynamicContainerMode,
    build_genesis_element_specs,
    color_hex_to_rgb,
    scene_center_and_radius,
)
from backend.services.so101_genesis_urdf import materialize_so101_genesis_urdf

GENESIS_RIGID_FRICTION_MIN = 0.01
GENESIS_RIGID_FRICTION_MAX = 5.0
DEFAULT_FLOOR_FRICTION = 1.0
DEFAULT_ROBOT_FRICTION = 3.0
GENESIS_SO101_ARM_KP = 280.0
GENESIS_SO101_ARM_KV = 18.0
GENESIS_SO101_ARM_FORCE_LIMIT = 90.0
GENESIS_SO101_GRIPPER_KP = 420.0
GENESIS_SO101_GRIPPER_KV = 24.0
GENESIS_SO101_GRIPPER_FORCE_LIMIT = 140.0
GENESIS_FLOOR_SIZE_XY = (4.0, 4.0)
GENESIS_FLOOR_THICKNESS_M = 0.08
GENESIS_FLOOR_TOP_Z = 0.0
GENESIS_FLOOR_CLEARANCE_EPSILON_M = 0.0005
GENESIS_ROBOT_BASE_Z_OFFSET_M = 0.004
GENESIS_ROBOT_FLOOR_CLEARANCE_EPSILON_M = 0.0005


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Open the bundled SO101 + world-layout elements in Genesis."
    )
    parser.add_argument(
        "--layout",
        default=str(DEFAULT_WORLD_LAYOUT_PATH),
        help="Path to a world-layout JSON with environment.elements.",
    )
    parser.add_argument(
        "--urdf",
        default=str(DEFAULT_SO101_URDF_PATH),
        help="Path to the SO101 URDF to load into Genesis.",
    )
    parser.add_argument(
        "--dynamic-container-mode",
        choices=["mesh", "box", "visual-only"],
        default=DEFAULT_DYNAMIC_CONTAINER_MODE,
        help=(
            "How to load dynamic world-layout elements. 'mesh' prepares real GLB "
            "collision, 'box' uses proxy boxes, 'visual-only' disables their collision."
        ),
    )
    parser.add_argument(
        "--duration-sec",
        type=float,
        default=0.0,
        help="Optional viewer duration. 0 means run until Ctrl-C/window close.",
    )
    parser.add_argument(
        "--no-viewer",
        action="store_true",
        help="Build and step headless instead of opening a viewer.",
    )
    parser.add_argument(
        "--screenshot",
        default="",
        help="Optional PNG screenshot path. Implies adding an offscreen camera.",
    )
    parser.add_argument("--screenshot-width", type=int, default=1280)
    parser.add_argument("--screenshot-height", type=int, default=720)
    parser.add_argument(
        "--live-state-base-url",
        default=f"http://127.0.0.1:{settings.api_port}/worlds/genesis",
        help=(
            "Backend Genesis live-state base URL. Empty disables Studio/Genesis "
            "joint mirroring and world pose publishing."
        ),
    )
    parser.add_argument("--live-joint-poll-hz", type=float, default=30.0)
    parser.add_argument("--live-world-publish-hz", type=float, default=30.0)
    parser.add_argument("--live-http-timeout-sec", type=float, default=0.05)
    return parser.parse_args()


def _to_degrees(rpy_rad: tuple[float, float, float]) -> tuple[float, float, float]:
    return tuple(math.degrees(value) for value in rpy_rad)


def _surface_for_color(gs, color_hex: str | None):
    rgb = color_hex_to_rgb(color_hex)
    if rgb is None:
        return None
    return gs.surfaces.Default(color=rgb, opacity=1.0)


def _finite_float_or_none(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _clamp_float(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def _positive_box_volume(size_xyz: tuple[float, float, float] | None) -> float | None:
    if size_xyz is None:
        return None
    components = tuple(_finite_float_or_none(component) for component in size_xyz)
    if any(component is None or component <= 0 for component in components):
        return None
    volume = components[0] * components[1] * components[2]
    return volume if math.isfinite(volume) and volume > 0 else None


def _rigid_material_for_physics(
    gs,
    physics: GenesisElementPhysics | None,
    *,
    box_size_xyz: tuple[float, float, float] | None = None,
    friction_fallback: float | None = None,
):
    kwargs: dict[str, float] = {}
    friction = _finite_float_or_none(getattr(physics, "friction", None))
    if friction is None:
        friction = _finite_float_or_none(friction_fallback)
    if friction is not None:
        kwargs["friction"] = _clamp_float(
            friction,
            GENESIS_RIGID_FRICTION_MIN,
            GENESIS_RIGID_FRICTION_MAX,
        )

    restitution = _finite_float_or_none(getattr(physics, "restitution", None))
    if restitution is not None:
        kwargs["coup_restitution"] = _clamp_float(restitution, 0.0, 1.0)

    mass_kg = _finite_float_or_none(getattr(physics, "mass_kg", None))
    volume = _positive_box_volume(box_size_xyz)
    if mass_kg is not None and mass_kg > 0 and volume is not None:
        kwargs["rho"] = mass_kg / volume

    if not kwargs:
        return None
    return gs.materials.Rigid(**kwargs)


def _apply_rigid_entity_physics_overrides(
    entity,
    physics: GenesisElementPhysics | None,
) -> None:
    mass_kg = _finite_float_or_none(getattr(physics, "mass_kg", None))
    if mass_kg is not None and mass_kg > 0 and hasattr(entity, "set_mass"):
        entity.set_mass(mass_kg)

    friction = _finite_float_or_none(getattr(physics, "friction", None))
    if friction is not None and hasattr(entity, "set_friction"):
        entity.set_friction(
            _clamp_float(
                friction,
                GENESIS_RIGID_FRICTION_MIN,
                GENESIS_RIGID_FRICTION_MAX,
            )
        )


def _add_mesh_entity(
    gs,
    scene,
    *,
    spec,
    fixed: bool,
    collision: bool,
    name: str,
    decimate: bool,
    convexify: bool | None,
    color_override: str | None = None,
    preserve_studio_glb_orientation: bool = False,
):
    surface = _surface_for_color(gs, color_override or spec.element.material_color)
    material = None
    if collision:
        material = _rigid_material_for_physics(
            gs,
            getattr(spec.element, "physics", None),
            box_size_xyz=getattr(spec, "box_size_xyz", None) if not fixed else None,
        )
    morph_kwargs = {
        "file": str(spec.asset_path.resolve()),
        "pos": spec.mesh_position_xyz,
        "euler": _to_degrees(spec.element.rotation_rpy_rad),
        "scale": spec.effective_scale_xyz,
        "fixed": fixed,
        "collision": collision,
        "decimate": decimate,
        "convexify": convexify,
        "align": False,
    }
    if preserve_studio_glb_orientation:
        morph_kwargs["file_meshes_are_zup"] = True
    morph = gs.morphs.Mesh(**morph_kwargs)
    kwargs = {"name": name}
    if surface is not None:
        kwargs["surface"] = surface
    if material is not None:
        kwargs["material"] = material
    return scene.add_entity(morph, **kwargs)


def _add_box_entity(gs, scene, *, spec, fixed: bool, collision: bool, name: str):
    surface = _surface_for_color(gs, spec.element.material_color) or gs.surfaces.Default(
        color=(0.9, 0.12, 0.12),
        opacity=1.0,
    )
    material = _rigid_material_for_physics(
        gs,
        getattr(spec.element, "physics", None),
        box_size_xyz=spec.box_size_xyz if not fixed else None,
    )
    kwargs = {
        "surface": surface,
        "name": name,
    }
    if material is not None:
        kwargs["material"] = material
    return scene.add_entity(
        gs.morphs.Box(
            size=spec.box_size_xyz,
            pos=spec.box_center_xyz,
            euler=_to_degrees(spec.element.rotation_rpy_rad),
            fixed=fixed,
            collision=collision,
        ),
        **kwargs,
    )


def _add_floor_entity(gs, scene):
    return scene.add_entity(
        gs.morphs.Box(
            size=(
                GENESIS_FLOOR_SIZE_XY[0],
                GENESIS_FLOOR_SIZE_XY[1],
                GENESIS_FLOOR_THICKNESS_M,
            ),
            pos=(0.0, 0.0, -GENESIS_FLOOR_THICKNESS_M / 2.0),
            fixed=True,
            collision=True,
        ),
        material=_rigid_material_for_physics(
            gs,
            None,
            friction_fallback=DEFAULT_FLOOR_FRICTION,
        ),
        surface=gs.surfaces.Default(color=(0.16, 0.16, 0.16), opacity=0.35),
        name="floor",
    )


def _positive_float_tuple3(value: Any) -> tuple[float, float, float] | None:
    if not isinstance(value, tuple | list) or len(value) != 3:
        return None
    parsed = tuple(_finite_float_or_none(component) for component in value)
    if any(component is None or component <= 0 for component in parsed):
        return None
    return parsed


def _oriented_box_min_z(
    *,
    qpos: list[float],
    box_size_xyz: tuple[float, float, float],
) -> float | None:
    if len(qpos) < 3 or not _is_finite_number(qpos[2]):
        return None
    half_size = tuple(component * 0.5 for component in box_size_xyz)
    if len(qpos) >= 7 and all(_is_finite_number(value) for value in qpos[3:7]):
        orientation = _normalize_quaternion_wxyz(tuple(float(value) for value in qpos[3:7]))
        vertical_extent = sum(
            abs(_rotate_vector_by_quaternion_wxyz(orientation, axis)[2]) * half_size[index]
            for index, axis in enumerate(
                ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
            )
        )
    else:
        vertical_extent = half_size[2]
    return float(qpos[2]) - vertical_extent


def _clear_downward_linear_z_velocity(entity) -> None:
    if not hasattr(entity, "get_qvel") or not hasattr(entity, "set_qvel"):
        return
    qvel = _to_float_list(entity.get_qvel())
    if len(qvel) < 3 or not _is_finite_number(qvel[2]) or qvel[2] >= 0:
        return
    qvel[2] = 0.0
    entity.set_qvel(qvel)


def _enforce_dynamic_floor_contact(
    dynamic_entities: list[tuple[Any, Any, tuple[float, float, float]]],
) -> int:
    clamped_count = 0
    for spec, entity, _scaled_offset_xyz in dynamic_entities:
        box_size_xyz = _positive_float_tuple3(getattr(spec, "box_size_xyz", None))
        if box_size_xyz is None or not hasattr(entity, "get_qpos"):
            continue
        qpos = _to_float_list(entity.get_qpos())
        min_z = _oriented_box_min_z(qpos=qpos, box_size_xyz=box_size_xyz)
        target_min_z = GENESIS_FLOOR_TOP_Z + GENESIS_FLOOR_CLEARANCE_EPSILON_M
        if min_z is None or min_z >= target_min_z:
            continue
        qpos[2] += target_min_z - min_z
        entity.set_qpos(qpos)
        _clear_downward_linear_z_velocity(entity)
        clamped_count += 1
    return clamped_count


def _is_finite_number(value: Any) -> bool:
    return (
        isinstance(value, int | float)
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _to_float_list(value: Any) -> list[float]:
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "numpy"):
        value = value.numpy()
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, int | float):
        return [float(value)]
    if not isinstance(value, list | tuple):
        return []
    flattened: list[float] = []
    for item in value:
        if isinstance(item, list | tuple):
            flattened.extend(_to_float_list(item))
        elif _is_finite_number(item):
            flattened.append(float(item))
    return flattened


def _normalize_quaternion_wxyz(
    quaternion: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    norm = math.sqrt(sum(component * component for component in quaternion))
    if norm <= 0 or not math.isfinite(norm):
        return (1.0, 0.0, 0.0, 0.0)
    return tuple(component / norm for component in quaternion)


def _rotate_vector_by_quaternion_wxyz(
    quaternion: tuple[float, float, float, float],
    vector: tuple[float, float, float],
) -> tuple[float, float, float]:
    w, x, y, z = _normalize_quaternion_wxyz(quaternion)
    vx, vy, vz = vector
    # Optimized q * v * q^-1 rotation for a unit quaternion in wxyz order.
    tx = 2.0 * (y * vz - z * vy)
    ty = 2.0 * (z * vx - x * vz)
    tz = 2.0 * (x * vy - y * vx)
    return (
        vx + w * tx + (y * tz - z * ty),
        vy + w * ty + (z * tx - x * tz),
        vz + w * tz + (x * ty - y * tx),
    )


def _resolve_studio_pose_from_qpos(
    *,
    qpos: list[float],
    scaled_visual_origin_offset_xyz: tuple[float, float, float],
) -> tuple[tuple[float, float, float], tuple[float, float, float, float]] | None:
    if len(qpos) < 7:
        return None
    position = tuple(float(value) for value in qpos[:3])
    orientation = _normalize_quaternion_wxyz(tuple(float(value) for value in qpos[3:7]))
    if not all(math.isfinite(value) for value in (*position, *orientation)):
        return None
    rotated_offset = _rotate_vector_by_quaternion_wxyz(
        orientation,
        scaled_visual_origin_offset_xyz,
    )
    studio_position = tuple(
        position[index] - rotated_offset[index]
        for index in range(3)
    )
    return studio_position, orientation


def _joint_dof_indices_by_name(robot_entity) -> dict[str, int]:
    indices: dict[str, int] = {}
    for joint in getattr(robot_entity, "joints", []):
        name = getattr(joint, "name", "")
        dof_indices = getattr(joint, "dofs_idx_local", None)
        if not isinstance(name, str) or not name:
            continue
        local_indices = _to_float_list(dof_indices)
        if len(local_indices) != 1:
            continue
        indices[name] = int(local_indices[0])
    return indices


def _apply_live_joint_values(
    robot_entity,
    joint_dof_indices: dict[str, int],
    joint_values: dict[str, Any],
) -> int:
    dof_indices: list[int] = []
    positions: list[float] = []
    for joint_name, value in joint_values.items():
        if joint_name not in joint_dof_indices or not _is_finite_number(value):
            continue
        dof_indices.append(joint_dof_indices[joint_name])
        positions.append(float(value))
    if not dof_indices:
        return 0
    robot_entity.control_dofs_position(positions, dofs_idx_local=dof_indices)
    return len(dof_indices)


def _configure_robot_position_controller(
    robot_entity,
    joint_dof_indices: dict[str, int],
) -> int:
    if not joint_dof_indices:
        return 0
    dof_indices: list[int] = []
    kp_values: list[float] = []
    kv_values: list[float] = []
    force_lower: list[float] = []
    force_upper: list[float] = []
    for joint_name, dof_index in joint_dof_indices.items():
        dof_indices.append(dof_index)
        is_gripper = "gripper" in joint_name.lower()
        kp = GENESIS_SO101_GRIPPER_KP if is_gripper else GENESIS_SO101_ARM_KP
        kv = GENESIS_SO101_GRIPPER_KV if is_gripper else GENESIS_SO101_ARM_KV
        force_limit = (
            GENESIS_SO101_GRIPPER_FORCE_LIMIT
            if is_gripper
            else GENESIS_SO101_ARM_FORCE_LIMIT
        )
        kp_values.append(kp)
        kv_values.append(kv)
        force_lower.append(-force_limit)
        force_upper.append(force_limit)

    if hasattr(robot_entity, "set_dofs_kp"):
        robot_entity.set_dofs_kp(kp_values, dofs_idx_local=dof_indices)
    if hasattr(robot_entity, "set_dofs_kv"):
        robot_entity.set_dofs_kv(kv_values, dofs_idx_local=dof_indices)
    if hasattr(robot_entity, "set_dofs_force_range"):
        robot_entity.set_dofs_force_range(
            force_lower,
            force_upper,
            dofs_idx_local=dof_indices,
        )
    return len(dof_indices)


def _robot_collision_min_z(robot_entity) -> float | None:
    min_z_values: list[float] = []
    for link in getattr(robot_entity, "links", []):
        for method_name in ("get_AABB", "get_vAABB"):
            method = getattr(link, method_name, None)
            if method is None:
                continue
            try:
                aabb = _to_float_list(method())
            except Exception:
                continue
            if len(aabb) < 3 or not _is_finite_number(aabb[2]):
                continue
            min_z_values.append(float(aabb[2]))
    return min(min_z_values) if min_z_values else None


def _restore_robot_joint_positions(robot_entity, qpos: list[float]) -> None:
    if hasattr(robot_entity, "set_qpos"):
        robot_entity.set_qpos(qpos)
    if hasattr(robot_entity, "zero_all_dofs_velocity"):
        robot_entity.zero_all_dofs_velocity()
    if hasattr(robot_entity, "control_dofs_position"):
        robot_entity.control_dofs_position(qpos)


def _enforce_robot_floor_contact(
    robot_entity,
    last_safe_qpos: list[float],
) -> tuple[bool, list[float]]:
    current_qpos = (
        _to_float_list(robot_entity.get_qpos())
        if hasattr(robot_entity, "get_qpos")
        else []
    )
    min_z = _robot_collision_min_z(robot_entity)
    target_min_z = GENESIS_FLOOR_TOP_Z + GENESIS_ROBOT_FLOOR_CLEARANCE_EPSILON_M
    if min_z is not None and min_z < target_min_z:
        if last_safe_qpos:
            _restore_robot_joint_positions(robot_entity, last_safe_qpos)
        return False, list(last_safe_qpos)
    return True, current_qpos or list(last_safe_qpos)


def _read_json_url(url: str, *, timeout_sec: float) -> dict[str, Any] | None:
    try:
        with urllib_request.urlopen(url, timeout=timeout_sec) as response:
            payload = response.read()
    except (OSError, urllib_error.URLError, TimeoutError):
        return None
    try:
        parsed = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _post_json_url(url: str, payload: dict[str, Any], *, timeout_sec: float) -> None:
    data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib_request.Request(
        url,
        data=data,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib_request.urlopen(request, timeout=timeout_sec) as response:
            response.read()
    except (OSError, urllib_error.URLError, TimeoutError):
        return


def _latest_joint_values_from_backend(
    base_url: str,
    *,
    timeout_sec: float,
) -> tuple[int, dict[str, Any]] | None:
    payload = _read_json_url(
        f"{base_url.rstrip('/')}/joint-state/latest",
        timeout_sec=timeout_sec,
    )
    if payload is None:
        return None
    sequence = payload.get("sequence")
    joint_values = payload.get("joint_values")
    if not isinstance(sequence, int) or not isinstance(joint_values, dict):
        return None
    return sequence, joint_values


class _GenesisLiveHttpBridge:
    def __init__(
        self,
        *,
        base_url: str,
        joint_poll_interval: float,
        state_publish_interval: float,
        timeout_sec: float,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._joint_poll_interval = max(0.001, joint_poll_interval)
        self._state_publish_interval = max(0.001, state_publish_interval)
        self._timeout_sec = timeout_sec
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._latest_joint_state: tuple[int, dict[str, Any]] | None = None
        self._robot_joint_values: dict[str, float] = {}
        self._robot_generation = 0
        self._world_payload: tuple[int, list[dict[str, Any]]] | None = None
        self._world_generation = 0
        self._joint_thread = threading.Thread(
            target=self._poll_joint_values,
            name="genesis-live-joint-poll",
            daemon=True,
        )
        self._publish_thread = threading.Thread(
            target=self._publish_state,
            name="genesis-live-state-publish",
            daemon=True,
        )

    def start(self) -> None:
        self._joint_thread.start()
        self._publish_thread.start()

    def close(self) -> None:
        self._stop.set()
        self._joint_thread.join(timeout=0.5)
        self._publish_thread.join(timeout=0.5)

    def read_latest_joint_values(self) -> tuple[int, dict[str, Any]] | None:
        with self._lock:
            if self._latest_joint_state is None:
                return None
            sequence, joint_values = self._latest_joint_state
            return sequence, dict(joint_values)

    def queue_robot_joint_values(self, joint_values: dict[str, float]) -> None:
        if not joint_values:
            return
        with self._lock:
            self._robot_joint_values = dict(joint_values)
            self._robot_generation += 1

    def queue_world_state(
        self,
        *,
        source_sequence: int,
        poses: list[dict[str, Any]],
    ) -> None:
        with self._lock:
            self._world_payload = (source_sequence, list(poses))
            self._world_generation += 1

    def _poll_joint_values(self) -> None:
        while not self._stop.is_set():
            latest = _latest_joint_values_from_backend(
                self._base_url,
                timeout_sec=self._timeout_sec,
            )
            if latest is not None:
                with self._lock:
                    current_sequence = (
                        self._latest_joint_state[0]
                        if self._latest_joint_state is not None
                        else 0
                    )
                    if latest[0] >= current_sequence:
                        self._latest_joint_state = (latest[0], dict(latest[1]))
            self._stop.wait(self._joint_poll_interval)

    def _publish_state(self) -> None:
        last_robot_generation = 0
        last_world_generation = 0
        while not self._stop.is_set():
            live_payload: dict[str, Any] | None = None
            with self._lock:
                robot_changed = self._robot_generation > last_robot_generation
                world_changed = self._world_generation > last_world_generation
                if robot_changed:
                    last_robot_generation = self._robot_generation
                if world_changed:
                    last_world_generation = self._world_generation
                if robot_changed or world_changed:
                    source_sequence = 0
                    poses: list[dict[str, Any]] = []
                    if self._world_payload is not None:
                        source_sequence, poses = self._world_payload
                    live_payload = {
                        "robot_joint_values": dict(self._robot_joint_values),
                        "world_source_sequence": source_sequence,
                        "poses": list(poses),
                    }

            if live_payload is not None:
                _post_json_url(
                    f"{self._base_url}/live-state",
                    live_payload,
                    timeout_sec=self._timeout_sec,
                )
            self._stop.wait(self._state_publish_interval)


def _robot_joint_values_payload(
    robot_entity,
    joint_dof_indices: dict[str, int],
) -> dict[str, float]:
    if not joint_dof_indices or not hasattr(robot_entity, "get_qpos"):
        return {}
    qpos = _to_float_list(robot_entity.get_qpos())
    joint_values: dict[str, float] = {}
    for joint_name, dof_index in joint_dof_indices.items():
        if dof_index < 0 or dof_index >= len(qpos):
            continue
        value = qpos[dof_index]
        if _is_finite_number(value):
            joint_values[joint_name] = float(value)
    return joint_values


def _publish_robot_joint_state(
    *,
    base_url: str,
    robot_entity,
    joint_dof_indices: dict[str, int],
    timeout_sec: float,
) -> None:
    joint_values = _robot_joint_values_payload(robot_entity, joint_dof_indices)
    if not joint_values:
        return
    _post_json_url(
        f"{base_url.rstrip('/')}/robot-state",
        {"joint_values": joint_values},
        timeout_sec=timeout_sec,
    )


def _dynamic_entity_pose_payload(
    *,
    spec,
    entity,
    scaled_visual_origin_offset_xyz: tuple[float, float, float],
) -> dict[str, Any] | None:
    pose = _resolve_studio_pose_from_qpos(
        qpos=_to_float_list(entity.get_qpos()),
        scaled_visual_origin_offset_xyz=scaled_visual_origin_offset_xyz,
    )
    if pose is None:
        return None
    position_xyz, orientation_wxyz = pose
    return {
        "element_id": spec.element.id,
        "position_xyz": position_xyz,
        "orientation_wxyz": orientation_wxyz,
    }


def _visual_mesh_qpos_from_collider_qpos(
    *,
    collider_qpos: list[float],
    collider_scaled_offset_xyz: tuple[float, float, float],
    visual_scaled_offset_xyz: tuple[float, float, float],
) -> list[float] | None:
    pose = _resolve_studio_pose_from_qpos(
        qpos=collider_qpos,
        scaled_visual_origin_offset_xyz=collider_scaled_offset_xyz,
    )
    if pose is None:
        return None
    studio_position_xyz, orientation_wxyz = pose
    rotated_visual_offset = _rotate_vector_by_quaternion_wxyz(
        orientation_wxyz,
        visual_scaled_offset_xyz,
    )
    visual_position_xyz = tuple(
        studio_position_xyz[index] + rotated_visual_offset[index]
        for index in range(3)
    )
    return [*visual_position_xyz, *orientation_wxyz]


def _sync_dynamic_visual_entities(
    dynamic_visual_entities: list[
        tuple[Any, Any, tuple[float, float, float], tuple[float, float, float]]
    ],
) -> None:
    for visual_entity, collider_entity, collider_offset, visual_offset in (
        dynamic_visual_entities
    ):
        visual_qpos = _visual_mesh_qpos_from_collider_qpos(
            collider_qpos=_to_float_list(collider_entity.get_qpos()),
            collider_scaled_offset_xyz=collider_offset,
            visual_scaled_offset_xyz=visual_offset,
        )
        if visual_qpos is not None:
            visual_entity.set_qpos(visual_qpos)


def _publish_dynamic_world_poses(
    *,
    base_url: str,
    source_sequence: int,
    dynamic_entities: list[tuple[Any, Any, tuple[float, float, float]]],
    timeout_sec: float,
) -> None:
    poses = _dynamic_world_poses_payload(dynamic_entities)
    _post_json_url(
        f"{base_url.rstrip('/')}/world-state",
        {"source_sequence": source_sequence, "poses": poses},
        timeout_sec=timeout_sec,
    )


def _dynamic_world_poses_payload(
    dynamic_entities: list[tuple[Any, Any, tuple[float, float, float]]],
) -> list[dict[str, Any]]:
    poses: list[dict[str, Any]] = []
    for spec, entity, scaled_offset in dynamic_entities:
        pose = _dynamic_entity_pose_payload(
            spec=spec,
            entity=entity,
            scaled_visual_origin_offset_xyz=scaled_offset,
        )
        if pose is not None:
            poses.append(pose)
    return poses


def _scaled_offset(
    offset_xyz: tuple[float, float, float],
    scale_xyz: tuple[float, float, float],
) -> tuple[float, float, float]:
    return tuple(offset_xyz[index] * scale_xyz[index] for index in range(3))


def open_genesis_world_scene(
    *,
    layout_path: Path,
    urdf_path: Path,
    dynamic_container_mode: GenesisDynamicContainerMode,
    duration_sec: float,
    no_viewer: bool,
    screenshot_path: Path | None,
    screenshot_size: tuple[int, int],
    live_state_base_url: str,
    live_joint_poll_hz: float,
    live_world_publish_hz: float,
    live_http_timeout_sec: float,
) -> None:
    import genesis as gs

    layout_name, specs = build_genesis_element_specs(layout_path)
    dynamic_count = sum(1 for spec in specs if spec.is_dynamic)
    print(
        "[genesis-world-open] "
        f"layout={layout_name} elements={len(specs)} dynamic={dynamic_count} "
        f"dynamic_container_mode={dynamic_container_mode}"
    )
    print("[genesis-world-open] Genesis mesh preparation can take a while on first build.")

    gs.init(backend=gs.cpu, logging_level="warning")
    points = tuple(spec.box_center_xyz for spec in specs)
    center, radius = scene_center_and_radius(points)
    camera_pos = (
        center[0] + radius * 2.4,
        center[1] - radius * 2.3,
        max(center[2] + radius * 1.55, 0.8),
    )
    scene = gs.Scene(
        show_viewer=not no_viewer,
        sim_options=gs.options.SimOptions(dt=0.01, gravity=(0.0, 0.0, -9.81)),
        rigid_options=gs.options.RigidOptions(
            enable_collision=True,
            enable_self_collision=False,
            enable_adjacent_collision=False,
            box_box_detection=True,
        ),
        viewer_options=gs.options.ViewerOptions(
            camera_pos=camera_pos,
            camera_lookat=center,
            camera_up=(0.0, 0.0, 1.0),
            camera_fov=45,
            run_in_thread=True,
            enable_gui=True,
        ),
    )
    _add_floor_entity(gs, scene)
    genesis_urdf_path = materialize_so101_genesis_urdf(urdf_path)
    robot_entity = scene.add_entity(
        gs.morphs.URDF(
            file=str(genesis_urdf_path.resolve()),
            pos=(0.0, 0.0, GENESIS_ROBOT_BASE_Z_OFFSET_M),
            fixed=True,
            merge_fixed_links=False,
            collision=True,
            visualization=True,
        ),
        material=_rigid_material_for_physics(
            gs,
            None,
            friction_fallback=DEFAULT_ROBOT_FRICTION,
        ),
        name="so101",
    )

    dynamic_entities: list[tuple[Any, Any, tuple[float, float, float]]] = []
    dynamic_visual_entities: list[
        tuple[Any, Any, tuple[float, float, float], tuple[float, float, float]]
    ] = []
    for spec in specs:
        if spec.is_dynamic and dynamic_container_mode == "mesh":
            entity = _add_mesh_entity(
                gs,
                scene,
                spec=spec,
                fixed=False,
                collision=True,
                name=spec.element.id,
                decimate=True,
                convexify=True,
                preserve_studio_glb_orientation=True,
            )
            dynamic_entities.append(
                (
                    spec,
                    entity,
                    _scaled_offset(
                        spec.mesh_bounds.studio_visual_offset_xyz,
                        spec.effective_scale_xyz,
                    ),
                )
            )
        elif spec.is_dynamic and dynamic_container_mode == "box":
            visual_entity = _add_mesh_entity(
                gs,
                scene,
                spec=spec,
                fixed=False,
                collision=False,
                name=f"{spec.element.id}_visual",
                decimate=False,
                convexify=False,
                preserve_studio_glb_orientation=True,
            )
            entity = _add_box_entity(
                gs,
                scene,
                spec=spec,
                fixed=False,
                collision=True,
                name=spec.element.id,
            )
            dynamic_entities.append(
                (
                    spec,
                    entity,
                    _scaled_offset(
                        spec.mesh_bounds.studio_visual_center_after_offset_xyz,
                        spec.effective_scale_xyz,
                    ),
                )
            )
            dynamic_visual_entities.append(
                (
                    visual_entity,
                    entity,
                    _scaled_offset(
                        spec.mesh_bounds.studio_visual_center_after_offset_xyz,
                        spec.effective_scale_xyz,
                    ),
                    _scaled_offset(
                        spec.mesh_bounds.studio_visual_offset_xyz,
                        spec.effective_scale_xyz,
                    ),
                )
            )
        else:
            _add_mesh_entity(
                gs,
                scene,
                spec=spec,
                fixed=True,
                collision=False,
                name=spec.element.id,
                decimate=False,
                convexify=False,
            )

    camera = None
    if screenshot_path is not None:
        camera = scene.add_camera(
            res=screenshot_size,
            pos=camera_pos,
            lookat=center,
            up=(0.0, 0.0, 1.0),
            fov=45,
            GUI=False,
        )

    scene.build()
    for spec, entity, _scaled_offset_xyz in dynamic_entities:
        _apply_rigid_entity_physics_overrides(entity, spec.element.physics)
    last_safe_robot_qpos = _to_float_list(robot_entity.get_qpos())
    _robot_floor_ok, last_safe_robot_qpos = _enforce_robot_floor_contact(
        robot_entity,
        last_safe_robot_qpos,
    )
    _enforce_dynamic_floor_contact(dynamic_entities)
    _sync_dynamic_visual_entities(dynamic_visual_entities)
    print("[genesis-world-open] scene built; stepping Genesis runtime.")
    live_base_url = live_state_base_url.strip().rstrip("/")
    live_enabled = bool(live_base_url)
    joint_dof_indices = _joint_dof_indices_by_name(robot_entity)
    configured_dofs = _configure_robot_position_controller(
        robot_entity,
        joint_dof_indices,
    )
    last_joint_sequence = 0
    last_state_publish_at = 0.0
    world_source_sequence = 0
    joint_poll_interval = (
        1.0 / live_joint_poll_hz
        if live_joint_poll_hz > 0 and math.isfinite(live_joint_poll_hz)
        else 0.0
    )
    world_publish_interval = (
        1.0 / live_world_publish_hz
        if live_world_publish_hz > 0 and math.isfinite(live_world_publish_hz)
        else 0.0
    )
    if live_enabled:
        print(
            "[genesis-world-open] live sync enabled "
            f"joints={len(joint_dof_indices)} controller_dofs={configured_dofs} "
            f"dynamic_entities={len(dynamic_entities)}"
        )
    live_bridge = (
        _GenesisLiveHttpBridge(
            base_url=live_base_url,
            joint_poll_interval=joint_poll_interval,
            state_publish_interval=world_publish_interval,
            timeout_sec=live_http_timeout_sec,
        )
        if live_enabled
        else None
    )
    if live_bridge is not None:
        live_bridge.start()

    def apply_latest_live_joint_command() -> None:
        nonlocal last_joint_sequence
        if live_bridge is None:
            return
        latest = live_bridge.read_latest_joint_values()
        if latest is None:
            return
        sequence, joint_values = latest
        if sequence <= last_joint_sequence:
            return
        last_joint_sequence = sequence
        _apply_live_joint_values(robot_entity, joint_dof_indices, joint_values)

    def queue_latest_live_feedback(source_sequence: int) -> None:
        if live_bridge is None:
            return
        live_bridge.queue_robot_joint_values(
            _robot_joint_values_payload(robot_entity, joint_dof_indices)
        )
        if dynamic_entities:
            live_bridge.queue_world_state(
                source_sequence=source_sequence,
                poses=_dynamic_world_poses_payload(dynamic_entities),
            )

    if screenshot_path is not None and camera is not None:
        from PIL import Image

        scene.step()
        _robot_floor_ok, last_safe_robot_qpos = _enforce_robot_floor_contact(
            robot_entity,
            last_safe_robot_qpos,
        )
        _enforce_dynamic_floor_contact(dynamic_entities)
        _sync_dynamic_visual_entities(dynamic_visual_entities)
        image = camera.render(rgb=True)[0]
        screenshot_path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(image).save(screenshot_path)
        print(f"[genesis-world-open] screenshot written: {screenshot_path}")

    if no_viewer:
        headless_steps = 5
        if duration_sec > 0 and math.isfinite(duration_sec):
            headless_steps = max(headless_steps, int(math.ceil(duration_sec / 0.01)))
        for _ in range(headless_steps):
            apply_latest_live_joint_command()
            scene.step()
            _robot_floor_ok, last_safe_robot_qpos = _enforce_robot_floor_contact(
                robot_entity,
                last_safe_robot_qpos,
            )
            _enforce_dynamic_floor_contact(dynamic_entities)
            _sync_dynamic_visual_entities(dynamic_visual_entities)
        queue_latest_live_feedback(max(1, headless_steps))
        if live_bridge is not None:
            live_bridge.close()
        return

    def step_live_runtime() -> None:
        nonlocal last_joint_sequence
        nonlocal last_state_publish_at
        nonlocal world_source_sequence
        nonlocal last_safe_robot_qpos
        apply_latest_live_joint_command()

        scene.step()
        _robot_floor_ok, last_safe_robot_qpos = _enforce_robot_floor_contact(
            robot_entity,
            last_safe_robot_qpos,
        )
        _enforce_dynamic_floor_contact(dynamic_entities)
        _sync_dynamic_visual_entities(dynamic_visual_entities)

        now = time.monotonic()
        if (
            live_enabled
            and now - last_state_publish_at >= world_publish_interval
        ):
            last_state_publish_at = now
            world_source_sequence += 1
            queue_latest_live_feedback(world_source_sequence)

    if duration_sec <= 0:
        print("[genesis-world-open] Genesis viewer opened. Press Ctrl-C to return.")
        try:
            while True:
                step_live_runtime()
                time.sleep(1.0 / 60.0)
        except KeyboardInterrupt:
            if live_bridge is not None:
                live_bridge.close()
            return

    deadline = time.monotonic() + duration_sec
    while time.monotonic() < deadline:
        step_live_runtime()
        time.sleep(1.0 / 60.0)
    if live_bridge is not None:
        live_bridge.close()


def main() -> int:
    args = _parse_args()
    open_genesis_world_scene(
        layout_path=Path(args.layout),
        urdf_path=Path(args.urdf),
        dynamic_container_mode=args.dynamic_container_mode,
        duration_sec=args.duration_sec,
        no_viewer=args.no_viewer,
        screenshot_path=Path(args.screenshot) if args.screenshot else None,
        screenshot_size=(args.screenshot_width, args.screenshot_height),
        live_state_base_url=args.live_state_base_url,
        live_joint_poll_hz=args.live_joint_poll_hz,
        live_world_publish_hz=args.live_world_publish_hz,
        live_http_timeout_sec=args.live_http_timeout_sec,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
