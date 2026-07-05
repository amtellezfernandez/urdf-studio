from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend import server


def test_run_uvicorn_app_uses_configured_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def _fake_run(app_path: str, *, host: str, port: int) -> None:
        captured.update({"app_path": app_path, "host": host, "port": port})

    monkeypatch.setattr(
        server.importlib,
        "import_module",
        lambda name: SimpleNamespace(run=_fake_run) if name == "uvicorn" else None,
    )

    server._run_uvicorn_app()

    assert captured == {
        "app_path": "backend.app:app",
        "host": server.settings.api_bind_host,
        "port": server.settings.api_port,
    }


def test_run_uvicorn_app_rejects_missing_uvicorn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _missing_import(name: str) -> object:
        raise ModuleNotFoundError(name, name="uvicorn")

    monkeypatch.setattr(server.importlib, "import_module", _missing_import)

    with pytest.raises(RuntimeError, match="requires uvicorn"):
        server._run_uvicorn_app()


def test_run_uvicorn_app_rejects_missing_run(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        server.importlib,
        "import_module",
        lambda name: SimpleNamespace(run=None) if name == "uvicorn" else None,
    )

    with pytest.raises(RuntimeError, match="uvicorn.run is unavailable"):
        server._run_uvicorn_app()


def test_run_uvicorn_app_preserves_unexpected_import_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _unexpected_import_error(name: str) -> object:
        raise ModuleNotFoundError("No module named 'h11'", name="h11")

    monkeypatch.setattr(server.importlib, "import_module", _unexpected_import_error)

    with pytest.raises(ModuleNotFoundError, match="h11"):
        server._run_uvicorn_app()
