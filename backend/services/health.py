from __future__ import annotations

import importlib

from backend.models.health import HealthResponse


def _yourdfpy_available() -> bool:
    try:
        yourdfpy_module = importlib.import_module("yourdfpy")
    except ModuleNotFoundError as exc:
        if exc.name != "yourdfpy":
            raise
        return False
    urdf_class = getattr(yourdfpy_module, "URDF", None)
    return callable(getattr(urdf_class, "load", None))


def dependency_health() -> HealthResponse:
    """Simple health probe + dependency sanity."""
    yourdfpy_ok = _yourdfpy_available()

    return HealthResponse(status="ok", yourdfpy=yourdfpy_ok)
