from __future__ import annotations

import importlib
from types import SimpleNamespace

import pytest

from backend.services import health as health_service
from backend.services.health import dependency_health


def test_dependency_health_reports_installed_dependency() -> None:
    response = dependency_health()

    assert response.status == "ok"
    assert isinstance(response.yourdfpy, bool)


def test_dependency_health_reports_missing_dependency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        importlib,
        "import_module",
        lambda _name: (_ for _ in ()).throw(ImportError("yourdfpy")),
    )

    response = dependency_health()

    assert response.status == "ok"
    assert response.yourdfpy is False


def test_dependency_health_reports_incomplete_dependency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        importlib,
        "import_module",
        lambda name: SimpleNamespace(URDF=SimpleNamespace(load=None)) if name == "yourdfpy" else None,
    )

    response = dependency_health()

    assert response.status == "ok"
    assert response.yourdfpy is False
