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
