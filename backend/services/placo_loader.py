from __future__ import annotations

import importlib
from typing import Any

from backend.services.import_utils import module_not_found_matches_import_name


def _placo_runtime_available(placo_module: object) -> bool:
    return callable(getattr(placo_module, "RobotWrapper", None)) and callable(
        getattr(placo_module, "KinematicsSolver", None)
    )


def load_placo_module() -> Any | None:
    try:
        placo_module = importlib.import_module("placo")
    except ModuleNotFoundError as exc:
        if not module_not_found_matches_import_name(exc.name, "placo"):
            raise
        return None

    if not _placo_runtime_available(placo_module):
        return None
    return placo_module
