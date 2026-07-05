from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TypeAlias

from backend.core.app_config import get_config_value, read_app_config
from backend.services.world_scene_package_params import DEFAULT_WORLD_REGISTRY_FILENAME
from backend.services.world_rollout_params import (
    DEFAULT_WORLD_ROLLOUT_MAX_OUTPUT_CHARS,
    DEFAULT_WORLD_ROLLOUT_MAX_QUEUED_JOBS,
    DEFAULT_WORLD_ROLLOUT_MAX_WORKERS,
    DEFAULT_WORLD_ROLLOUT_TIMEOUT_SECONDS,
    DEFAULT_WORLD_ROLLOUT_WORKSPACE_ROOT,
)
from backend.world_bridge.params import (
    WORLDD_DEFAULT_HOST,
    WORLDD_DEFAULT_PORT,
    WORLDD_DEFAULT_TIMEOUT_MS,
)

AppConfig: TypeAlias = Mapping[str, object]
ConfigPath: TypeAlias = Sequence[str]


def _coerce_int(value: object, default_value: int) -> int:
    if isinstance(value, bool):
        return default_value
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return default_value
        try:
            return int(candidate)
        except ValueError:
            return default_value
    return default_value


def _coerce_str(value: object, default_value: str) -> str:
    return value if isinstance(value, str) and value else default_value


def _coerce_bool(value: object, default_value: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off", ""}:
            return False
        return default_value
    return default_value


def _read_int(key: str, configured_value: object, default_value: int) -> int:
    raw = os.getenv(key)
    config_default = _coerce_int(configured_value, default_value)
    if raw is None:
        return config_default
    return _coerce_int(raw, config_default)


def _read_str(key: str, configured_value: object, default_value: str) -> str:
    raw = os.getenv(key)
    config_default = _coerce_str(configured_value, default_value)
    return raw if raw else config_default


def _read_bool(key: str, configured_value: object, default_value: bool) -> bool:
    raw = os.getenv(key)
    if raw is None:
        return _coerce_bool(configured_value, default_value)
    return _coerce_bool(raw, _coerce_bool(configured_value, default_value))


def _read_configured_int(
    config: AppConfig,
    env_key: str,
    path: ConfigPath,
    default_value: int,
) -> int:
    return _read_int(env_key, get_config_value(config, path, default_value), default_value)


def _read_configured_str(
    config: AppConfig,
    env_key: str,
    path: ConfigPath,
    default_value: str,
) -> str:
    return _read_str(env_key, get_config_value(config, path, default_value), default_value)


def _read_configured_bool(
    config: AppConfig,
    env_key: str,
    path: ConfigPath,
    default_value: bool,
) -> bool:
    return _read_bool(env_key, get_config_value(config, path, default_value), default_value)


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


def _home_path(*parts: str) -> str:
    return str(Path.home().joinpath(*parts))


@dataclass(frozen=True)
class Settings:
    web_host: str
    web_port: int
    api_host: str
    api_bind_host: str
    api_port: int
    worldd_host: str
    worldd_port: int
    worldd_timeout_ms: int
    world_bridge_use_worldd_proxy: bool
    world_registry_path: str
    simulator_api_token: str | None
    zra_orchestrator_enabled: bool
    zra_orchestrator_poll_interval_seconds: int
    zra_orchestrator_inactive_after_seconds: int
    zra_orchestrator_devices_path: str | None
    world_rollout_cli_path: str | None
    world_rollout_workspace_root: str
    world_rollout_timeout_seconds: int
    world_rollout_max_output_chars: int
    world_rollout_max_workers: int
    world_rollout_max_queued_jobs: int
    cors_origins: list[str]
    enable_metrics: bool


def load_settings() -> Settings:
    config = read_app_config()
    web_host = _read_configured_str(config, "URDF_WEB_HOST", ["web", "host"], "localhost")
    web_port = _read_configured_int(config, "URDF_WEB_PORT", ["web", "port"], 5173)
    api_host = _read_configured_str(config, "URDF_API_HOST", ["api", "host"], "127.0.0.1")
    api_bind_host = _read_str(
        "URDF_API_BIND_HOST",
        get_config_value(config, ["api", "bindHost"], api_host),
        api_host,
    )
    api_port = _read_configured_int(config, "URDF_API_PORT", ["api", "port"], 8000)
    worldd_host = _read_configured_str(
        config,
        "URDF_WORLDD_HOST",
        ["ikd", "host"],
        WORLDD_DEFAULT_HOST,
    )
    worldd_port = _read_configured_int(
        config,
        "URDF_WORLDD_PORT",
        ["ikd", "port"],
        WORLDD_DEFAULT_PORT,
    )
    worldd_timeout_ms = _read_configured_int(
        config,
        "URDF_WORLDD_TIMEOUT_MS",
        ["ikd", "requestTimeoutMs"],
        WORLDD_DEFAULT_TIMEOUT_MS,
    )
    world_bridge_use_worldd_proxy = _read_configured_bool(
        config,
        "URDF_WORLD_BRIDGE_USE_WORLDD_PROXY",
        ["ikd", "enabled"],
        True,
    )
    world_registry_path = _read_configured_str(
        config,
        "URDF_WORLD_REGISTRY_PATH",
        ["worldRegistry", "path"],
        DEFAULT_WORLD_REGISTRY_FILENAME,
    )
    simulator_api_token = _read_str("URDF_SIMULATOR_API_TOKEN", "", "").strip() or None
    zra_orchestrator_enabled = _read_configured_bool(
        config,
        "URDF_ZRA_ORCHESTRATOR_ENABLED",
        ["zraOrchestrator", "enabled"],
        False,
    )
    zra_orchestrator_poll_interval_seconds = _read_configured_int(
        config,
        "URDF_ZRA_ORCHESTRATOR_POLL_INTERVAL_SECONDS",
        ["zraOrchestrator", "pollIntervalSeconds"],
        15,
    )
    zra_orchestrator_inactive_after_seconds = _read_configured_int(
        config,
        "URDF_ZRA_ORCHESTRATOR_INACTIVE_AFTER_SECONDS",
        ["zraOrchestrator", "inactiveAfterSeconds"],
        60,
    )
    zra_orchestrator_devices_path = _read_configured_str(
        config,
        "URDF_ZRA_ORCHESTRATOR_DEVICES_PATH",
        ["zraOrchestrator", "devicesPath"],
        "",
    ).strip() or None
    world_rollout_cli_path = _read_configured_str(
        config,
        "URDF_WORLD_ROLLOUT_CLI",
        ["worldRollouts", "cliPath"],
        "",
    ).strip() or None
    world_rollout_workspace_root = _read_configured_str(
        config,
        "URDF_WORLD_ROLLOUT_WORKSPACE_ROOT",
        ["worldRollouts", "workspaceRoot"],
        DEFAULT_WORLD_ROLLOUT_WORKSPACE_ROOT,
    )
    world_rollout_timeout_seconds = _read_configured_int(
        config,
        "URDF_WORLD_ROLLOUT_TIMEOUT_SECONDS",
        ["worldRollouts", "timeoutSeconds"],
        DEFAULT_WORLD_ROLLOUT_TIMEOUT_SECONDS,
    )
    world_rollout_max_output_chars = _read_configured_int(
        config,
        "URDF_WORLD_ROLLOUT_MAX_OUTPUT_CHARS",
        ["worldRollouts", "maxOutputChars"],
        DEFAULT_WORLD_ROLLOUT_MAX_OUTPUT_CHARS,
    )
    world_rollout_max_workers = _read_configured_int(
        config,
        "URDF_WORLD_ROLLOUT_MAX_WORKERS",
        ["worldRollouts", "maxWorkers"],
        DEFAULT_WORLD_ROLLOUT_MAX_WORKERS,
    )
    world_rollout_max_queued_jobs = _read_configured_int(
        config,
        "URDF_WORLD_ROLLOUT_MAX_QUEUED_JOBS",
        ["worldRollouts", "maxQueuedJobs"],
        DEFAULT_WORLD_ROLLOUT_MAX_QUEUED_JOBS,
    )
    cors_origins = list(
        dict.fromkeys(
            _build_cors_origins(web_host, web_port)
            + _read_csv_list("URDF_CORS_ORIGINS")
        )
    )
    enable_metrics = _read_bool("URDF_STUDIO_METRICS", False, False)
    return Settings(
        web_host=web_host,
        web_port=web_port,
        api_host=api_host,
        api_bind_host=api_bind_host,
        api_port=api_port,
        worldd_host=worldd_host,
        worldd_port=worldd_port,
        worldd_timeout_ms=worldd_timeout_ms,
        world_bridge_use_worldd_proxy=world_bridge_use_worldd_proxy,
        world_registry_path=world_registry_path,
        simulator_api_token=simulator_api_token,
        zra_orchestrator_enabled=zra_orchestrator_enabled,
        zra_orchestrator_poll_interval_seconds=zra_orchestrator_poll_interval_seconds,
        zra_orchestrator_inactive_after_seconds=zra_orchestrator_inactive_after_seconds,
        zra_orchestrator_devices_path=zra_orchestrator_devices_path,
        world_rollout_cli_path=world_rollout_cli_path,
        world_rollout_workspace_root=world_rollout_workspace_root,
        world_rollout_timeout_seconds=world_rollout_timeout_seconds,
        world_rollout_max_output_chars=world_rollout_max_output_chars,
        world_rollout_max_workers=world_rollout_max_workers,
        world_rollout_max_queued_jobs=world_rollout_max_queued_jobs,
        cors_origins=cors_origins,
        enable_metrics=enable_metrics,
    )


settings = load_settings()
