"""Registry for custom success checkers — extend the checker set without
patching the vendored Genie Sim Ader engine.

The vendored ``parse_action`` (backend/vendor/geniesim/.../action_parsing.py)
dispatches a fixed set of checker DSL keys and raises on anything else. Rather
than edit that vendored file, a checker plugin registers:

- a structured success name (used in a scenario's ``success.all_of``),
- an Ader DSL key,
- ``compile(params) -> "pipe|separated|value"`` (structured form -> DSL), and
- ``build(env, value) -> EvaluateAction`` (DSL -> a live checker node).

At evaluation time ``install_registry_parser()`` temporarily wraps the module
global ``parse_action`` so registered keys build the plugin's checker and
everything else delegates to the vendored parser. Because the vendored
container nodes recurse through that same module global, registered checkers
work anywhere in the tree — including nested inside ``ActionSetWaitAll`` — with
no vendored edits.

Checkers subclass the vendored ``EvaluateAction`` (imported lazily) so they
reuse its APICore accessors (``get_obj_pose``/``get_obj_aabb``/…) and run
against every simulator backend unchanged.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass
from typing import Any, Callable

from backend.models.json_payload import JsonObject
from backend.services.scenario_runtime.vendor_loader import ensure_geniesim_on_path


@dataclass(frozen=True)
class CheckerPlugin:
    name: str  # structured success key, e.g. "near"
    dsl_key: str  # Ader DSL key, e.g. "Near"
    compile: Callable[[JsonObject], str]  # params -> pipe-separated DSL value
    build: Callable[[Any, str], Any]  # (env, value) -> EvaluateAction


_PLUGINS_BY_NAME: dict[str, CheckerPlugin] = {}
_PLUGINS_BY_DSL_KEY: dict[str, CheckerPlugin] = {}


def register_checker(plugin: CheckerPlugin) -> CheckerPlugin:
    if plugin.name in _PLUGINS_BY_NAME:
        raise ValueError(f"Checker already registered: {plugin.name!r}")
    if plugin.dsl_key in _PLUGINS_BY_DSL_KEY:
        raise ValueError(f"Checker DSL key already registered: {plugin.dsl_key!r}")
    _PLUGINS_BY_NAME[plugin.name] = plugin
    _PLUGINS_BY_DSL_KEY[plugin.dsl_key] = plugin
    return plugin


def registered_checker_names() -> frozenset[str]:
    return frozenset(_PLUGINS_BY_NAME)


def plugin_by_name(name: str) -> CheckerPlugin | None:
    return _PLUGINS_BY_NAME.get(name)


def plugin_by_dsl_key(dsl_key: str) -> CheckerPlugin | None:
    return _PLUGINS_BY_DSL_KEY.get(dsl_key)


@contextlib.contextmanager
def install_registry_parser():
    """Patch the vendored module-global parse_action to consult the registry."""
    ensure_geniesim_on_path()
    from geniesim_benchmark.plugins.ader.action import action_parsing

    original = action_parsing.parse_action

    def wrapper(obj: Any, task_progress: list, env: Any):
        if isinstance(obj, dict) and len(obj) == 1:
            (key, value), = obj.items()
            plugin = plugin_by_dsl_key(key)
            if plugin is not None:
                action = plugin.build(env, value)
                action_parsing.record_act_obj(action, task_progress)
                return action
        return original(obj, task_progress, env)

    action_parsing.parse_action = wrapper
    try:
        yield
    finally:
        action_parsing.parse_action = original


# --- shipped example checker: `near` (a distance predicate the vendored subset lacks) ---


def _build_near_checker(env: Any, value: str):
    ensure_geniesim_on_path()
    import numpy as np
    from geniesim_benchmark.plugins.ader.action.common_actions import EvaluateAction

    params = value.split("|")
    object_name, reference_name = params[0], params[1]
    distance_m = float(params[2]) if len(params) > 2 else 0.1
    required_frames = int(params[3]) if len(params) > 3 else 2

    class Near(EvaluateAction):
        """`object` within `distance_m` of `reference` for N consecutive ticks."""

        def __init__(self, environment: Any) -> None:
            super().__init__(environment)
            self._object = object_name
            self._reference = reference_name
            self._distance_m = distance_m
            self._required_frames = required_frames
            self._pass_frames = 0
            self._done_flag = False

        def update(self, delta_time: float) -> float:
            object_pose = self.get_obj_pose(self._object)
            reference_pose = self.get_obj_pose(self._reference)
            distance = float(np.linalg.norm(object_pose[:3, 3] - reference_pose[:3, 3]))
            if distance <= self._distance_m:
                self._pass_frames += 1
            else:
                self._pass_frames = 0
            if self._pass_frames >= self._required_frames:
                self._done_flag = True
            return super().update(delta_time)

        def _is_done(self) -> bool:
            return self._done_flag

        def update_progress(self) -> None:
            if self._done_flag:
                self.progress_info["STATUS"] = "SUCCESS"

        def handle_action_event(self, action: Any, event: Any) -> None:
            from geniesim_benchmark.plugins.ader.action.common_actions import ActionEvent

            if event == ActionEvent.FINISHED:
                self.progress_info["SCORE"] = 1

    return Near(env)


def _compile_near(params: JsonObject) -> str:
    distance = params.get("distance_m", 0.1)
    return f"{params['object']}|{params['reference']}|{distance}"


register_checker(
    CheckerPlugin(
        name="near",
        dsl_key="Near",
        compile=_compile_near,
        build=_build_near_checker,
    )
)
