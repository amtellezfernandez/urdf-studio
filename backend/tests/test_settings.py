from __future__ import annotations

from collections.abc import Mapping

import pytest

from backend.core import settings as settings_module


def _clear_urdf_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for env_key in tuple(settings_module.os.environ):
        if env_key.startswith("URDF_"):
            monkeypatch.delenv(env_key, raising=False)


def _install_settings_config(
    monkeypatch: pytest.MonkeyPatch,
    config: Mapping[str, object],
) -> None:
    _clear_urdf_env(monkeypatch)
    monkeypatch.setattr(settings_module, "read_app_config", lambda: config)


def _load_settings_with_config(
    monkeypatch: pytest.MonkeyPatch,
    config: Mapping[str, object],
) -> settings_module.Settings:
    _install_settings_config(monkeypatch, config)
    return settings_module.load_settings()


def test_load_settings_coerces_app_config_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded_settings = _load_settings_with_config(
        monkeypatch,
        {
            "web": {"host": "0.0.0.0", "port": "6200"},
            "api": {"host": "10.0.0.2", "port": "9000"},
            "ikd": {"enabled": "false"},
            "worldRollouts": {"timeoutSeconds": "45"},
        },
    )

    assert loaded_settings.web_host == "0.0.0.0"
    assert loaded_settings.web_port == 6200
    assert loaded_settings.api_host == "10.0.0.2"
    assert loaded_settings.api_port == 9000
    assert loaded_settings.world_bridge_use_worldd_proxy is False
    assert loaded_settings.world_rollout_timeout_seconds == 45


def test_load_settings_ignores_invalid_app_config_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded_settings = _load_settings_with_config(
        monkeypatch,
        {
            "web": {"host": 42, "port": "not-a-port"},
            "api": {"host": "", "port": True},
            "ikd": {"enabled": 7},
        },
    )

    assert loaded_settings.web_host == "localhost"
    assert loaded_settings.web_port == 5173
    assert loaded_settings.api_host == "127.0.0.1"
    assert loaded_settings.api_port == 8000
    assert loaded_settings.world_bridge_use_worldd_proxy is True


def test_load_settings_env_overrides_app_config_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_settings_config(
        monkeypatch,
        {
            "web": {"host": "0.0.0.0", "port": 6200},
            "ikd": {"enabled": False},
        },
    )
    monkeypatch.setenv("URDF_WEB_HOST", "localhost")
    monkeypatch.setenv("URDF_WEB_PORT", "7000")
    monkeypatch.setenv("URDF_WORLD_BRIDGE_USE_WORLDD_PROXY", "yes")

    loaded_settings = settings_module.load_settings()

    assert loaded_settings.web_host == "localhost"
    assert loaded_settings.web_port == 7000
    assert loaded_settings.world_bridge_use_worldd_proxy is True


def test_load_settings_invalid_env_override_uses_config_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_settings_config(
        monkeypatch,
        {"web": {"port": "6200"}},
    )
    monkeypatch.setenv("URDF_WEB_PORT", "not-a-port")

    loaded_settings = settings_module.load_settings()

    assert loaded_settings.web_port == 6200
