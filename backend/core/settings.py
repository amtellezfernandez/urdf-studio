from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


def _read_config() -> dict:
    root_dir = Path(__file__).resolve().parents[2]
    config_path = root_dir / "config" / "app.config.json"
    if not config_path.exists():
        return {}
    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _get(config: dict, path: list[str], fallback):
    current = config
    for key in path:
        if not isinstance(current, dict) or key not in current:
            return fallback
        current = current[key]
    return current if current is not None else fallback


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
    api_port: int
    rerun_host: str
    rerun_web_port: int
    rerun_ws_port: int
    cors_origins: list[str]


def load_settings() -> Settings:
    config = _read_config()
    web_host = _read_str("URDF_WEB_HOST", _get(config, ["web", "host"], "localhost"))
    web_port = _read_int("URDF_WEB_PORT", _get(config, ["web", "port"], 5173))
    api_host = _read_str("URDF_API_HOST", _get(config, ["api", "host"], "127.0.0.1"))
    api_port = _read_int("URDF_API_PORT", _get(config, ["api", "port"], 8000))
    rerun_host = _read_str("URDF_RERUN_HOST", _get(config, ["rerun", "host"], "127.0.0.1"))
    rerun_web_port = _read_int("URDF_RERUN_WEB_PORT", _get(config, ["rerun", "webPort"], 9090))
    rerun_ws_port = _read_int("URDF_RERUN_WS_PORT", _get(config, ["rerun", "wsPort"], 9876))
    cors_origins = _build_cors_origins(web_host, web_port)
    return Settings(
        web_host=web_host,
        web_port=web_port,
        api_host=api_host,
        api_port=api_port,
        rerun_host=rerun_host,
        rerun_web_port=rerun_web_port,
        rerun_ws_port=rerun_ws_port,
        cors_origins=cors_origins,
    )


settings = load_settings()
