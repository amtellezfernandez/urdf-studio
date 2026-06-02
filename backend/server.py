from __future__ import annotations

"""
Shim entrypoint for running the FastAPI app.
Actual application wiring lives in backend.app.
"""

from backend.app import app, create_app
from backend.core.settings import settings


__all__ = ["app", "create_app"]


if __name__ == "__main__":
    import uvicorn  # type: ignore

    uvicorn.run(
        "backend.app:app",
        host=settings.api_bind_host,
        port=settings.api_port,
    )
