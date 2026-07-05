from __future__ import annotations

import importlib.util

from backend.models.health import HealthResponse


def dependency_health() -> HealthResponse:
    """Simple health probe + dependency sanity."""
    yourdfpy_ok = importlib.util.find_spec("yourdfpy") is not None

    return HealthResponse(status="ok", yourdfpy=yourdfpy_ok)
