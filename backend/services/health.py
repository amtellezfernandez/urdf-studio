from __future__ import annotations

from backend.models.health import HealthResponse


def dependency_health() -> HealthResponse:
    """Simple health probe + dependency sanity."""
    try:
        import yourdfpy  # type: ignore # noqa: F401
        yourdfpy_ok = True
    except Exception:  # pragma: no cover
        yourdfpy_ok = False

    return HealthResponse(status="ok", yourdfpy=yourdfpy_ok)
