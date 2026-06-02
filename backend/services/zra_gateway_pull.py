from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from backend.core.settings import settings
from backend.models.attestation import ZraGatewayPullRequest


DEFAULT_ZRA_PULL_TIMEOUT_SECONDS = 10
ZRA_GATEWAY_LOCAL_PATH_ENV = "URDF_STUDIO_ZRA_GATEWAY_LOCAL_PATH"
ZRA_SSH_HOST_ENV = "URDF_STUDIO_ZRA_SSH_HOST"
ZRA_SSH_USER_ENV = "URDF_STUDIO_ZRA_SSH_USER"
ZRA_REMOTE_GATEWAY_PATH_ENV = "URDF_STUDIO_ZRA_REMOTE_GATEWAY_PATH"
SSH_NONINTERACTIVE_ARGS = [
    "-o",
    "StrictHostKeyChecking=no",
]


def _lookup_robot_pull_source(robot_id: str) -> dict | None:
    devices_path = settings.zra_orchestrator_devices_path
    if not devices_path:
        return None
    config_path = Path(devices_path)
    if not config_path.exists():
        return None
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        return None
    normalized_robot_id = robot_id.strip()
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        if str(entry.get("robot_id") or "").strip() == normalized_robot_id:
            return entry
    return None


def _resolve_target(value: str | None, env_key: str) -> str | None:
    if value and value.strip():
        return value.strip()
    env_value = os.getenv(env_key, "").strip()
    return env_value or None


def _read_local_gateway_decision(path_value: str) -> dict:
    path = Path(path_value)
    gateway_decision = json.loads(path.read_text(encoding="utf-8"))
    component_report_path = gateway_decision.get("component_report_path")
    if isinstance(component_report_path, str) and component_report_path.strip():
        component_report = json.loads(Path(component_report_path).read_text(encoding="utf-8"))
        gateway_decision["component_report"] = component_report
    return gateway_decision


def _build_ssh_command(
    *, ssh_host: str, ssh_user: str | None, ssh_password: str | None, remote_path: str
) -> list[str]:
    host_target = f"{ssh_user}@{ssh_host}" if ssh_user else ssh_host
    ssh_args = list(SSH_NONINTERACTIVE_ARGS)
    if ssh_password:
        ssh_args.extend(["-o", "PreferredAuthentications=password"])
    else:
        ssh_args.extend(["-o", "BatchMode=yes"])
    command = ["ssh", *ssh_args, host_target, "cat", remote_path]
    if ssh_password:
        return ["sshpass", "-p", ssh_password, *command]
    return command


def _read_remote_gateway_decision(
    *,
    ssh_host: str,
    ssh_user: str | None,
    ssh_password: str | None,
    remote_path: str,
    timeout_seconds: int,
) -> dict:
    command = _build_ssh_command(
        ssh_host=ssh_host,
        ssh_user=ssh_user,
        ssh_password=ssh_password,
        remote_path=remote_path,
    )
    completed = subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
    )
    gateway_decision = json.loads(completed.stdout)
    component_report_path = gateway_decision.get("component_report_path")
    if isinstance(component_report_path, str) and component_report_path.strip():
        remote_candidates: list[str] = []
        if Path(component_report_path).is_absolute():
            remote_candidates.append(component_report_path)
        else:
            gateway_path = Path(remote_path)
            remote_candidates.extend(
                [
                    component_report_path,
                    str((gateway_path.parent / component_report_path).as_posix()),
                    str((gateway_path.parent.parent / component_report_path).as_posix()),
                ]
            )

        last_error: subprocess.CalledProcessError | None = None
        for candidate in dict.fromkeys(remote_candidates):
            component_command = _build_ssh_command(
                ssh_host=ssh_host,
                ssh_user=ssh_user,
                ssh_password=ssh_password,
                remote_path=candidate,
            )
            try:
                component_completed = subprocess.run(
                    component_command,
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=timeout_seconds,
                )
                gateway_decision["component_report"] = json.loads(component_completed.stdout)
                break
            except subprocess.CalledProcessError as exc:
                last_error = exc
        else:
            assert last_error is not None
            raise last_error
    return gateway_decision


def fetch_zra_gateway_decision(request: ZraGatewayPullRequest) -> dict:
    configured_source = _lookup_robot_pull_source(request.robot_id)

    local_gateway_path = _resolve_target(
        request.local_gateway_path or (configured_source or {}).get("local_gateway_path"),
        ZRA_GATEWAY_LOCAL_PATH_ENV,
    )
    if local_gateway_path:
        return _read_local_gateway_decision(local_gateway_path)

    ssh_host = _resolve_target(
        request.ssh_host or (configured_source or {}).get("ssh_host"),
        ZRA_SSH_HOST_ENV,
    )
    remote_gateway_path = _resolve_target(
        request.remote_gateway_path or (configured_source or {}).get("remote_gateway_path"),
        ZRA_REMOTE_GATEWAY_PATH_ENV,
    )
    ssh_user = _resolve_target(
        request.ssh_user or (configured_source or {}).get("ssh_user"),
        ZRA_SSH_USER_ENV,
    )
    ssh_password = request.ssh_password
    if not (isinstance(ssh_password, str) and ssh_password.strip()):
        configured_password = (configured_source or {}).get("ssh_password")
        ssh_password = configured_password if isinstance(configured_password, str) else None
    ssh_password = ssh_password.strip() if isinstance(ssh_password, str) and ssh_password.strip() else None
    timeout_seconds = request.timeout_seconds or DEFAULT_ZRA_PULL_TIMEOUT_SECONDS

    if ssh_host and remote_gateway_path:
        return _read_remote_gateway_decision(
            ssh_host=ssh_host,
            ssh_user=ssh_user,
            ssh_password=ssh_password,
            remote_path=remote_gateway_path,
            timeout_seconds=timeout_seconds,
        )

    raise ValueError(
        f"No zRA gateway pull source configured for robot '{request.robot_id}'. Configure it on the backend."
    )
