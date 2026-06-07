from __future__ import annotations

from pathlib import Path

import pytest

import backend.services.genesis_world_launcher as genesis_world_launcher
from backend.services.genesis_world_launcher import (
    GenesisWorldLaunchError,
    launch_default_genesis_world,
)


def test_launch_default_genesis_world_returns_log_path_for_live_process(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(genesis_world_launcher, "GENESIS_LAUNCH_LOG_DIR", tmp_path)
    monkeypatch.setattr(genesis_world_launcher.time, "sleep", lambda _seconds: None)

    class _FakeProcess:
        pid = 1234

        def poll(self) -> None:
            return None

    def fake_popen(command, *, cwd, stdout, stderr, start_new_session):
        stdout.write(
            b"Genesis starting\n"
            + genesis_world_launcher.GENESIS_READY_LOG_MARKER.encode("utf-8")
            + b"\n"
        )
        return _FakeProcess()

    monkeypatch.setattr(genesis_world_launcher.subprocess, "Popen", fake_popen)

    response = launch_default_genesis_world(dynamic_container_mode="box")

    assert response.pid == 1234
    assert response.dynamic_container_mode == "box"
    assert response.robot_mode == "so101"
    assert response.log_path is not None
    assert Path(response.log_path).parent == tmp_path
    log_text = Path(response.log_path).read_text()
    assert "Genesis starting" in log_text
    assert genesis_world_launcher.GENESIS_READY_LOG_MARKER in log_text
    assert response.command[:4] == [
        genesis_world_launcher.sys.executable,
        "-u",
        "-m",
        "backend.scripts.genesis_world_open",
    ]


def test_launch_default_genesis_world_passes_crane_robot_mode(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(genesis_world_launcher, "GENESIS_LAUNCH_LOG_DIR", tmp_path)
    monkeypatch.setattr(genesis_world_launcher.time, "sleep", lambda _seconds: None)
    captured_command: list[str] = []

    class _FakeProcess:
        pid = 1234

        def poll(self) -> None:
            return None

    def fake_popen(command, *, cwd, stdout, stderr, start_new_session):
        captured_command.extend(command)
        stdout.write(genesis_world_launcher.GENESIS_READY_LOG_MARKER.encode("utf-8") + b"\n")
        return _FakeProcess()

    monkeypatch.setattr(genesis_world_launcher.subprocess, "Popen", fake_popen)

    response = launch_default_genesis_world(
        dynamic_container_mode="box",
        robot_mode="crane",
    )

    assert response.robot_mode == "crane"
    assert "--robot-mode" in captured_command
    assert captured_command[captured_command.index("--robot-mode") + 1] == "crane"


def test_launch_default_genesis_world_reports_immediate_exit_log_tail(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(genesis_world_launcher, "GENESIS_LAUNCH_LOG_DIR", tmp_path)
    monkeypatch.setattr(genesis_world_launcher.time, "sleep", lambda _seconds: None)

    class _FakeProcess:
        pid = 1234

        def poll(self) -> int:
            return 1

    def fake_popen(command, *, cwd, stdout, stderr, start_new_session):
        stdout.write(b"ModuleNotFoundError: No module named 'genesis'\n")
        return _FakeProcess()

    monkeypatch.setattr(genesis_world_launcher.subprocess, "Popen", fake_popen)

    with pytest.raises(GenesisWorldLaunchError) as exc_info:
        launch_default_genesis_world(dynamic_container_mode="box")

    message = str(exc_info.value)
    assert "Genesis launch exited immediately with code 1" in message
    assert "ModuleNotFoundError: No module named 'genesis'" in message
    assert str(tmp_path) in message


def test_launch_default_genesis_world_reports_readiness_timeout(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(genesis_world_launcher, "GENESIS_LAUNCH_LOG_DIR", tmp_path)
    monkeypatch.setattr(genesis_world_launcher, "GENESIS_LAUNCH_READY_TIMEOUT_SEC", 0)

    class _FakeProcess:
        pid = 1234

        def poll(self) -> None:
            return None

    def fake_popen(command, *, cwd, stdout, stderr, start_new_session):
        stdout.write(b"Genesis starting without ready marker\n")
        return _FakeProcess()

    monkeypatch.setattr(genesis_world_launcher.subprocess, "Popen", fake_popen)

    with pytest.raises(GenesisWorldLaunchError) as exc_info:
        launch_default_genesis_world(dynamic_container_mode="box")

    message = str(exc_info.value)
    assert "Genesis launch did not become ready within 0s" in message
    assert "Genesis starting without ready marker" in message
    assert str(tmp_path) in message
