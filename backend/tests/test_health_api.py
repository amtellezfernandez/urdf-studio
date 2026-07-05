from __future__ import annotations

import asyncio

import pytest

from backend.api import health as health_api


def _run_api(coro):
    return asyncio.run(coro)


def _clear_build_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for env_key in health_api.BUILD_SHA_ENV_KEYS:
        monkeypatch.delenv(env_key, raising=False)


def test_resolve_backend_build_defaults_to_dev_when_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_build_env(monkeypatch)

    assert health_api._resolve_backend_build() == health_api.DEFAULT_BACKEND_BUILD


def test_resolve_backend_build_uses_first_non_empty_env_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_build_env(monkeypatch)
    monkeypatch.setenv("URDF_STUDIO_BUILD_SHA", "   ")
    monkeypatch.setenv("VERCEL_GIT_COMMIT_SHA", "vercel-sha")
    monkeypatch.setenv("GITHUB_SHA", "github-sha")

    assert health_api._resolve_backend_build() == "vercel-sha"


def test_version_endpoint_returns_backend_service_and_resolved_build(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_build_env(monkeypatch)
    monkeypatch.setenv("SOURCE_VERSION", " source-sha ")

    response = _run_api(health_api.version())

    assert response == {
        "service": "backend",
        "build": "source-sha",
    }
