from __future__ import annotations

"""
Shim entrypoint for running the FastAPI app.
Actual application wiring lives in backend.app.
"""

import importlib
from collections.abc import Callable

from backend.app import app, create_app
from backend.core.settings import settings
from backend.services.import_utils import module_not_found_matches_import_name


__all__ = ["app", "create_app"]


def _load_uvicorn_run() -> Callable[..., object]:
    try:
        uvicorn = importlib.import_module("uvicorn")
    except ModuleNotFoundError as exc:
        if not module_not_found_matches_import_name(exc.name, "uvicorn"):
            raise
        raise RuntimeError("Running backend.server requires uvicorn to be installed") from exc
    run_server = getattr(uvicorn, "run", None)
    if not callable(run_server):
        raise RuntimeError("uvicorn.run is unavailable")
    return run_server


def _run_uvicorn_app() -> None:
    _load_uvicorn_run()(
        "backend.app:app",
        host=settings.api_bind_host,
        port=settings.api_port,
    )


if __name__ == "__main__":
    _run_uvicorn_app()
