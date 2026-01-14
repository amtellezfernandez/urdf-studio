from __future__ import annotations

"""
Shim entrypoint for running the FastAPI app.
Actual application wiring lives in backend.app.
"""

from backend.app import app, create_app


__all__ = ["app", "create_app"]


if __name__ == "__main__":
    import uvicorn  # type: ignore

    uvicorn.run("backend.app:app", host="127.0.0.1", port=8000, reload=True)
