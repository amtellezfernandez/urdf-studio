from __future__ import annotations

import os
from dataclasses import dataclass

from backend.core.app_config import get_config_value, read_app_config
from backend.services.dataset_alignment_params import DEFAULT_EMBODIMENT_REGISTRY_FILENAME
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
    embodiment_registry_path: str
    simulator_api_token: str | None
    cam_to_sim_proxy_token: str | None
    cam_to_sim_public_base_url: str | None
    zra_orchestrator_enabled: bool
    zra_orchestrator_poll_interval_seconds: int
    zra_orchestrator_inactive_after_seconds: int
    zra_orchestrator_devices_path: str | None
    butterclaw_current_map_path: str
    butterclaw_slam_pose_path: str
    butterclaw_runtime_demo_enabled: bool
    butterclaw_repo_path: str
    butterclaw_python_path: str
    butterclaw_runtime_control_dir: str
    butterclaw_robot_runtime_root: str
    butterclaw_robot_remote_ip: str
    butterclaw_robot_id: str
    butterclaw_robot_port_zmq_cmd: int
    butterclaw_robot_port_zmq_observations: int
    butterclaw_robot_use_ssh_tunnel: bool
    butterclaw_robot_ssh_host: str
    butterclaw_robot_ssh_user: str
    butterclaw_robot_ssh_port: int
    butterclaw_robot_ping_first: bool
    butterclaw_robot_ping_count: int
    butterclaw_robot_runtime_wait_timeout_seconds: int
    butterclaw_robot_urdf_os_root: str
    butterclaw_robot_urdf_os_python: str
    butterclaw_command_timeout_seconds: int
    verifiable_robotics_repo_path: str
    verifiable_robotics_cargo_bin: str
    verifiable_robotics_timeout_seconds: int
    world_rollout_cli_path: str | None
    world_rollout_workspace_root: str
    world_rollout_timeout_seconds: int
    world_rollout_max_output_chars: int
    world_rollout_max_workers: int
    world_rollout_max_queued_jobs: int
    world_labs_api_key: str | None
    world_labs_api_base_url: str
    world_labs_timeout_seconds: int
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
    embodiment_registry_path = _read_str(
        "URDF_EMBODIMENT_REGISTRY_PATH",
        get_config_value(
            config,
            ["embodimentRegistry", "path"],
            DEFAULT_EMBODIMENT_REGISTRY_FILENAME,
        ),
    )
    simulator_api_token = _read_str("URDF_SIMULATOR_API_TOKEN", "").strip() or None
    cam_to_sim_proxy_token = _read_str("URDF_CAM_TO_SIM_PROXY_TOKEN", "").strip() or None
    cam_to_sim_public_base_url = _read_str(
        "URDF_CAM_TO_SIM_PUBLIC_BASE_URL",
        get_config_value(config, ["camToSim", "publicBaseUrl"], ""),
    ).strip() or None
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
    butterclaw_current_map_path = _read_str(
        "URDF_BUTTERCLAW_CURRENT_MAP_PATH",
        get_config_value(
            config,
            ["butterclaw", "currentMapPath"],
            "/home/am/dev/ButterClaw/map/current_map.md",
        ),
    )
    butterclaw_slam_pose_path = _read_str(
        "URDF_BUTTERCLAW_SLAM_POSE_PATH",
        get_config_value(
            config,
            ["butterclaw", "slamPosePath"],
            "/home/am/dev/ButterClaw/artifacts/slam_pose.json",
        ),
    )
    butterclaw_runtime_demo_enabled = _read_bool(
        "URDF_STUDIO_RUNTIME_DEMO",
        get_config_value(config, ["butterclaw", "runtimeDemoEnabled"], False),
    )
    butterclaw_repo_path = _read_str(
        "URDF_BUTTERCLAW_REPO_PATH",
        get_config_value(config, ["butterclaw", "repoPath"], "/home/am/dev/ButterClaw"),
    )
    butterclaw_python_path = _read_str(
        "URDF_BUTTERCLAW_PYTHON_PATH",
        get_config_value(
            config,
            ["butterclaw", "pythonPath"],
            "/home/am/dev/ButterClaw/.venv/bin/python",
        ),
    )
    butterclaw_runtime_control_dir = _read_str(
        "URDF_BUTTERCLAW_RUNTIME_CONTROL_DIR",
        get_config_value(
            config,
            ["butterclaw", "runtimeControlDir"],
            "/home/am/dev/ButterClaw/artifacts/latest/sim_control",
        ),
    )
    butterclaw_robot_runtime_root = _read_str(
        "URDF_BUTTERCLAW_ROBOT_RUNTIME_ROOT",
        get_config_value(
            config,
            ["butterclaw", "robotRuntimeRoot"],
            "/home/am/.butterclaw/robot-runtime",
        ),
    )
    butterclaw_robot_remote_ip = _read_str(
        "URDF_BUTTERCLAW_ROBOT_REMOTE_IP",
        get_config_value(config, ["butterclaw", "robotRemoteIp"], "100.68.67.21"),
    )
    butterclaw_robot_id = _read_str(
        "URDF_BUTTERCLAW_ROBOT_ID",
        get_config_value(config, ["butterclaw", "robotId"], "my_kiwi"),
    )
    butterclaw_robot_port_zmq_cmd = _read_int(
        "URDF_BUTTERCLAW_ROBOT_PORT_ZMQ_CMD",
        get_config_value(config, ["butterclaw", "robotPortZmqCmd"], 5555),
    )
    butterclaw_robot_port_zmq_observations = _read_int(
        "URDF_BUTTERCLAW_ROBOT_PORT_ZMQ_OBSERVATIONS",
        get_config_value(config, ["butterclaw", "robotPortZmqObservations"], 5557),
    )
    butterclaw_robot_use_ssh_tunnel = _read_bool(
        "URDF_BUTTERCLAW_ROBOT_USE_SSH_TUNNEL",
        get_config_value(config, ["butterclaw", "robotUseSshTunnel"], True),
    )
    butterclaw_robot_ssh_host = _read_str(
        "URDF_BUTTERCLAW_ROBOT_SSH_HOST",
        get_config_value(config, ["butterclaw", "robotSshHost"], "100.68.67.21"),
    )
    butterclaw_robot_ssh_user = _read_str(
        "URDF_BUTTERCLAW_ROBOT_SSH_USER",
        get_config_value(config, ["butterclaw", "robotSshUser"], "pi"),
    )
    butterclaw_robot_ssh_port = _read_int(
        "URDF_BUTTERCLAW_ROBOT_SSH_PORT",
        get_config_value(config, ["butterclaw", "robotSshPort"], 22),
    )
    butterclaw_robot_ping_first = _read_bool(
        "URDF_BUTTERCLAW_ROBOT_PING_FIRST",
        get_config_value(config, ["butterclaw", "robotPingFirst"], True),
    )
    butterclaw_robot_ping_count = _read_int(
        "URDF_BUTTERCLAW_ROBOT_PING_COUNT",
        get_config_value(config, ["butterclaw", "robotPingCount"], 1),
    )
    butterclaw_robot_runtime_wait_timeout_seconds = _read_int(
        "URDF_BUTTERCLAW_ROBOT_RUNTIME_WAIT_TIMEOUT_SECONDS",
        get_config_value(config, ["butterclaw", "robotRuntimeWaitTimeoutSeconds"], 45),
    )
    butterclaw_robot_urdf_os_root = _read_str(
        "URDF_BUTTERCLAW_ROBOT_URDF_OS_ROOT",
        get_config_value(config, ["butterclaw", "robotUrdfOsRoot"], ""),
    )
    butterclaw_robot_urdf_os_python = _read_str(
        "URDF_BUTTERCLAW_ROBOT_URDF_OS_PYTHON",
        get_config_value(config, ["butterclaw", "robotUrdfOsPython"], ""),
    )
    butterclaw_command_timeout_seconds = _read_int(
        "URDF_BUTTERCLAW_COMMAND_TIMEOUT_SECONDS",
        get_config_value(config, ["butterclaw", "commandTimeoutSeconds"], 180),
    )
    verifiable_robotics_repo_path = _read_str(
        "URDF_VERIFIABLE_ROBOTICS_REPO_PATH",
        get_config_value(
            config,
            ["verifiableRobotics", "repoPath"],
            "/home/am/dev/verifiable-robotics-protocol",
        ),
    )
    verifiable_robotics_cargo_bin = _read_str(
        "URDF_VERIFIABLE_ROBOTICS_CARGO_BIN",
        get_config_value(
            config,
            ["verifiableRobotics", "cargoBin"],
            "/home/am/.cargo/bin/cargo",
        ),
    )
    verifiable_robotics_timeout_seconds = _read_int(
        "URDF_VERIFIABLE_ROBOTICS_TIMEOUT_SECONDS",
        get_config_value(config, ["verifiableRobotics", "timeoutSeconds"], 600),
    )
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
    world_labs_api_key = _read_str("WORLD_LABS_API_KEY", "").strip() or None
    world_labs_api_base_url = _read_str(
        "WORLD_LABS_API_BASE_URL",
        get_config_value(
            config,
            ["worldLabs", "apiBaseUrl"],
            "https://api.worldlabs.ai/marble/v1",
        ),
    ).rstrip("/")
    world_labs_timeout_seconds = _read_int(
        "WORLD_LABS_TIMEOUT_SECONDS",
        get_config_value(config, ["worldLabs", "timeoutSeconds"], 30),
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
        embodiment_registry_path=embodiment_registry_path,
        simulator_api_token=simulator_api_token,
        cam_to_sim_proxy_token=cam_to_sim_proxy_token,
        cam_to_sim_public_base_url=cam_to_sim_public_base_url,
        zra_orchestrator_enabled=zra_orchestrator_enabled,
        zra_orchestrator_poll_interval_seconds=zra_orchestrator_poll_interval_seconds,
        zra_orchestrator_inactive_after_seconds=zra_orchestrator_inactive_after_seconds,
        zra_orchestrator_devices_path=zra_orchestrator_devices_path,
        butterclaw_current_map_path=butterclaw_current_map_path,
        butterclaw_slam_pose_path=butterclaw_slam_pose_path,
        butterclaw_runtime_demo_enabled=butterclaw_runtime_demo_enabled,
        butterclaw_repo_path=butterclaw_repo_path,
        butterclaw_python_path=butterclaw_python_path,
        butterclaw_runtime_control_dir=butterclaw_runtime_control_dir,
        butterclaw_robot_runtime_root=butterclaw_robot_runtime_root,
        butterclaw_robot_remote_ip=butterclaw_robot_remote_ip,
        butterclaw_robot_id=butterclaw_robot_id,
        butterclaw_robot_port_zmq_cmd=butterclaw_robot_port_zmq_cmd,
        butterclaw_robot_port_zmq_observations=butterclaw_robot_port_zmq_observations,
        butterclaw_robot_use_ssh_tunnel=butterclaw_robot_use_ssh_tunnel,
        butterclaw_robot_ssh_host=butterclaw_robot_ssh_host,
        butterclaw_robot_ssh_user=butterclaw_robot_ssh_user,
        butterclaw_robot_ssh_port=butterclaw_robot_ssh_port,
        butterclaw_robot_ping_first=butterclaw_robot_ping_first,
        butterclaw_robot_ping_count=butterclaw_robot_ping_count,
        butterclaw_robot_runtime_wait_timeout_seconds=butterclaw_robot_runtime_wait_timeout_seconds,
        butterclaw_robot_urdf_os_root=butterclaw_robot_urdf_os_root,
        butterclaw_robot_urdf_os_python=butterclaw_robot_urdf_os_python,
        butterclaw_command_timeout_seconds=butterclaw_command_timeout_seconds,
        verifiable_robotics_repo_path=verifiable_robotics_repo_path,
        verifiable_robotics_cargo_bin=verifiable_robotics_cargo_bin,
        verifiable_robotics_timeout_seconds=verifiable_robotics_timeout_seconds,
        world_rollout_cli_path=world_rollout_cli_path,
        world_rollout_workspace_root=world_rollout_workspace_root,
        world_rollout_timeout_seconds=world_rollout_timeout_seconds,
        world_rollout_max_output_chars=world_rollout_max_output_chars,
        world_rollout_max_workers=world_rollout_max_workers,
        world_rollout_max_queued_jobs=world_rollout_max_queued_jobs,
        world_labs_api_key=world_labs_api_key,
        world_labs_api_base_url=world_labs_api_base_url,
        world_labs_timeout_seconds=world_labs_timeout_seconds,
        cors_origins=cors_origins,
        enable_metrics=enable_metrics,
    )


settings = load_settings()
