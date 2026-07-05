from __future__ import annotations

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
    monkeypatch.setattr(health_service.importlib.util, "find_spec", lambda _name: None)

    response = dependency_health()

    assert response.status == "ok"
    assert response.yourdfpy is False
