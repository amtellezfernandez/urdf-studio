from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

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
    web_host = _read_str("URDF_WEB_HOST", get_config_value(config, ["web", "host"], "localhost"))
    web_port = _read_int("URDF_WEB_PORT", get_config_value(config, ["web", "port"], 5173))
    api_host = _read_str("URDF_API_HOST", get_config_value(config, ["api", "host"], "127.0.0.1"))
    api_bind_host = _read_str(
        "URDF_API_BIND_HOST",
        get_config_value(config, ["api", "bindHost"], api_host),
    )
    api_port = _read_int("URDF_API_PORT", get_config_value(config, ["api", "port"], 8000))
    worldd_host = _read_str(
        "URDF_WORLDD_HOST",
        get_config_value(config, ["ikd", "host"], WORLDD_DEFAULT_HOST),
    )
    worldd_port = _read_int(
        "URDF_WORLDD_PORT",
        get_config_value(config, ["ikd", "port"], WORLDD_DEFAULT_PORT),
    )
    worldd_timeout_ms = _read_int(
        "URDF_WORLDD_TIMEOUT_MS",
        get_config_value(config, ["ikd", "requestTimeoutMs"], WORLDD_DEFAULT_TIMEOUT_MS),
    )
    world_bridge_use_worldd_proxy = _read_bool(
        "URDF_WORLD_BRIDGE_USE_WORLDD_PROXY",
        get_config_value(config, ["ikd", "enabled"], True),
    )
    world_registry_path = _read_str(
        "URDF_WORLD_REGISTRY_PATH",
        get_config_value(config, ["worldRegistry", "path"], DEFAULT_WORLD_REGISTRY_FILENAME),
    )
    simulator_api_token = _read_str("URDF_SIMULATOR_API_TOKEN", "").strip() or None
    zra_orchestrator_enabled = _read_bool(
        "URDF_ZRA_ORCHESTRATOR_ENABLED",
        get_config_value(config, ["zraOrchestrator", "enabled"], False),
    )
    zra_orchestrator_poll_interval_seconds = _read_int(
        "URDF_ZRA_ORCHESTRATOR_POLL_INTERVAL_SECONDS",
        get_config_value(config, ["zraOrchestrator", "pollIntervalSeconds"], 15),
    )
    zra_orchestrator_inactive_after_seconds = _read_int(
        "URDF_ZRA_ORCHESTRATOR_INACTIVE_AFTER_SECONDS",
        get_config_value(config, ["zraOrchestrator", "inactiveAfterSeconds"], 60),
    )
    zra_orchestrator_devices_path = _read_str(
        "URDF_ZRA_ORCHESTRATOR_DEVICES_PATH",
        get_config_value(config, ["zraOrchestrator", "devicesPath"], ""),
    ).strip() or None
    world_rollout_cli_path = _read_str(
        "URDF_WORLD_ROLLOUT_CLI",
        get_config_value(config, ["worldRollouts", "cliPath"], ""),
    ).strip() or None
    world_rollout_workspace_root = _read_str(
        "URDF_WORLD_ROLLOUT_WORKSPACE_ROOT",
        get_config_value(
            config,
            ["worldRollouts", "workspaceRoot"],
            DEFAULT_WORLD_ROLLOUT_WORKSPACE_ROOT,
        ),
    )
    world_rollout_timeout_seconds = _read_int(
        "URDF_WORLD_ROLLOUT_TIMEOUT_SECONDS",
        get_config_value(
            config,
            ["worldRollouts", "timeoutSeconds"],
            DEFAULT_WORLD_ROLLOUT_TIMEOUT_SECONDS,
        ),
    )
    world_rollout_max_output_chars = _read_int(
        "URDF_WORLD_ROLLOUT_MAX_OUTPUT_CHARS",
        get_config_value(
            config,
            ["worldRollouts", "maxOutputChars"],
            DEFAULT_WORLD_ROLLOUT_MAX_OUTPUT_CHARS,
        ),
    )
    world_rollout_max_workers = _read_int(
        "URDF_WORLD_ROLLOUT_MAX_WORKERS",
        get_config_value(
            config,
            ["worldRollouts", "maxWorkers"],
            DEFAULT_WORLD_ROLLOUT_MAX_WORKERS,
        ),
    )
    world_rollout_max_queued_jobs = _read_int(
        "URDF_WORLD_ROLLOUT_MAX_QUEUED_JOBS",
        get_config_value(
            config,
            ["worldRollouts", "maxQueuedJobs"],
            DEFAULT_WORLD_ROLLOUT_MAX_QUEUED_JOBS,
        ),
    )
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
