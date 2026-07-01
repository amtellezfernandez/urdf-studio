from __future__ import annotations

import os
from dataclasses import dataclass

from backend.core.app_config import get_config_value, read_app_config


def _read_int(key: str, fallback: int) -> int:
    raw = os.getenv(key)
    if raw is None:
        return fallback
    try:
        return int(raw)
    except ValueError:
        return fallback


def _read_str(key: str, fallback: str) -> str:
    raw = os.getenv(key)
    return raw if raw else fallback


def _read_bool(key: str, fallback: bool) -> bool:
    raw = os.getenv(key)
    if raw is None:
        return fallback
    return raw.strip().lower() not in {"0", "false", "no", ""}


def _read_csv_list(key: str) -> list[str]:
    raw = os.getenv(key)
    if not raw:
        return []
    values = [entry.strip() for entry in raw.split(",")]
    return [entry for entry in values if entry]


def _build_cors_origins(web_host: str, web_port: int) -> list[str]:
    candidates = {web_host, "localhost", "127.0.0.1"}
    if web_host in {"0.0.0.0", "::"}:
        candidates.update({"localhost", "127.0.0.1"})
    return [f"http://{host}:{web_port}" for host in sorted(candidates) if host]


@dataclass(frozen=True)
class Settings:
    web_host: str
    web_port: int
    api_host: str
    api_bind_host: str
    api_port: int
    simulator_api_token: str | None
    cors_origins: list[str]
    enable_metrics: bool


def load_settings() -> Settings:
    config = read_app_config()
    web_host = _read_str("URDF_WEB_HOST", get_config_value(config, ["web", "host"], "localhost"))
    web_port = _read_int("URDF_WEB_PORT", get_config_value(config, ["web", "port"], 5173))
    api_host = _read_str("URDF_API_HOST", get_config_value(config, ["api", "host"], "127.0.0.1"))
    api_bind_host = _read_str(
        "URDF_API_BIND_HOST",
        get_config_value(config, ["api", "bindHost"], api_host),
    )
    api_port = _read_int("URDF_API_PORT", get_config_value(config, ["api", "port"], 8000))
    simulator_api_token = _read_str("URDF_SIMULATOR_API_TOKEN", "").strip() or None
    cors_origins = list(
        dict.fromkeys(
            _build_cors_origins(web_host, web_port)
            + _read_csv_list("URDF_CORS_ORIGINS")
        )
    )
    enable_metrics = _read_bool("URDF_STUDIO_METRICS", False)
    return Settings(
        web_host=web_host,
        web_port=web_port,
        api_host=api_host,
        api_bind_host=api_bind_host,
        api_port=api_port,
        simulator_api_token=simulator_api_token,
        cors_origins=cors_origins,
        enable_metrics=enable_metrics,
    )


settings = load_settings()
