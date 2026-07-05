from __future__ import annotations

"""
Shim entrypoint for running the FastAPI app.
Actual application wiring lives in backend.app.
"""

import importlib

from backend.app import app, create_app
from backend.core.settings import settings


__all__ = ["app", "create_app"]


def _run_uvicorn_app() -> None:
    try:
        uvicorn = importlib.import_module("uvicorn")
    except ImportError as exc:
        raise RuntimeError("Running backend.server requires uvicorn to be installed") from exc
    run_server = getattr(uvicorn, "run", None)
    if not callable(run_server):
        raise RuntimeError("uvicorn.run is unavailable")

    run_server(
        "backend.app:app",
        host=settings.api_bind_host,
        port=settings.api_port,
    )


if __name__ == "__main__":
    _run_uvicorn_app()
