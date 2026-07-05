from __future__ import annotations

import importlib
from typing import Any


def load_placo_module() -> Any | None:
    try:
        placo_module = importlib.import_module("placo")
    except ModuleNotFoundError as exc:
        if exc.name != "placo":
            raise
        return None

    if not callable(getattr(placo_module, "RobotWrapper", None)) or not callable(
        getattr(placo_module, "KinematicsSolver", None)
    ):
        return None
    return placo_module
