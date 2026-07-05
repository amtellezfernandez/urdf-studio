from __future__ import annotations

import builtins

import pytest

from backend.services.health import dependency_health


def test_dependency_health_reports_installed_dependency() -> None:
    response = dependency_health()

    assert response.status == "ok"
    assert isinstance(response.yourdfpy, bool)


def test_dependency_health_reports_missing_dependency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_import = builtins.__import__

    def _fake_import(name: str, *args: object, **kwargs: object) -> object:
        if name == "yourdfpy":
            raise ImportError("missing yourdfpy")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _fake_import)

    response = dependency_health()

    assert response.status == "ok"
    assert response.yourdfpy is False
