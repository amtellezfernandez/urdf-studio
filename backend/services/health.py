from __future__ import annotations

from backend.models.health import HealthResponse


def dependency_health() -> HealthResponse:
    """Simple health probe + dependency sanity."""
    try:
        from pyroki import Robot  # type: ignore # noqa: F401
        pyroki_ok = True
    except Exception:  # pragma: no cover
        pyroki_ok = False
    try:
        import yourdfpy  # type: ignore # noqa: F401
        yourdfpy_ok = True
    except Exception:  # pragma: no cover
        yourdfpy_ok = False
    try:
        import rerun  # type: ignore # noqa: F401
        rerun_ok = True
    except Exception:  # pragma: no cover
        rerun_ok = False

    return HealthResponse(status="ok", pyroki=pyroki_ok, yourdfpy=yourdfpy_ok, rerun=rerun_ok)
