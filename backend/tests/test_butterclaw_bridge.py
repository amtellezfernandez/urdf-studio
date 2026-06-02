from __future__ import annotations

import json
import subprocess
from datetime import timedelta
from pathlib import Path

from backend.models.attestation import AttestationStatusUpsertRequest, AttestationTrustState, utc_now
from backend.models.butterclaw import ButterClawChatRequest
from backend.services.attestation import attestation_status_store
from backend.services.butterclaw_bridge import (
    ButterClawBridgeError,
    ButterClawBridgeService,
    _parse_slash_command,
)
from backend.services.butterclaw_bridge_params import BUTTERCLAW_DIRECT_COMMAND_DEFAULTS


def test_butterclaw_bridge_requires_trusted_robot(tmp_path: Path) -> None:
    service = ButterClawBridgeService(
        repo_path=str(tmp_path),
        python_path=str(tmp_path / "python"),
        control_dir=str(tmp_path / "control"),
        runtime_root=str(tmp_path / "runtime-root"),
        robot_remote_ip="100.68.67.21",
        robot_id="my_kiwi",
        robot_port_zmq_cmd=5555,
        robot_port_zmq_observations=5557,
        robot_use_ssh_tunnel=True,
        robot_ssh_host="100.68.67.21",
        robot_ssh_user="pi",
        robot_ssh_port=22,
        robot_ping_first=True,
        robot_ping_count=1,
        robot_runtime_wait_timeout_seconds=45,
        robot_urdf_os_root="",
        robot_urdf_os_python="",
        timeout_seconds=10,
    )
    robot_id = "my_kiwi"
    attestation_status_store.upsert(
        AttestationStatusUpsertRequest(
            robot_id=robot_id,
            verifier="zra",
            trust_state=AttestationTrustState.FAILED,
            expires_at=utc_now() + timedelta(minutes=5),
            reason="ALERT: Connection blocked because attestation policy checks failed.",
        )
    )

    try:
        service.run_chat_command(ButterClawChatRequest(robot_id=robot_id, text="move forward"))
    except ButterClawBridgeError as exc:
        assert "blocked" in str(exc).lower()
    else:
        raise AssertionError("Expected ButterClawBridgeError for untrusted robot.")


def test_butterclaw_bridge_demo_mode_skips_attestation_requirement(
    tmp_path: Path, monkeypatch
) -> None:
    repo_path = tmp_path / "ButterClaw"
    repo_path.mkdir()
    python_path = tmp_path / "python"
    python_path.write_text("", encoding="utf-8")

    service = ButterClawBridgeService(
        repo_path=str(repo_path),
        python_path=str(python_path),
        control_dir=str(tmp_path / "control"),
        runtime_root=str(tmp_path / "runtime-root"),
        robot_remote_ip="100.68.67.21",
        robot_id="my_kiwi",
        robot_port_zmq_cmd=5555,
        robot_port_zmq_observations=5557,
        robot_use_ssh_tunnel=True,
        robot_ssh_host="100.68.67.21",
        robot_ssh_user="pi",
        robot_ssh_port=22,
        robot_ping_first=True,
        robot_ping_count=1,
        robot_runtime_wait_timeout_seconds=45,
        robot_urdf_os_root="",
        robot_urdf_os_python="",
        timeout_seconds=10,
    )
    monkeypatch.setattr(service, "_runtime_demo_enabled", True)

    def fake_run(*_args, **_kwargs):
        return subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout='{"accepted": true, "messages": ["Demo detections loaded into runtime."], "raw_text": "Demo detections loaded into runtime."}',
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    response = service.run_chat_command(
        ButterClawChatRequest(robot_id="my_kiwi", text="/scan")
    )

    assert response.accepted is True
    assert response.messages == ["Demo detections loaded into runtime."]


def test_butterclaw_bridge_parses_runner_output(tmp_path: Path, monkeypatch) -> None:
    repo_path = tmp_path / "ButterClaw"
    repo_path.mkdir()
    python_path = tmp_path / "python"
    python_path.write_text("", encoding="utf-8")
    robot_id = "my_kiwi_ok"
    attestation_status_store.upsert(
        AttestationStatusUpsertRequest(
            robot_id=robot_id,
            verifier="zra",
            trust_state=AttestationTrustState.VERIFIED,
            expires_at=utc_now() + timedelta(minutes=5),
        )
    )

    service = ButterClawBridgeService(
        repo_path=str(repo_path),
        python_path=str(python_path),
        control_dir=str(tmp_path / "control"),
        runtime_root=str(tmp_path / "runtime-root"),
        robot_remote_ip="100.68.67.21",
        robot_id="my_kiwi",
        robot_port_zmq_cmd=5555,
        robot_port_zmq_observations=5557,
        robot_use_ssh_tunnel=True,
        robot_ssh_host="100.68.67.21",
        robot_ssh_user="pi",
        robot_ssh_port=22,
        robot_ping_first=True,
        robot_ping_count=1,
        robot_runtime_wait_timeout_seconds=45,
        robot_urdf_os_root="",
        robot_urdf_os_python="",
        timeout_seconds=10,
    )

    def fake_run(*_args, **_kwargs):
        return subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout='{"accepted": true, "messages": ["Planning move", "Done"], "raw_text": "Planning move\\nDone"}',
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    response = service.run_chat_command(
        ButterClawChatRequest(robot_id=robot_id, text="move forward")
    )

    assert response.accepted is True
    assert response.messages == ["Planning move", "Done"]
    assert response.raw_text == "Planning move\nDone"


def test_butterclaw_bridge_parses_direct_rotate_slash_command(tmp_path: Path, monkeypatch) -> None:
    repo_path = tmp_path / "ButterClaw"
    repo_path.mkdir()
    python_path = tmp_path / "python"
    python_path.write_text("", encoding="utf-8")
    robot_id = "my_kiwi_rotate"
    attestation_status_store.upsert(
        AttestationStatusUpsertRequest(
            robot_id=robot_id,
            verifier="zra",
            trust_state=AttestationTrustState.VERIFIED,
            expires_at=utc_now() + timedelta(minutes=5),
        )
    )

    service = ButterClawBridgeService(
        repo_path=str(repo_path),
        python_path=str(python_path),
        control_dir=str(tmp_path / "control"),
        runtime_root=str(tmp_path / "runtime-root"),
        robot_remote_ip="100.68.67.21",
        robot_id="my_kiwi",
        robot_port_zmq_cmd=5555,
        robot_port_zmq_observations=5557,
        robot_use_ssh_tunnel=True,
        robot_ssh_host="100.68.67.21",
        robot_ssh_user="pi",
        robot_ssh_port=22,
        robot_ping_first=True,
        robot_ping_count=1,
        robot_runtime_wait_timeout_seconds=45,
        robot_urdf_os_root="",
        robot_urdf_os_python="",
        timeout_seconds=10,
    )
    captured_commands: list[list[str]] = []

    def fake_run(command, **_kwargs):
        captured_commands.append(command)
        return subprocess.CompletedProcess(
            args=command,
            returncode=0,
            stdout='{"accepted": true, "messages": ["rotated"], "raw_text": "rotated"}',
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    response = service.run_chat_command(
        ButterClawChatRequest(robot_id=robot_id, text="/rotate 90")
    )

    assert response.accepted is True
    assert response.messages == ["rotated"]
    assert len(captured_commands) == 1
    command = captured_commands[0]
    assert "--mode" in command
    assert command[command.index("--mode") + 1] == "direct"
    assert command[command.index("--runtime-root") + 1].endswith("runtime-root")
    assert command[command.index("--remote-ip") + 1] == "100.68.67.21"
    assert command[command.index("--robot-id") + 1] == "my_kiwi"
    assert command[command.index("--port-zmq-observations") + 1] == "5557"
    assert command[command.index("--ssh-host") + 1] == "100.68.67.21"
    assert command[command.index("--ssh-user") + 1] == "pi"
    command_json = json.loads(command[command.index("--command-json") + 1])
    assert command_json == {
        "type": "rotate",
        "degrees": 90.0,
        "theta_vel": BUTTERCLAW_DIRECT_COMMAND_DEFAULTS.rotate_theta_velocity_degrees_per_second,
    }


def test_parse_slash_move_with_strafe_sets_direct_timeout() -> None:
    parsed = _parse_slash_command("/move 0.15 -0.05 2.5")

    assert parsed is not None
    assert parsed.command_payload == {
        "type": "move",
        "x_vel": 0.15,
        "y_vel": -0.05,
        "duration_s": 2.5,
    }
    assert parsed.timeout_seconds == BUTTERCLAW_DIRECT_COMMAND_DEFAULTS.move_timeout_seconds


def test_parse_slash_command_rejects_invalid_usage() -> None:
    try:
        _parse_slash_command("/rotate")
    except ButterClawBridgeError as exc:
        assert "invalid usage" in str(exc).lower()
    else:
        raise AssertionError("Expected slash command validation failure.")


def test_parse_slash_scan_supports_optional_target() -> None:
    bare_scan = _parse_slash_command("/scan")
    targeted_scan = _parse_slash_command("/scan mug on table")

    assert bare_scan is not None
    assert bare_scan.command_payload == {"type": "scan"}
    assert targeted_scan is not None
    assert targeted_scan.command_payload == {
        "type": "scan",
        "target": "mug on table",
    }


def test_butterclaw_bridge_passes_runtime_demo_flag_for_scan(tmp_path: Path, monkeypatch) -> None:
    repo_path = tmp_path / "ButterClaw"
    repo_path.mkdir()
    python_path = tmp_path / "python"
    python_path.write_text("", encoding="utf-8")
    robot_id = "my_kiwi_scan"
    attestation_status_store.upsert(
        AttestationStatusUpsertRequest(
            robot_id=robot_id,
            verifier="zra",
            trust_state=AttestationTrustState.VERIFIED,
            expires_at=utc_now() + timedelta(minutes=5),
        )
    )

    service = ButterClawBridgeService(
        repo_path=str(repo_path),
        python_path=str(python_path),
        control_dir=str(tmp_path / "control"),
        runtime_root=str(tmp_path / "runtime-root"),
        robot_remote_ip="100.68.67.21",
        robot_id="my_kiwi",
        robot_port_zmq_cmd=5555,
        robot_port_zmq_observations=5557,
        robot_use_ssh_tunnel=True,
        robot_ssh_host="100.68.67.21",
        robot_ssh_user="pi",
        robot_ssh_port=22,
        robot_ping_first=True,
        robot_ping_count=1,
        robot_runtime_wait_timeout_seconds=45,
        robot_urdf_os_root="",
        robot_urdf_os_python="",
        timeout_seconds=10,
    )
    captured_commands: list[list[str]] = []
    monkeypatch.setattr(service, "_runtime_demo_enabled", True)

    def fake_run(command, **_kwargs):
        captured_commands.append(command)
        return subprocess.CompletedProcess(
            args=command,
            returncode=0,
            stdout='{"accepted": true, "messages": ["Demo detections loaded into runtime."], "raw_text": "Demo detections loaded into runtime."}',
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    response = service.run_chat_command(
        ButterClawChatRequest(robot_id=robot_id, text="/scan")
    )

    assert response.accepted is True
    assert response.messages == ["Demo detections loaded into runtime."]
    assert len(captured_commands) == 1
    command = captured_commands[0]
    assert "--runtime-demo-enabled" in command
    command_json = json.loads(command[command.index("--command-json") + 1])
    assert command_json == {"type": "scan"}
