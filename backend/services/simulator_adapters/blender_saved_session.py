from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Mapping

from backend.core.paths import BASE_DIR
from backend.services.simulator_adapters.workspace_process import build_simulator_workspace_env

BLENDER_BLEND_VALIDATE_MARKER = "URDF_STUDIO_BLEND_VALIDATE "
BLENDER_BLEND_VALIDATE_TIMEOUT_SEC = 60.0


def validate_blender_blend_artifact(
    path: Path,
    *,
    blender_executable: str,
    expected_object_count: int,
    expected_camera_count: int,
) -> str | None:
    script = f"""
import json
import bpy
from mathutils import Vector

camera_count = sum(
    1
    for obj in bpy.data.objects
    if obj.get("urdf_studio_kind") == "camera"
)
world_objects = [
    obj
    for obj in bpy.data.objects
    if obj.get("urdf_studio_kind") == "world_object"
]


def object_and_descendants(obj):
    descendants = list(getattr(obj, "children_recursive", []) or [])
    return [obj, *descendants]


def object_world_bound_points(obj):
    bound_box = getattr(obj, "bound_box", None)
    matrix_world = getattr(obj, "matrix_world", None)
    if bound_box is None or matrix_world is None:
        return []
    try:
        return [matrix_world @ Vector(corner) for corner in bound_box]
    except (AttributeError, TypeError, ValueError):
        return []


def world_object_extent_xyz(root):
    points = [
        point
        for obj in object_and_descendants(root)
        if obj.visible_get()
        for point in object_world_bound_points(obj)
    ]
    if not points:
        return [0.0, 0.0, 0.0]
    return [
        float(max(point[index] for point in points) - min(point[index] for point in points))
        for index in range(3)
    ]


visible_world_object_count = sum(1 for obj in world_objects if obj.visible_get())
bounded_world_object_count = sum(
    1
    for obj in world_objects
    if max(world_object_extent_xyz(obj)) > 1e-6
)
print(
    {BLENDER_BLEND_VALIDATE_MARKER!r}
    + json.dumps(
        {{
            "world_object_count": len(world_objects),
            "visible_world_object_count": visible_world_object_count,
            "bounded_world_object_count": bounded_world_object_count,
            "camera_count": camera_count,
        }},
        sort_keys=True,
    ),
    flush=True,
)
"""
    try:
        process = subprocess.run(
            [
                blender_executable,
                "--background",
                str(path),
                "--python-expr",
                f"exec({script!r})",
            ],
            cwd=BASE_DIR,
            capture_output=True,
            text=True,
            timeout=BLENDER_BLEND_VALIDATE_TIMEOUT_SEC,
            check=False,
            env=build_simulator_workspace_env(
                BASE_DIR / ".cache" / "simulator-workspaces" / "runtime-cache"
            ),
        )
    except subprocess.TimeoutExpired:
        return (
            "Blender saved-session validation timed out after "
            f"{BLENDER_BLEND_VALIDATE_TIMEOUT_SEC:.1f}s"
        )
    output = "\n".join(part for part in (process.stdout, process.stderr) if part)
    if process.returncode != 0:
        return f"Blender saved-session validation exited with code {process.returncode}: {output.strip()}"
    payload = read_blender_validate_payload(output)
    if payload is None:
        return f"Blender saved-session validation did not emit {BLENDER_BLEND_VALIDATE_MARKER.strip()}"
    object_count = payload.get("world_object_count")
    if object_count != expected_object_count:
        return (
            "Blender saved-session world object count mismatch: "
            f"{object_count}, expected {expected_object_count}"
        )
    visible_object_count = payload.get("visible_world_object_count")
    if visible_object_count != expected_object_count:
        return (
            "Blender saved-session visible world object count mismatch: "
            f"{visible_object_count}, expected {expected_object_count}"
        )
    bounded_object_count = payload.get("bounded_world_object_count")
    if bounded_object_count != expected_object_count:
        return (
            "Blender saved-session bounded world object count mismatch: "
            f"{bounded_object_count}, expected {expected_object_count}"
        )
    camera_count = payload.get("camera_count")
    if camera_count != expected_camera_count:
        return (
            "Blender saved-session camera count mismatch: "
            f"{camera_count}, expected {expected_camera_count}"
        )
    return None


def read_blender_validate_payload(output: str) -> Mapping[str, object] | None:
    for line in output.splitlines():
        if not line.startswith(BLENDER_BLEND_VALIDATE_MARKER):
            continue
        try:
            payload = json.loads(line[len(BLENDER_BLEND_VALIDATE_MARKER) :])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, Mapping):
            return payload
    return None
