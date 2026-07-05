from __future__ import annotations

import importlib
from typing import Any

from backend.services.import_utils import module_not_found_matches_import_name


def load_yourdfpy_urdf_loader() -> Any:
    try:
        yourdfpy_module = importlib.import_module("yourdfpy")
    except ModuleNotFoundError as exc:
        if not module_not_found_matches_import_name(exc.name, "yourdfpy"):
            raise
        raise ValueError("yourdfpy is not installed") from exc
    urdf_class = getattr(yourdfpy_module, "URDF", None)
    load_urdf = getattr(urdf_class, "load", None)
    if not callable(load_urdf):
        raise ValueError("yourdfpy.URDF.load is unavailable")
    return load_urdf


def yourdfpy_urdf_loader_available() -> bool:
    try:
        load_yourdfpy_urdf_loader()
    except ValueError:
        return False
    return True
