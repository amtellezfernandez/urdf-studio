from __future__ import annotations

import argparse
import json
import math
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
    GenesisDynamicContainerMode,
    build_genesis_element_specs,
    color_hex_to_rgb,
    scene_center_and_radius,
)


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
    return scene.add_entity(morph, **kwargs)


def _add_box_entity(gs, scene, *, spec, fixed: bool, collision: bool, name: str):
    surface = _surface_for_color(gs, spec.element.material_color) or gs.surfaces.Default(
        color=(0.9, 0.12, 0.12),
        opacity=1.0,
    )
    return scene.add_entity(
        gs.morphs.Box(
            size=spec.box_size_xyz,
            pos=spec.box_center_xyz,
            euler=_to_degrees(spec.element.rotation_rpy_rad),
            fixed=fixed,
            collision=collision,
        ),
        surface=surface,
        name=name,
    )


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


def _publish_dynamic_world_poses(
    *,
    base_url: str,
    source_sequence: int,
    dynamic_entities: list[tuple[Any, Any, tuple[float, float, float]]],
    timeout_sec: float,
) -> None:
    poses: list[dict[str, Any]] = []
    for spec, entity, scaled_offset in dynamic_entities:
        pose = _dynamic_entity_pose_payload(
            spec=spec,
            entity=entity,
            scaled_visual_origin_offset_xyz=scaled_offset,
        )
        if pose is not None:
            poses.append(pose)
    _post_json_url(
        f"{base_url.rstrip('/')}/world-state",
        {"source_sequence": source_sequence, "poses": poses},
        timeout_sec=timeout_sec,
    )


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
    scene.add_entity(
        gs.morphs.Plane(
            fixed=True,
            pos=(0.0, 0.0, 0.0),
            plane_size=(4.0, 4.0),
            collision=True,
        ),
        surface=gs.surfaces.Default(color=(0.16, 0.16, 0.16), opacity=0.35),
        name="floor",
    )
    robot_entity = scene.add_entity(
        gs.morphs.URDF(
            file=str(urdf_path.resolve()),
            fixed=True,
            merge_fixed_links=False,
            collision=True,
            visualization=True,
        ),
        name="so101",
    )

    dynamic_entities: list[tuple[Any, Any, tuple[float, float, float]]] = []
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
            _add_mesh_entity(
                gs,
                scene,
                spec=spec,
                fixed=True,
                collision=False,
                name=f"{spec.element.id}_visual",
                decimate=False,
                convexify=False,
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
    print("[genesis-world-open] scene built; stepping Genesis runtime.")
    live_base_url = live_state_base_url.strip().rstrip("/")
    live_enabled = bool(live_base_url)
    joint_dof_indices = _joint_dof_indices_by_name(robot_entity)
    last_joint_sequence = 0
    last_joint_poll_at = 0.0
    last_world_publish_at = 0.0
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
            f"joints={len(joint_dof_indices)} dynamic_entities={len(dynamic_entities)}"
        )

    if screenshot_path is not None and camera is not None:
        from PIL import Image

        scene.step()
        image = camera.render(rgb=True)[0]
        screenshot_path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(image).save(screenshot_path)
        print(f"[genesis-world-open] screenshot written: {screenshot_path}")

    if no_viewer:
        for _ in range(5):
            if live_enabled:
                latest = _latest_joint_values_from_backend(
                    live_base_url,
                    timeout_sec=live_http_timeout_sec,
                )
                if latest is not None:
                    last_joint_sequence, joint_values = latest
                    _apply_live_joint_values(robot_entity, joint_dof_indices, joint_values)
            scene.step()
        if live_enabled and dynamic_entities:
            _publish_dynamic_world_poses(
                base_url=live_base_url,
                source_sequence=1,
                dynamic_entities=dynamic_entities,
                timeout_sec=live_http_timeout_sec,
            )
        return

    def step_live_runtime() -> None:
        nonlocal last_joint_sequence
        nonlocal last_joint_poll_at
        nonlocal last_world_publish_at
        nonlocal world_source_sequence
        now = time.monotonic()
        if live_enabled and now - last_joint_poll_at >= joint_poll_interval:
            last_joint_poll_at = now
            latest = _latest_joint_values_from_backend(
                live_base_url,
                timeout_sec=live_http_timeout_sec,
            )
            if latest is not None:
                sequence, joint_values = latest
                if sequence > last_joint_sequence:
                    last_joint_sequence = sequence
                    _apply_live_joint_values(robot_entity, joint_dof_indices, joint_values)

        scene.step()

        now = time.monotonic()
        if (
            live_enabled
            and dynamic_entities
            and now - last_world_publish_at >= world_publish_interval
        ):
            last_world_publish_at = now
            world_source_sequence += 1
            _publish_dynamic_world_poses(
                base_url=live_base_url,
                source_sequence=world_source_sequence,
                dynamic_entities=dynamic_entities,
                timeout_sec=live_http_timeout_sec,
            )

    if duration_sec <= 0:
        print("[genesis-world-open] Genesis viewer opened. Press Ctrl-C to return.")
        try:
            while True:
                step_live_runtime()
                time.sleep(1.0 / 60.0)
        except KeyboardInterrupt:
            return

    deadline = time.monotonic() + duration_sec
    while time.monotonic() < deadline:
        step_live_runtime()
        time.sleep(1.0 / 60.0)


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
