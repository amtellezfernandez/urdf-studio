"""Render a per-episode MP4 from a recorded trace (headless-safe).

The episode's recorded object trajectory is drawn as the same top-down +
side-view playback the HTML comparison report uses, rendered with PIL and
encoded to MP4 via imageio-ffmpeg. This is deterministic and works headless
(no GL context), so it runs in Docker/CI; it is a schematic orthographic view
of the rigid scene, not a photoreal 3D render (that would need per-backend
offscreen GL and is a future upgrade).

Enabled per scenario via ``evaluation.record_video``; a missing imageio/ffmpeg
toolchain degrades to a no-op with a warning rather than failing the run.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

_PANEL_W = 360
_PANEL_H = 320
_MARGIN = 24
_FPS = 20
_MAX_FRAMES = 400
_SIM_COLOR = "#0072b2"
_STATIC_COLOR = "#8a8f98"


class ScenarioVideoError(RuntimeError):
    ...


def _hex_rgb(color: str) -> tuple[int, int, int]:
    value = color.lstrip("#")
    if len(value) != 6:
        return (156, 163, 175)
    try:
        return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return (156, 163, 175)


def _scene_objects(world_payload: dict) -> list[dict]:
    body = world_payload.get("world", world_payload)
    objects = []
    for world_object in body.get("objects", []):
        if not isinstance(world_object, dict):
            continue
        physics = world_object.get("physics") if isinstance(world_object.get("physics"), dict) else {}
        simulation = (
            world_object.get("simulation") if isinstance(world_object.get("simulation"), dict) else {}
        )
        objects.append(
            {
                "id": str(world_object.get("id", "")),
                "position_xyz": [float(v) for v in world_object.get("position_xyz", (0, 0, 0))],
                "size_xyz": [float(v) for v in world_object.get("size_xyz", (0.1, 0.1, 0.1))],
                "color": str(world_object.get("color", _STATIC_COLOR)),
                "fixed": bool(physics.get("fixed", simulation.get("fixed", True))),
            }
        )
    return objects


def _read_object_frames(trace_path: Path) -> list[dict]:
    frames = []
    for line in trace_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        if record.get("stream") == "objects":
            frames.append(record.get("state", {}))
    return frames


def _bounds(scene_objects: list[dict], frames: list[dict]) -> tuple[float, float, float, float, float, float]:
    xs_min = ys_min = zs_min = math.inf
    xs_max = ys_max = zs_max = -math.inf

    def consider(pos, size) -> None:
        nonlocal xs_min, ys_min, zs_min, xs_max, ys_max, zs_max
        xs_min, xs_max = min(xs_min, pos[0] - size[0] / 2), max(xs_max, pos[0] + size[0] / 2)
        ys_min, ys_max = min(ys_min, pos[1] - size[1] / 2), max(ys_max, pos[1] + size[1] / 2)
        zs_min, zs_max = min(zs_min, pos[2] - size[2] / 2), max(zs_max, pos[2] + size[2] / 2)

    sizes = {obj["id"]: obj["size_xyz"] for obj in scene_objects}
    for obj in scene_objects:
        consider(obj["position_xyz"], obj["size_xyz"])
    for frame in frames:
        for object_id, pose in frame.items():
            consider(pose.get("position_xyz", [0, 0, 0]), sizes.get(object_id, [0.1, 0.1, 0.1]))
    pad = 0.08
    if xs_min is math.inf:
        return (-1, -1, -1, 1, 1, 1)
    return (xs_min - pad, ys_min - pad, zs_min - pad, xs_max + pad, ys_max + pad, zs_max + pad)


def render_episode_video(
    *,
    trace_path: Path,
    world_payload: dict,
    output_path: Path,
    fps: int = _FPS,
) -> Path | None:
    try:
        import imageio.v2 as imageio
        from PIL import Image, ImageDraw
    except ImportError as exc:  # pragma: no cover - optional toolchain
        raise ScenarioVideoError(f"video toolchain unavailable: {exc}") from exc

    scene_objects = _scene_objects(world_payload)
    frames = _read_object_frames(trace_path)
    if not frames:
        raise ScenarioVideoError("no object frames recorded in the trace")

    step = max(1, len(frames) // _MAX_FRAMES)
    sampled = frames[::step]
    bounds = _bounds(scene_objects, frames)
    sizes = {obj["id"]: obj["size_xyz"] for obj in scene_objects}
    sim_rgb = _hex_rgb(_SIM_COLOR)

    def projector(ha: int, hb: int, va: int, vb: int, x_off: int):
        h0, h1 = bounds[ha], bounds[hb]
        v0, v1 = bounds[va], bounds[vb]
        scale = min(
            (_PANEL_W - 2 * _MARGIN) / (h1 - h0 or 1),
            (_PANEL_H - 2 * _MARGIN) / (v1 - v0 or 1),
        )

        def to_px(pos, axis_h: int, axis_v: int) -> tuple[float, float]:
            px = x_off + _MARGIN + (pos[axis_h] - h0) * scale
            py = _PANEL_H - _MARGIN - (pos[axis_v] - v0) * scale
            return px, py

        return to_px, scale

    # Two panels: top (X horizontal=0, Y vertical=1), side (X=0, Z=2).
    top_to_px, top_scale = projector(0, 3, 1, 4, 0)
    side_to_px, side_scale = projector(0, 3, 2, 5, _PANEL_W)

    def draw_box(draw, to_px, scale, pos, size, axis_h, axis_v, outline, fill=None) -> None:
        cx, cy = to_px(pos, axis_h, axis_v)
        hw = size[axis_h] * scale / 2
        hh = size[axis_v] * scale / 2
        draw.rectangle([cx - hw, cy - hh, cx + hw, cy + hh], outline=outline, fill=fill, width=2)

    rendered: list = []
    for frame in sampled:
        image = Image.new("RGB", (_PANEL_W * 2, _PANEL_H), (15, 17, 21))
        draw = ImageDraw.Draw(image)
        draw.line([(_PANEL_W, 0), (_PANEL_W, _PANEL_H)], fill=(42, 47, 56), width=1)
        for obj in scene_objects:
            if not obj["fixed"]:
                continue
            draw_box(draw, top_to_px, top_scale, obj["position_xyz"], obj["size_xyz"], 0, 1, (138, 143, 152))
            draw_box(draw, side_to_px, side_scale, obj["position_xyz"], obj["size_xyz"], 0, 2, (138, 143, 152))
        for object_id, pose in frame.items():
            pos = pose.get("position_xyz", [0, 0, 0])
            size = sizes.get(object_id, [0.07, 0.07, 0.07])
            fill = tuple(int(c * 0.35 + 15 * 0.65) for c in sim_rgb)
            draw_box(draw, top_to_px, top_scale, pos, size, 0, 1, sim_rgb, fill)
            draw_box(draw, side_to_px, side_scale, pos, size, 0, 2, sim_rgb, fill)
        rendered.append(image)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with imageio.get_writer(str(output_path), fps=fps, macro_block_size=None) as writer:
        for image in rendered:
            writer.append_data(_to_array(image))
    return output_path


def _to_array(image):
    import numpy as np

    return np.asarray(image)
