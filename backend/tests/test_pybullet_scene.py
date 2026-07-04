from __future__ import annotations

import pytest

from backend.services.simulator_adapters import pybullet_scene
from backend.services.simulator_adapters.pybullet_scene import (
    PYBULLET_STATIC_JOINT_HOLD_FORCE,
    advance_pybullet_viewer_frame,
    apply_initial_pybullet_joint_positions,
    configure_pybullet_debug_camera,
    configure_pybullet_static_debug_viewer,
    configure_pybullet_static_interactive_viewer_gravity,
    hold_pybullet_current_joint_positions,
    is_pybullet_connected,
    pump_pybullet_static_debug_viewer,
    require_pybullet_gui_environment,
    should_step_pybullet_interactive_viewer_loop,
    should_step_pybullet_workspace_once,
    suspend_pybullet_gui_rendering_while_loading,
)


def test_pybullet_gui_static_viewer_reserves_mouse_for_camera_navigation() -> None:
    class _FakeRuntime:
        COV_ENABLE_MOUSE_PICKING = 42
        COV_ENABLE_KEYBOARD_SHORTCUTS = 43
        realtime_values: list[int] = []
        debug_visualizer_calls: list[tuple[int, int]] = []

        @classmethod
        def setRealTimeSimulation(cls, value: int) -> None:
            cls.realtime_values.append(value)

        @classmethod
        def configureDebugVisualizer(cls, flag: int, value: int) -> None:
            cls.debug_visualizer_calls.append((flag, value))

    debug_state = configure_pybullet_static_debug_viewer(_FakeRuntime, no_viewer=False)

    assert _FakeRuntime.realtime_values == [0]
    assert _FakeRuntime.debug_visualizer_calls == [(42, 0), (43, 1)]
    assert debug_state == {"mouse_picking": False, "keyboard_shortcuts": True}


def test_pybullet_headless_static_viewer_does_not_touch_gui_interaction_flags() -> None:
    class _FakeRuntime:
        COV_ENABLE_MOUSE_PICKING = 42
        COV_ENABLE_KEYBOARD_SHORTCUTS = 43
        realtime_values: list[int] = []
        debug_visualizer_calls: list[tuple[int, int]] = []

        @classmethod
        def setRealTimeSimulation(cls, value: int) -> None:
            cls.realtime_values.append(value)

        @classmethod
        def configureDebugVisualizer(cls, flag: int, value: int) -> None:
            cls.debug_visualizer_calls.append((flag, value))

    debug_state = configure_pybullet_static_debug_viewer(_FakeRuntime, no_viewer=True)

    assert _FakeRuntime.realtime_values == []
    assert _FakeRuntime.debug_visualizer_calls == []
    assert debug_state == {"mouse_picking": False, "keyboard_shortcuts": False}


def test_pybullet_static_viewer_pumps_gui_events_without_physics_step() -> None:
    class _FakeRuntime:
        COV_ENABLE_SINGLE_STEP_RENDERING = 17
        calls: list[object] = []

        @classmethod
        def getMouseEvents(cls) -> tuple[object, ...]:
            cls.calls.append("mouse")
            return ()

        @classmethod
        def getKeyboardEvents(cls) -> dict[str, object]:
            cls.calls.append("keyboard")
            return {}

        @classmethod
        def getDebugVisualizerCamera(cls) -> tuple[object, ...]:
            cls.calls.append("camera")
            return ()

        @classmethod
        def configureDebugVisualizer(cls, flag: int, value: int) -> None:
            cls.calls.append(("debug", flag, value))

    pump_state = pump_pybullet_static_debug_viewer(_FakeRuntime, no_viewer=False)

    assert _FakeRuntime.calls == [
        "mouse",
        "keyboard",
        "camera",
        ("debug", 17, 1),
    ]
    assert pump_state == {
        "mouse_events": True,
        "keyboard_events": True,
        "camera_state": True,
        "render_frame": True,
    }


def test_pybullet_headless_static_viewer_does_not_pump_gui_events() -> None:
    class _FakeRuntime:
        calls: list[str] = []

        @classmethod
        def getMouseEvents(cls) -> tuple[object, ...]:
            cls.calls.append("mouse")
            return ()

    pump_state = pump_pybullet_static_debug_viewer(_FakeRuntime, no_viewer=True)

    assert _FakeRuntime.calls == []
    assert pump_state == {
        "mouse_events": False,
        "keyboard_events": False,
        "camera_state": False,
        "render_frame": False,
    }


def test_pybullet_gui_rendering_is_suspended_only_while_loading() -> None:
    class _FakeRuntime:
        COV_ENABLE_RENDERING = 42
        debug_visualizer_calls: list[tuple[int, int]] = []

        @classmethod
        def configureDebugVisualizer(cls, flag: int, value: int) -> None:
            cls.debug_visualizer_calls.append((flag, value))

    with suspend_pybullet_gui_rendering_while_loading(_FakeRuntime, no_viewer=False) as suspended:
        assert suspended is True
        assert _FakeRuntime.debug_visualizer_calls == [(42, 0)]

    assert _FakeRuntime.debug_visualizer_calls == [(42, 0), (42, 1)]


def test_pybullet_gui_rendering_restores_after_load_error() -> None:
    class _FakeRuntime:
        COV_ENABLE_RENDERING = 42
        debug_visualizer_calls: list[tuple[int, int]] = []

        @classmethod
        def configureDebugVisualizer(cls, flag: int, value: int) -> None:
            cls.debug_visualizer_calls.append((flag, value))

    with pytest.raises(RuntimeError, match="load failed"):
        with suspend_pybullet_gui_rendering_while_loading(_FakeRuntime, no_viewer=False):
            raise RuntimeError("load failed")

    assert _FakeRuntime.debug_visualizer_calls == [(42, 0), (42, 1)]


def test_pybullet_headless_loading_does_not_touch_debug_rendering() -> None:
    class _FakeRuntime:
        COV_ENABLE_RENDERING = 42
        debug_visualizer_calls: list[tuple[int, int]] = []

        @classmethod
        def configureDebugVisualizer(cls, flag: int, value: int) -> None:
            cls.debug_visualizer_calls.append((flag, value))

    with suspend_pybullet_gui_rendering_while_loading(_FakeRuntime, no_viewer=True) as suspended:
        assert suspended is False

    assert _FakeRuntime.debug_visualizer_calls == []


def test_pybullet_gui_launch_requires_display(monkeypatch) -> None:
    monkeypatch.setattr(pybullet_scene.sys, "platform", "linux")
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)

    with pytest.raises(RuntimeError, match="no GUI display is available"):
        require_pybullet_gui_environment(no_viewer=False)

    require_pybullet_gui_environment(no_viewer=True)


def test_pybullet_initial_joint_positions_apply_by_joint_name() -> None:
    class _FakeRuntime:
        reset_calls: list[tuple[int, int, float]] = []

        @classmethod
        def getNumJoints(cls, _robot_id: int) -> int:
            return 3

        @classmethod
        def getJointInfo(cls, _robot_id: int, joint_index: int):
            if joint_index == 0:
                return (0, b"shoulder")
            if joint_index == 1:
                return (1, "elbow")
            return (2, b"wrist")

        @classmethod
        def resetJointState(cls, robot_id: int, joint_index: int, position: float) -> None:
            cls.reset_calls.append((robot_id, joint_index, position))

    applied_count = apply_initial_pybullet_joint_positions(
        _FakeRuntime,
        robot_id=99,
        joint_positions={
            "shoulder": 0.25,
            "elbow": -0.5,
            "missing": 0.7,
            "wrist": float("nan"),
        },
    )

    assert applied_count == 2
    assert _FakeRuntime.reset_calls == [
        (99, 0, 0.25),
        (99, 1, -0.5),
    ]


def test_pybullet_static_robot_holds_current_non_fixed_joint_positions() -> None:
    class _FakeRuntime:
        JOINT_FIXED = 4
        POSITION_CONTROL = 7
        control_calls: list[dict[str, object]] = []

        @classmethod
        def getNumJoints(cls, _robot_id: int) -> int:
            return 3

        @classmethod
        def getJointInfo(cls, _robot_id: int, joint_index: int):
            if joint_index == 0:
                return (0, b"shoulder", 0, 0, 0, 0, 0, 0, -1.0, 1.0, 12.0)
            if joint_index == 1:
                return (1, b"fixed_mount", cls.JOINT_FIXED, -1, -1, 0, 0, 0, 0, 0, 0)
            return (2, b"elbow", 0, 0, 0, 0, 0, 0, -1.0, 1.0, 0.0)

        @classmethod
        def getJointState(cls, _robot_id: int, joint_index: int):
            return (0.25 if joint_index == 0 else -0.5, 0.0, (0.0, 0.0, 0.0), 0.0)

        @classmethod
        def setJointMotorControl2(cls, robot_id: int, jointIndex: int, **kwargs) -> None:
            cls.control_calls.append({"robot_id": robot_id, "joint_index": jointIndex, **kwargs})

    held_count = hold_pybullet_current_joint_positions(_FakeRuntime, robot_id=99)

    assert held_count == 2
    assert _FakeRuntime.control_calls == [
        {
            "robot_id": 99,
            "joint_index": 0,
            "controlMode": 7,
            "targetPosition": 0.25,
            "targetVelocity": 0.0,
            "force": 12.0,
        },
        {
            "robot_id": 99,
            "joint_index": 2,
            "controlMode": 7,
            "targetPosition": -0.5,
            "targetVelocity": 0.0,
            "force": PYBULLET_STATIC_JOINT_HOLD_FORCE,
        },
    ]


def test_pybullet_default_gui_workspace_does_not_step_static_debug_view() -> None:
    assert should_step_pybullet_workspace_once(
        no_viewer=False,
        run_physics=False,
        camera_screenshot_dir=None,
        report_path=None,
    ) is False
    assert should_step_pybullet_workspace_once(
        no_viewer=False,
        run_physics=True,
        camera_screenshot_dir=None,
        report_path=None,
    ) is True
    assert should_step_pybullet_workspace_once(
        no_viewer=True,
        run_physics=False,
        camera_screenshot_dir=None,
        report_path=None,
    ) is True
    assert should_step_pybullet_workspace_once(
        no_viewer=False,
        run_physics=False,
        camera_screenshot_dir=None,
        report_path=__file__,
    ) is False


def test_pybullet_gui_loop_steps_only_for_explicit_dynamic_view() -> None:
    assert should_step_pybullet_interactive_viewer_loop(no_viewer=False, run_physics=False) is False
    assert should_step_pybullet_interactive_viewer_loop(no_viewer=False, run_physics=True) is True
    assert should_step_pybullet_interactive_viewer_loop(no_viewer=True, run_physics=True) is False


def test_pybullet_static_interactive_frame_pumps_mouse_events_without_physics_step() -> None:
    class _FakeRuntime:
        COV_ENABLE_SINGLE_STEP_RENDERING = 17
        calls: list[object] = []

        @classmethod
        def stepSimulation(cls) -> None:
            cls.calls.append("step")

        @classmethod
        def getMouseEvents(cls) -> tuple[object, ...]:
            cls.calls.append("mouse")
            return ()

        @classmethod
        def getKeyboardEvents(cls) -> dict[str, object]:
            cls.calls.append("keyboard")
            return {}

        @classmethod
        def getDebugVisualizerCamera(cls) -> tuple[object, ...]:
            cls.calls.append("camera")
            return ()

        @classmethod
        def configureDebugVisualizer(cls, flag: int, value: int) -> None:
            cls.calls.append(("debug", flag, value))

    state = advance_pybullet_viewer_frame(
        _FakeRuntime,
        no_viewer=False,
        run_physics=False,
    )

    assert _FakeRuntime.calls == [
        "mouse",
        "keyboard",
        "camera",
        ("debug", 17, 1),
    ]
    assert state == {
        "stepped": False,
        "pump": {
            "mouse_events": True,
            "keyboard_events": True,
            "camera_state": True,
            "render_frame": True,
        },
    }


def test_pybullet_dynamic_interactive_frame_steps_and_pumps_mouse_events() -> None:
    class _FakeRuntime:
        COV_ENABLE_SINGLE_STEP_RENDERING = 17
        calls: list[object] = []

        @classmethod
        def stepSimulation(cls) -> None:
            cls.calls.append("step")

        @classmethod
        def getMouseEvents(cls) -> tuple[object, ...]:
            cls.calls.append("mouse")
            return ()

        @classmethod
        def getKeyboardEvents(cls) -> dict[str, object]:
            cls.calls.append("keyboard")
            return {}

        @classmethod
        def getDebugVisualizerCamera(cls) -> tuple[object, ...]:
            cls.calls.append("camera")
            return ()

        @classmethod
        def configureDebugVisualizer(cls, flag: int, value: int) -> None:
            cls.calls.append(("debug", flag, value))

    state = advance_pybullet_viewer_frame(
        _FakeRuntime,
        no_viewer=False,
        run_physics=True,
    )

    assert _FakeRuntime.calls == [
        "step",
        "mouse",
        "keyboard",
        "camera",
        ("debug", 17, 1),
    ]
    assert state == {
        "stepped": True,
        "pump": {
            "mouse_events": True,
            "keyboard_events": True,
            "camera_state": True,
            "render_frame": True,
        },
    }


def test_pybullet_headless_frame_does_not_step_or_pump_gui_events() -> None:
    class _FakeRuntime:
        calls: list[object] = []

        @classmethod
        def stepSimulation(cls) -> None:
            cls.calls.append("step")

        @classmethod
        def getMouseEvents(cls) -> tuple[object, ...]:
            cls.calls.append("mouse")
            return ()

    state = advance_pybullet_viewer_frame(
        _FakeRuntime,
        no_viewer=True,
        run_physics=False,
    )

    assert _FakeRuntime.calls == []
    assert state == {
        "stepped": False,
        "pump": {
            "mouse_events": False,
            "keyboard_events": False,
            "camera_state": False,
            "render_frame": False,
        },
    }


def test_pybullet_static_gui_loop_uses_zero_gravity_for_interaction_without_settling() -> None:
    class _FakeRuntime:
        gravity_calls: list[tuple[float, float, float]] = []

        @classmethod
        def setGravity(cls, x: float, y: float, z: float) -> None:
            cls.gravity_calls.append((x, y, z))

    state = configure_pybullet_static_interactive_viewer_gravity(
        _FakeRuntime,
        no_viewer=False,
        run_physics=False,
    )

    assert state == {"enabled": True, "gravity_xyz": (0.0, 0.0, 0.0)}
    assert _FakeRuntime.gravity_calls == [(0.0, 0.0, 0.0)]


def test_pybullet_dynamic_gui_keeps_scene_gravity() -> None:
    class _FakeRuntime:
        gravity_calls: list[tuple[float, float, float]] = []

        @classmethod
        def setGravity(cls, x: float, y: float, z: float) -> None:
            cls.gravity_calls.append((x, y, z))

    state = configure_pybullet_static_interactive_viewer_gravity(
        _FakeRuntime,
        no_viewer=False,
        run_physics=True,
    )

    assert state == {"enabled": False, "reason": "dynamic_physics"}
    assert _FakeRuntime.gravity_calls == []


def test_pybullet_connection_probe_supports_client_id_and_default_signatures() -> None:
    class _ClientIdRuntime:
        seen_client_id = None

        @classmethod
        def isConnected(cls, client_id: int) -> bool:
            cls.seen_client_id = client_id
            return True

    class _DefaultRuntime:
        @classmethod
        def isConnected(cls) -> bool:
            return False

    assert is_pybullet_connected(_ClientIdRuntime, client_id=17) is True
    assert _ClientIdRuntime.seen_client_id == 17
    assert is_pybullet_connected(_DefaultRuntime, client_id=17) is False


def test_pybullet_debug_camera_fits_loaded_robot_and_workspace_objects() -> None:
    class _FakeRuntime:
        camera_call: dict[str, object] | None = None

        @classmethod
        def getNumJoints(cls, body_id: int) -> int:
            return 1 if body_id == 10 else 0

        @classmethod
        def getAABB(cls, body_id: int, link_id: int):
            if body_id == 10 and link_id == -1:
                return ((-0.2, -0.1, 0.0), (0.2, 0.1, 0.4))
            if body_id == 10 and link_id == 0:
                return ((0.1, -0.1, 0.3), (0.5, 0.1, 0.8))
            if body_id == 20 and link_id == -1:
                return ((1.0, -0.2, 0.0), (1.2, 0.2, 0.2))
            raise ValueError("unknown body")

        @classmethod
        def resetDebugVisualizerCamera(cls, **kwargs) -> None:
            cls.camera_call = kwargs

    camera_state = configure_pybullet_debug_camera(
        _FakeRuntime,
        no_viewer=False,
        body_ids=(10, 20),
    )

    assert camera_state["configured"] is True
    assert camera_state["source"] == "aabb"
    assert camera_state["body_count"] == 2
    assert _FakeRuntime.camera_call is not None
    assert _FakeRuntime.camera_call["cameraTargetPosition"] == (0.5, 0.0, 0.4)
    assert float(_FakeRuntime.camera_call["cameraDistance"]) >= 1.0


def test_pybullet_debug_camera_is_headless_noop() -> None:
    class _FakeRuntime:
        @classmethod
        def resetDebugVisualizerCamera(cls, **_kwargs) -> None:
            raise AssertionError("headless launch must not touch GUI camera")

    camera_state = configure_pybullet_debug_camera(
        _FakeRuntime,
        no_viewer=True,
        body_ids=(10,),
    )

    assert camera_state == {"configured": False, "reason": "headless"}
