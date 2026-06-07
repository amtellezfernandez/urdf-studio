from __future__ import annotations

import argparse
import math
import time
from pathlib import Path

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
):
    surface = _surface_for_color(gs, color_override or spec.element.material_color)
    morph = gs.morphs.Mesh(
        file=str(spec.asset_path.resolve()),
        pos=spec.mesh_position_xyz,
        euler=_to_degrees(spec.element.rotation_rpy_rad),
        scale=spec.element.scale_xyz,
        fixed=fixed,
        collision=collision,
        decimate=decimate,
        convexify=convexify,
    )
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


def open_genesis_world_scene(
    *,
    layout_path: Path,
    urdf_path: Path,
    dynamic_container_mode: GenesisDynamicContainerMode,
    duration_sec: float,
    no_viewer: bool,
    screenshot_path: Path | None,
    screenshot_size: tuple[int, int],
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
    scene.add_entity(
        gs.morphs.URDF(
            file=str(urdf_path.resolve()),
            fixed=True,
            merge_fixed_links=False,
            collision=True,
            visualization=True,
        ),
        name="so101",
    )

    for spec in specs:
        if spec.is_dynamic and dynamic_container_mode == "mesh":
            _add_mesh_entity(
                gs,
                scene,
                spec=spec,
                fixed=False,
                collision=True,
                name=spec.element.id,
                decimate=True,
                convexify=True,
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
            _add_box_entity(
                gs,
                scene,
                spec=spec,
                fixed=False,
                collision=True,
                name=spec.element.id,
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

    if screenshot_path is not None and camera is not None:
        from PIL import Image

        scene.step()
        image = camera.render(rgb=True)[0]
        screenshot_path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(image).save(screenshot_path)
        print(f"[genesis-world-open] screenshot written: {screenshot_path}")

    if no_viewer:
        for _ in range(5):
            scene.step()
        return

    if duration_sec <= 0:
        print("[genesis-world-open] Genesis viewer opened. Press Ctrl-C to return.")
        try:
            while True:
                scene.step()
                time.sleep(1.0 / 60.0)
        except KeyboardInterrupt:
            return

    deadline = time.monotonic() + duration_sec
    while time.monotonic() < deadline:
        scene.step()
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
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
