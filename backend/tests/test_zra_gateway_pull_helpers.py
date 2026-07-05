from __future__ import annotations

from backend.services import zra_gateway_pull


def test_build_ssh_command_without_password_uses_batch_mode() -> None:
    assert zra_gateway_pull._build_ssh_command(
        ssh_host="robot.local",
        ssh_user="operator",
        ssh_password=None,
        remote_path="/tmp/gateway.json",
    ) == [
        "ssh",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "BatchMode=yes",
        "operator@robot.local",
        "cat",
        "/tmp/gateway.json",
    ]


def test_build_ssh_command_with_password_uses_sshpass() -> None:
    assert zra_gateway_pull._build_ssh_command(
        ssh_host="robot.local",
        ssh_user=None,
        ssh_password="secret",
        remote_path="/tmp/gateway.json",
    ) == [
        "sshpass",
        "-p",
        "secret",
        "ssh",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "PreferredAuthentications=password",
        "robot.local",
        "cat",
        "/tmp/gateway.json",
    ]


def test_remote_component_report_candidates_expand_relative_paths() -> None:
    assert zra_gateway_pull._remote_component_report_candidates(
        remote_path="/var/lib/zra/gateway/gateway.json",
        component_report_path="reports/components.json",
    ) == [
        "reports/components.json",
        "/var/lib/zra/gateway/reports/components.json",
        "/var/lib/zra/reports/components.json",
    ]


def test_remote_component_report_candidates_preserve_absolute_paths() -> None:
    assert zra_gateway_pull._remote_component_report_candidates(
        remote_path="/var/lib/zra/gateway/gateway.json",
        component_report_path="/opt/zra/components.json",
    ) == ["/opt/zra/components.json"]
