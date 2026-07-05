from __future__ import annotations

from collections.abc import Iterator, Sequence
from contextlib import contextmanager
import math
import os
from pathlib import Path
import sys
from typing import Any, Literal, NotRequired, TypedDict

from backend.services.simulator_adapters.numeric import is_finite_number
from backend.services.simulator_adapters.params import PYBULLET_SCENE_PARAMS
from backend.services.simulator_adapters.scene_bounds import (
    Aabb,
    combine_aabbs,
    scene_bounds_from_aabbs,
)

PyBulletStaticViewerFlagName = Literal["mouse_picking", "keyboard_shortcuts"]
PyBulletViewerPumpStateName = Literal[
    "mouse_events",
    "keyboard_events",
    "camera_state",
]
PyBulletDebugCameraSource = Literal["aabb", "default"]
PyBulletUnavailableReason = Literal["headless", "api_missing"]
PyBulletGravityUnavailableReason = Literal["headless", "dynamic_physics", "api_missing"]

PYBULLET_STATIC_VIEWER_DEBUG_FLAGS: dict[PyBulletStaticViewerFlagName, tuple[str, int]] = {
    # Keep the mouse available for camera orbit/pan/zoom in static inspection
    # mode. Native PyBullet picking captures left-drag on fixed robot bodies,
    # which makes the viewer feel like mouse input is broken.
    "mouse_picking": ("COV_ENABLE_MOUSE_PICKING", 0),
    "keyboard_shortcuts": ("COV_ENABLE_KEYBOARD_SHORTCUTS", 1),
}
PYBULLET_STATIC_JOINT_HOLD_FORCE = 500.0


class PyBulletStaticDebugViewerState(TypedDict):
    mouse_picking: bool
    keyboard_shortcuts: bool


class PyBulletViewerPumpState(TypedDict):
    mouse_events: bool
    keyboard_events: bool
    camera_state: bool
    render_frame: bool


class PyBulletViewerFrameState(TypedDict):
    stepped: bool
    pump: PyBulletViewerPumpState


class PyBulletStaticInteractiveViewerGravityState(TypedDict):
    enabled: bool
    reason: NotRequired[PyBulletGravityUnavailableReason]
    gravity_xyz: NotRequired[tuple[float, float, float]]


class PyBulletDebugCameraState(TypedDict):
    configured: bool
    reason: NotRequired[PyBulletUnavailableReason]
    source: NotRequired[PyBulletDebugCameraSource]
    target_xyz: NotRequired[list[float]]
    distance_m: NotRequired[float]
    yaw_deg: NotRequired[float]
    pitch_deg: NotRequired[float]
    body_count: NotRequired[int]


def _joint_name_from_info(joint_info: Sequence[Any]) -> str:
    raw_name = joint_info[1]
    return raw_name.decode("utf-8", errors="replace") if isinstance(raw_name, bytes) else str(raw_name)


def _joint_type_from_info(joint_info: Sequence[Any]) -> Any:
    return joint_info[2] if len(joint_info) > 2 else None


def set_debug_visualizer_flag(pybullet: Any, flag_name: str, value: int) -> bool:
    configure_debug_visualizer = getattr(pybullet, "configureDebugVisualizer", None)
    flag = getattr(pybullet, flag_name, None)
    if configure_debug_visualizer is None or flag is None:
        return False
    configure_debug_visualizer(flag, value)
    return True


def configure_pybullet_static_debug_viewer(
    pybullet: Any,
    *,
    no_viewer: bool,
) -> PyBulletStaticDebugViewerState:
    if no_viewer:
        return {"mouse_picking": False, "keyboard_shortcuts": False}
    set_real_time = getattr(pybullet, "setRealTimeSimulation", None)
    if set_real_time is not None:
        set_real_time(0)
    debug_state: PyBulletStaticDebugViewerState = {
        "mouse_picking": False,
        "keyboard_shortcuts": False,
    }
    for name, (flag_name, value) in PYBULLET_STATIC_VIEWER_DEBUG_FLAGS.items():
        configured = set_debug_visualizer_flag(pybullet, flag_name, value)
        debug_state[name] = configured and bool(value)
    return debug_state


def pump_pybullet_static_debug_viewer(
    pybullet: Any,
    *,
    no_viewer: bool,
) -> PyBulletViewerPumpState:
    pump_state: PyBulletViewerPumpState = {
        "mouse_events": False,
        "keyboard_events": False,
        "camera_state": False,
        "render_frame": False,
    }
    if no_viewer:
        return pump_state

    pump_methods: tuple[tuple[PyBulletViewerPumpStateName, str], ...] = (
        ("mouse_events", "getMouseEvents"),
        ("keyboard_events", "getKeyboardEvents"),
        ("camera_state", "getDebugVisualizerCamera"),
    )
    for state_name, method_name in pump_methods:
        pump_state[state_name] = _call_optional_pybullet_viewer_method(pybullet, method_name)

    pump_state["render_frame"] = set_debug_visualizer_flag(
        pybullet,
        "COV_ENABLE_SINGLE_STEP_RENDERING",
        1,
    )
    return pump_state


def should_step_pybullet_interactive_viewer_loop(*, no_viewer: bool, run_physics: bool) -> bool:
    return not no_viewer and run_physics


def _optional_pybullet_api_error_types(pybullet: Any) -> tuple[type[BaseException], ...]:
    error_type = getattr(pybullet, "error", None)
    if isinstance(error_type, type) and issubclass(error_type, BaseException):
        return (TypeError, error_type)
    return (TypeError,)


def _pybullet_aabb_error_types(pybullet: Any) -> tuple[type[BaseException], ...]:
    error_type = getattr(pybullet, "error", None)
    if isinstance(error_type, type) and issubclass(error_type, BaseException):
        return (TypeError, ValueError, error_type)
    return (TypeError, ValueError)


def _call_optional_pybullet_viewer_method(pybullet: Any, method_name: str) -> bool:
    method = getattr(pybullet, method_name, None)
    if method is None:
        return False
    handled_error_types = _optional_pybullet_api_error_types(pybullet)
    try:
        method()
    except handled_error_types:
        return False
    return True


def advance_pybullet_viewer_frame(
    pybullet: Any,
    *,
    no_viewer: bool,
    run_physics: bool,
) -> PyBulletViewerFrameState:
    stepped = False
    if should_step_pybullet_interactive_viewer_loop(
        no_viewer=no_viewer,
        run_physics=run_physics,
    ):
        pybullet.stepSimulation()
        stepped = True
    return {
        "stepped": stepped,
        "pump": pump_pybullet_static_debug_viewer(pybullet, no_viewer=no_viewer),
    }


def configure_pybullet_static_interactive_viewer_gravity(
    pybullet: Any,
    *,
    no_viewer: bool,
    run_physics: bool,
) -> PyBulletStaticInteractiveViewerGravityState:
    if no_viewer:
        return {"enabled": False, "reason": "headless"}
    if run_physics:
        return {"enabled": False, "reason": "dynamic_physics"}
    set_gravity = getattr(pybullet, "setGravity", None)
    if set_gravity is None:
        return {"enabled": False, "reason": "api_missing"}
    static_gravity_xyz = (0.0, 0.0, 0.0)
    set_gravity(*static_gravity_xyz)
    return {"enabled": True, "gravity_xyz": static_gravity_xyz}


def has_pybullet_gui_display_environment() -> bool:
    if sys.platform in {"win32", "darwin"}:
        return True
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def require_pybullet_gui_environment(*, no_viewer: bool) -> None:
    if no_viewer or has_pybullet_gui_display_environment():
        return
    raise RuntimeError(
        "PyBullet interactive viewer requested, but no GUI display is available. "
        "Set DISPLAY or WAYLAND_DISPLAY before using Open; headless mode is reserved "
        "for workspace validation checks."
    )


def should_step_pybullet_workspace_once(
    *,
    no_viewer: bool,
    run_physics: bool,
    camera_screenshot_dir: Path | None,
    report_path: Path | None,
) -> bool:
    # Report generation is metadata-only; it must not advance a static GUI inspection scene.
    del report_path
    return no_viewer or run_physics or camera_screenshot_dir is not None


def is_pybullet_connected(pybullet: Any, client_id: int) -> bool:
    is_connected = getattr(pybullet, "isConnected", None)
    if is_connected is None:
        return True
    try:
        return bool(is_connected(client_id))
    except TypeError:
        return bool(is_connected())


def apply_initial_pybullet_joint_positions(
    pybullet: Any,
    robot_id: int,
    joint_positions: dict[str, float],
) -> int:
    applied_count = 0
    joint_indices_by_name: dict[str, int] = {}
    for joint_index in range(pybullet.getNumJoints(robot_id)):
        joint_indices_by_name[
            _joint_name_from_info(pybullet.getJointInfo(robot_id, joint_index))
        ] = joint_index

    for joint_name, position in joint_positions.items():
        joint_index = joint_indices_by_name.get(joint_name)
        if joint_index is None or not is_finite_number(position):
            continue
        pybullet.resetJointState(robot_id, joint_index, float(position))
        applied_count += 1
    return applied_count


def hold_pybullet_current_joint_positions(pybullet: Any, robot_id: int) -> int:
    position_control = getattr(pybullet, "POSITION_CONTROL", None)
    set_joint_motor_control = getattr(pybullet, "setJointMotorControl2", None)
    get_joint_state = getattr(pybullet, "getJointState", None)
    if position_control is None or set_joint_motor_control is None or get_joint_state is None:
        return 0
    fixed_joint_type = getattr(pybullet, "JOINT_FIXED", None)
    held_count = 0
    for joint_index in range(pybullet.getNumJoints(robot_id)):
        joint_info = pybullet.getJointInfo(robot_id, joint_index)
        if fixed_joint_type is not None and _joint_type_from_info(joint_info) == fixed_joint_type:
            continue
        joint_state = get_joint_state(robot_id, joint_index)
        target_position = float(joint_state[0])
        max_force = joint_info[10] if len(joint_info) > 10 else None
        force = (
            float(max_force)
            if is_finite_number(max_force) and float(max_force) > 0.0
            else PYBULLET_STATIC_JOINT_HOLD_FORCE
        )
        set_joint_motor_control(
            robot_id,
            joint_index,
            controlMode=position_control,
            targetPosition=target_position,
            targetVelocity=0.0,
            force=force,
        )
        held_count += 1
    return held_count


@contextmanager
def suspend_pybullet_gui_rendering_while_loading(pybullet: Any, *, no_viewer: bool) -> Iterator[bool]:
    if no_viewer or not set_debug_visualizer_flag(pybullet, "COV_ENABLE_RENDERING", 0):
        yield False
        return
    try:
        yield True
    finally:
        set_debug_visualizer_flag(pybullet, "COV_ENABLE_RENDERING", 1)


def pybullet_body_aabb(
    pybullet: Any,
    body_id: int,
) -> Aabb | None:
    get_aabb = getattr(pybullet, "getAABB", None)
    if get_aabb is None:
        return None

    min_xyz = [math.inf, math.inf, math.inf]
    max_xyz = [-math.inf, -math.inf, -math.inf]
    link_indices = [-1, *range(pybullet.getNumJoints(body_id))]
    handled_error_types = _pybullet_aabb_error_types(pybullet)
    for link_index in link_indices:
        try:
            aabb = get_aabb(body_id, link_index)
        except handled_error_types:
            continue
        if not aabb or len(aabb) != 2:
            continue
        try:
            lower = tuple(float(value) for value in aabb[0])
            upper = tuple(float(value) for value in aabb[1])
        except (TypeError, ValueError):
            continue
        if len(lower) != 3 or len(upper) != 3:
            continue
        for axis in range(3):
            min_xyz[axis] = min(min_xyz[axis], lower[axis])
            max_xyz[axis] = max(max_xyz[axis], upper[axis])

    if not all(math.isfinite(value) for value in (*min_xyz, *max_xyz)):
        return None
    return (
        (min_xyz[0], min_xyz[1], min_xyz[2]),
        (max_xyz[0], max_xyz[1], max_xyz[2]),
    )


def pybullet_scene_aabb(
    pybullet: Any,
    body_ids: Sequence[int],
) -> Aabb | None:
    return combine_aabbs(
        [
            body_bounds
            for body_id in body_ids
            if (body_bounds := pybullet_body_aabb(pybullet, body_id)) is not None
        ]
    )


def configure_pybullet_debug_camera(
    pybullet: Any,
    *,
    no_viewer: bool,
    body_ids: Sequence[int],
) -> PyBulletDebugCameraState:
    viewer = PYBULLET_SCENE_PARAMS.viewer
    reset_camera = getattr(pybullet, "resetDebugVisualizerCamera", None)
    if no_viewer:
        return {"configured": False, "reason": "headless"}
    if reset_camera is None:
        return {"configured": False, "reason": "api_missing"}

    body_aabbs = [
        body_bounds
        for body_id in body_ids
        if (body_bounds := pybullet_body_aabb(pybullet, body_id)) is not None
    ]
    bounds = scene_bounds_from_aabbs(
        body_aabbs,
        default_center_xyz=viewer.default_center_xyz,
        default_radius_m=viewer.default_radius_m,
        min_radius_m=viewer.min_radius_m,
    )
    bounds_source = "aabb" if bounds.item_count else "default"

    distance = max(bounds.radius_m * viewer.distance_scale, viewer.min_distance_m)
    reset_camera(
        cameraDistance=distance,
        cameraYaw=viewer.yaw_deg,
        cameraPitch=viewer.pitch_deg,
        cameraTargetPosition=bounds.center_xyz,
    )
    return {
        "configured": True,
        "source": bounds_source,
        "target_xyz": list(bounds.center_xyz),
        "distance_m": distance,
        "yaw_deg": viewer.yaw_deg,
        "pitch_deg": viewer.pitch_deg,
        "body_count": len(body_ids),
    }
