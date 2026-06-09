from __future__ import annotations

import argparse
import os
import time
from pathlib import Path
from typing import Sequence

from backend.services.world_layout_static_transfer import (
    WorldLayoutBackend,
    WorldLayoutFrameMap,
    build_sim_primitives,
    export_primitives_to_mujoco_mjcf,
    load_static_world_layout,
    resolve_world_layout_frame_map,
)


DEFAULT_LAYOUT_PATH = Path("web/public/world-layouts/static-transfer-smoke.world-layout.json")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Open a URDF Studio static world-layout in MuJoCo or Genesis."
    )
    parser.add_argument(
        "layout",
        nargs="?",
        default=str(DEFAULT_LAYOUT_PATH),
        help="Path to a .world-layout.json or .world-package.json file.",
    )
    parser.add_argument(
        "--backend",
        choices=["mujoco", "genesis"],
        required=True,
        help="Simulator viewer to open.",
    )
    parser.add_argument(
        "--frame-map",
        choices=["auto", "studio-y-up-to-z-up", "identity"],
        default="auto",
        help="Coordinate conversion from URDF Studio layout coordinates to simulator coordinates.",
    )
    parser.add_argument(
        "--duration-sec",
        type=float,
        default=0.0,
        help="Optional viewer duration. 0 means interactive until the window closes/Ctrl-C.",
    )
    parser.add_argument(
        "--include-hidden",
        action="store_true",
        help="Include objects marked is_hidden=true.",
    )
    parser.add_argument(
        "--no-floor",
        action="store_true",
        help="Do not add a visual reference floor in the simulator viewer.",
    )
    parser.add_argument(
        "--write-mjcf",
        default="",
        help="Optional path to write the generated MuJoCo MJCF.",
    )
    parser.add_argument(
        "--screenshot",
        default="",
        help="Optional PNG path for a simulator-rendered screenshot.",
    )
    parser.add_argument(
        "--screenshot-width",
        type=int,
        default=1280,
        help="Screenshot width in pixels.",
    )
    parser.add_argument(
        "--screenshot-height",
        type=int,
        default=720,
        help="Screenshot height in pixels.",
    )
    parser.add_argument(
        "--no-viewer",
        action="store_true",
        help="Do not open an interactive viewer; useful with --screenshot or --write-mjcf.",
    )
    return parser.parse_args()


def _scene_center_and_radius(positions: Sequence[tuple[float, float, float]]) -> tuple[tuple[float, float, float], float]:
    if not positions:
        return (0.0, 0.0, 0.4), 1.0
    mins = [min(position[axis] for position in positions) for axis in range(3)]
    maxs = [max(position[axis] for position in positions) for axis in range(3)]
    center = tuple((mins[axis] + maxs[axis]) * 0.5 for axis in range(3))
    radius = max(
        0.75,
        max(
            sum((position[axis] - center[axis]) ** 2 for axis in range(3)) ** 0.5
            for position in positions
        ),
    )
    return center, radius


def _open_mujoco_viewer(
    *,
    primitives,
    model_name: str,
    duration_sec: float,
    include_floor: bool,
    write_mjcf: Path | None,
    screenshot_path: Path | None,
    screenshot_size: tuple[int, int],
    no_viewer: bool,
) -> None:
    if screenshot_path is not None:
        os.environ.setdefault("MUJOCO_GL", "egl")
    import mujoco
    import mujoco.viewer

    mjcf_text = export_primitives_to_mujoco_mjcf(
        primitives,
        model_name=model_name,
        include_floor=include_floor,
        offscreen_size=screenshot_size if screenshot_path is not None else None,
    )
    if write_mjcf is not None:
        write_mjcf.parent.mkdir(parents=True, exist_ok=True)
        write_mjcf.write_text(mjcf_text, encoding="utf-8")
    model = mujoco.MjModel.from_xml_string(mjcf_text)
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)

    if screenshot_path is not None:
        from PIL import Image

        width, height = screenshot_size
        center, radius = _scene_center_and_radius([primitive.position_xyz for primitive in primitives])
        camera = mujoco.MjvCamera()
        camera.type = mujoco.mjtCamera.mjCAMERA_FREE
        camera.lookat[:] = center
        camera.distance = max(radius * 4.0, 1.5)
        camera.azimuth = 135.0
        camera.elevation = -25.0
        renderer = mujoco.Renderer(model, height=height, width=width)
        try:
            renderer.update_scene(data, camera=camera)
            image = renderer.render()
            screenshot_path.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(image).save(screenshot_path)
        finally:
            renderer.close()
        print(f"[world-layout-open] MuJoCo screenshot written: {screenshot_path}")

    if no_viewer:
        return

    if duration_sec <= 0:
        print("[world-layout-open] MuJoCo viewer opened. Close the window to return.")
        mujoco.viewer.launch(model, data)
        return

    print(f"[world-layout-open] MuJoCo viewer opened for {duration_sec:.2f}s.")
    handle = mujoco.viewer.launch_passive(model, data)
    deadline = time.monotonic() + duration_sec
    try:
        while time.monotonic() < deadline and handle.is_running():
            mujoco.mj_forward(model, data)
            handle.sync()
            time.sleep(1.0 / 60.0)
    finally:
        handle.close()


def _open_genesis_viewer(
    *,
    primitives,
    duration_sec: float,
    include_floor: bool,
    screenshot_path: Path | None,
    screenshot_size: tuple[int, int],
    no_viewer: bool,
) -> None:
    import genesis as gs

    gs.init(backend=gs.cpu, logging_level="warning")
    center, radius = _scene_center_and_radius([primitive.position_xyz for primitive in primitives])
    camera_pos = (
        center[0] + radius * 2.6,
        center[1] - radius * 2.4,
        max(center[2] + radius * 1.7, 0.8),
    )
    scene = gs.Scene(
        show_viewer=not no_viewer,
        viewer_options=gs.options.ViewerOptions(
            camera_pos=camera_pos,
            camera_lookat=center,
            camera_fov=45,
            run_in_thread=True,
            enable_gui=True,
        ),
    )
    if include_floor:
        scene.add_entity(
            gs.morphs.Plane(fixed=True, pos=(0.0, 0.0, 0.0), plane_size=(4.0, 4.0)),
            surface=gs.surfaces.Default(color=(0.16, 0.16, 0.16), opacity=0.35),
            name="wl_reference_floor",
        )
    for primitive in primitives:
        if primitive.sim_type == "box":
            morph = gs.morphs.Box(
                size=primitive.size_xyz,
                pos=primitive.position_xyz,
                quat=primitive.quat_wxyz,
                fixed=True,
                collision=primitive.collision,
            )
        elif primitive.sim_type == "sphere":
            morph = gs.morphs.Sphere(
                radius=max(primitive.size_xyz) * 0.5,
                pos=primitive.position_xyz,
                quat=primitive.quat_wxyz,
                fixed=True,
                collision=primitive.collision,
            )
        elif primitive.sim_type == "cylinder":
            morph = gs.morphs.Cylinder(
                radius=primitive.size_xyz[0] * 0.5,
                height=primitive.size_xyz[2],
                pos=primitive.position_xyz,
                quat=primitive.quat_wxyz,
                fixed=True,
                collision=primitive.collision,
            )
        else:
            raise ValueError(f"Unsupported Genesis primitive type: {primitive.sim_type}")
        scene.add_entity(
            morph,
            surface=gs.surfaces.Default(color=primitive.rgba[:3], opacity=primitive.rgba[3]),
            name=primitive.sim_name,
        )
    camera = None
    if screenshot_path is not None:
        width, height = screenshot_size
        camera = scene.add_camera(
            res=(width, height),
            pos=camera_pos,
            lookat=center,
            up=(0.0, 0.0, 1.0),
            fov=45,
            GUI=False,
        )
    scene.build()

    if screenshot_path is not None and camera is not None:
        from PIL import Image

        scene.step()
        image = camera.render(rgb=True)[0]
        screenshot_path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(image).save(screenshot_path)
        print(f"[world-layout-open] Genesis screenshot written: {screenshot_path}")

    if no_viewer:
        return

    if duration_sec <= 0:
        print("[world-layout-open] Genesis viewer opened. Press Ctrl-C to return.")
        try:
            while True:
                scene.step()
                time.sleep(1.0 / 60.0)
        except KeyboardInterrupt:
            return

    print(f"[world-layout-open] Genesis viewer opened for {duration_sec:.2f}s.")
    deadline = time.monotonic() + duration_sec
    while time.monotonic() < deadline:
        scene.step()
        time.sleep(1.0 / 60.0)


def main() -> int:
    args = _parse_args()
    layout = load_static_world_layout(Path(args.layout))
    resolved_frame_map = resolve_world_layout_frame_map(layout, args.frame_map)
    primitives, warnings = build_sim_primitives(
        layout,
        frame_map=resolved_frame_map,
        include_hidden=args.include_hidden,
    )
    for warning in warnings:
        print(f"[world-layout-open] warning: {warning}")
    print(
        "[world-layout-open] "
        f"layout={layout.name} backend={args.backend} objects={len(primitives)} "
        f"frame_map={resolved_frame_map} requested_frame_map={args.frame_map}"
    )
    if args.backend == "mujoco":
        _open_mujoco_viewer(
            primitives=primitives,
            model_name=layout.name,
            duration_sec=args.duration_sec,
            include_floor=not args.no_floor,
            write_mjcf=Path(args.write_mjcf) if args.write_mjcf else None,
            screenshot_path=Path(args.screenshot) if args.screenshot else None,
            screenshot_size=(args.screenshot_width, args.screenshot_height),
            no_viewer=args.no_viewer,
        )
    else:
        _open_genesis_viewer(
            primitives=primitives,
            duration_sec=args.duration_sec,
            include_floor=not args.no_floor,
            screenshot_path=Path(args.screenshot) if args.screenshot else None,
            screenshot_size=(args.screenshot_width, args.screenshot_height),
            no_viewer=args.no_viewer,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
