from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.services import zra_orchestrator


def test_load_zra_orchestrator_devices_coerces_string_timeout(
    tmp_path: Path,
) -> None:
    devices_path = tmp_path / "devices.json"
    devices_path.write_text(
        json.dumps(
            [
                {
                    "robot_id": "pull-bot",
                    "timeout_seconds": "25",
                }
            ]
        ),
        encoding="utf-8",
    )

    devices = zra_orchestrator.load_zra_orchestrator_devices(str(devices_path))

    assert len(devices) == 1
    assert devices[0].timeout_seconds == 25


def test_load_zra_orchestrator_devices_normalizes_optional_string_fields(
    tmp_path: Path,
) -> None:
    devices_path = tmp_path / "devices.json"
    devices_path.write_text(
        json.dumps(
            [
                {
                    "robot_id": "pull-bot",
                    "ssh_host": " ssh.example.com ",
                    "ssh_user": " operator ",
                    "ssh_password": " secret ",
                    "remote_gateway_path": " /remote/gateway.json ",
                    "local_gateway_path": " /tmp/gateway.json ",
                }
            ]
        ),
        encoding="utf-8",
    )

    devices = zra_orchestrator.load_zra_orchestrator_devices(str(devices_path))

    assert len(devices) == 1
    assert devices[0].ssh_host == "ssh.example.com"
    assert devices[0].ssh_user == "operator"
    assert devices[0].ssh_password == "secret"
    assert devices[0].remote_gateway_path == "/remote/gateway.json"
    assert devices[0].local_gateway_path == "/tmp/gateway.json"


def test_load_zra_orchestrator_devices_ignores_invalid_optional_string_fields(
    tmp_path: Path,
) -> None:
    devices_path = tmp_path / "devices.json"
    devices_path.write_text(
        json.dumps(
            [
                {
                    "robot_id": "pull-bot",
                    "ssh_host": 123,
                    "ssh_user": False,
                    "ssh_password": [],
                    "remote_gateway_path": {},
                    "local_gateway_path": "",
                }
            ]
        ),
        encoding="utf-8",
    )

    devices = zra_orchestrator.load_zra_orchestrator_devices(str(devices_path))

    assert len(devices) == 1
    assert devices[0].ssh_host is None
    assert devices[0].ssh_user is None
    assert devices[0].ssh_password is None
    assert devices[0].remote_gateway_path is None
    assert devices[0].local_gateway_path is None


@pytest.mark.parametrize("raw_timeout", [True, "bad", "", 0, -1, 121])
def test_load_zra_orchestrator_devices_defaults_invalid_timeout(
    tmp_path: Path,
    raw_timeout: object,
) -> None:
    devices_path = tmp_path / "devices.json"
    devices_path.write_text(
        json.dumps(
            [
                {
                    "robot_id": "pull-bot",
                    "timeout_seconds": raw_timeout,
                }
            ]
        ),
        encoding="utf-8",
    )

    devices = zra_orchestrator.load_zra_orchestrator_devices(str(devices_path))

    assert len(devices) == 1
    assert devices[0].timeout_seconds == 10
