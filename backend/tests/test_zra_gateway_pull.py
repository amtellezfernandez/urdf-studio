from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.models.attestation import ZraGatewayPullRequest
from backend.services import zra_gateway_pull


def test_resolve_target_rejects_non_string_env_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        zra_gateway_pull.os,
        "getenv",
        lambda name: object() if name == zra_gateway_pull.ZRA_GATEWAY_LOCAL_PATH_ENV else None,
    )

    assert zra_gateway_pull._resolve_target(None, zra_gateway_pull.ZRA_GATEWAY_LOCAL_PATH_ENV) is None


def test_fetch_zra_gateway_decision_reads_local_component_report(tmp_path: Path) -> None:
    component_report_path = tmp_path / "component-report.json"
    gateway_decision_path = tmp_path / "gateway-decision.json"
    component_report_path.write_text(
        json.dumps({"components": [{"id": "arm-controller", "status": "ok"}]}),
        encoding="utf-8",
    )
    gateway_decision_path.write_text(
        json.dumps(
            {
                "decision": {"status": "accept"},
                "component_report_path": str(component_report_path),
            }
        ),
        encoding="utf-8",
    )

    decision = zra_gateway_pull.fetch_zra_gateway_decision(
        ZraGatewayPullRequest(
            robot_id="pull-bot",
            local_gateway_path=str(gateway_decision_path),
        )
    )

    assert decision["decision"] == {"status": "accept"}
    assert decision["component_report"] == {
        "components": [{"id": "arm-controller", "status": "ok"}]
    }


def test_fetch_zra_gateway_decision_uses_configured_robot_source(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    gateway_decision_path = tmp_path / "gateway-decision.json"
    devices_path = tmp_path / "devices.json"
    gateway_decision_path.write_text(
        json.dumps({"decision": {"status": "accept"}}),
        encoding="utf-8",
    )
    devices_path.write_text(
        json.dumps(
            [
                {
                    "robot_id": "pull-bot",
                    "local_gateway_path": str(gateway_decision_path),
                }
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        zra_gateway_pull,
        "settings",
        SimpleNamespace(zra_orchestrator_devices_path=str(devices_path)),
    )

    decision = zra_gateway_pull.fetch_zra_gateway_decision(
        ZraGatewayPullRequest(robot_id="pull-bot")
    )

    assert decision == {"decision": {"status": "accept"}}


def test_fetch_zra_gateway_decision_ignores_non_string_configured_robot_id(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    gateway_decision_path = tmp_path / "gateway-decision.json"
    devices_path = tmp_path / "devices.json"
    gateway_decision_path.write_text(
        json.dumps({"decision": {"status": "accept"}}),
        encoding="utf-8",
    )
    devices_path.write_text(
        json.dumps(
            [
                {
                    "robot_id": 123,
                    "local_gateway_path": str(gateway_decision_path),
                }
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        zra_gateway_pull,
        "settings",
        SimpleNamespace(zra_orchestrator_devices_path=str(devices_path)),
    )

    with pytest.raises(ValueError, match="No zRA gateway pull source configured"):
        zra_gateway_pull.fetch_zra_gateway_decision(
            ZraGatewayPullRequest(robot_id="123")
        )


def test_configured_source_value_normalizes_blank_string() -> None:
    assert zra_gateway_pull._configured_source_value({"ssh_host": "   "}, "ssh_host") is None


def test_fetch_zra_gateway_decision_rejects_non_object_local_payload(
    tmp_path: Path,
) -> None:
    gateway_decision_path = tmp_path / "gateway-decision.json"
    gateway_decision_path.write_text("[]", encoding="utf-8")

    with pytest.raises(ValueError, match="Expected zRA gateway JSON object"):
        zra_gateway_pull.fetch_zra_gateway_decision(
            ZraGatewayPullRequest(
                robot_id="pull-bot",
                local_gateway_path=str(gateway_decision_path),
            )
        )


def test_fetch_zra_gateway_decision_ignores_invalid_devices_file_when_request_is_explicit(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    gateway_decision_path = tmp_path / "gateway-decision.json"
    devices_path = tmp_path / "devices.json"
    gateway_decision_path.write_text(
        json.dumps({"decision": {"status": "accept"}}),
        encoding="utf-8",
    )
    devices_path.write_bytes(b"\xff\xfe\x00")
    monkeypatch.setattr(
        zra_gateway_pull,
        "settings",
        SimpleNamespace(zra_orchestrator_devices_path=str(devices_path)),
    )

    decision = zra_gateway_pull.fetch_zra_gateway_decision(
        ZraGatewayPullRequest(
            robot_id="pull-bot",
            local_gateway_path=str(gateway_decision_path),
        )
    )

    assert decision == {"decision": {"status": "accept"}}
