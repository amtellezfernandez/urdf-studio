from __future__ import annotations

import subprocess
import sys
import uuid

from backend.services.simulator_adapters import workspace_launches
from backend.services.simulator_adapters.workspace_launches import (
    attach_workspace_launch_process,
    begin_workspace_launch,
    cancel_workspace_launch,
    terminate_workspace_process,
)


def _start_sleep_process() -> subprocess.Popen:
    return subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(30)"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )


def test_cancel_workspace_launch_stops_attached_process() -> None:
    launch_id = f"test-{uuid.uuid4().hex}"
    process = _start_sleep_process()
    try:
        assert begin_workspace_launch(launch_id, "genesis")
        assert attach_workspace_launch_process(launch_id, process)

        result = cancel_workspace_launch(launch_id, target_id="genesis")

        assert result.cancelled is True
        assert result.process_stopped is True
        assert result.pid == process.pid
        assert process.poll() is not None
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def test_cancel_workspace_launch_ignores_different_target_process() -> None:
    launch_id = f"test-{uuid.uuid4().hex}"
    process = _start_sleep_process()
    try:
        assert begin_workspace_launch(launch_id, "genesis")
        assert attach_workspace_launch_process(launch_id, process)

        wrong_target_result = cancel_workspace_launch(launch_id, target_id="pybullet")

        assert wrong_target_result.cancelled is False
        assert wrong_target_result.process_stopped is False
        assert wrong_target_result.pid is None
        assert process.poll() is None

        correct_target_result = cancel_workspace_launch(launch_id, target_id="genesis")

        assert correct_target_result.cancelled is True
        assert correct_target_result.process_stopped is True
        assert correct_target_result.pid == process.pid
        assert process.poll() is not None
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def test_duplicate_workspace_launch_cannot_replace_attached_process() -> None:
    launch_id = f"test-{uuid.uuid4().hex}"
    process = _start_sleep_process()
    try:
        assert begin_workspace_launch(launch_id, "genesis")
        assert attach_workspace_launch_process(launch_id, process)

        assert begin_workspace_launch(launch_id, "genesis") is False

        result = cancel_workspace_launch(launch_id, target_id="genesis")

        assert result.cancelled is True
        assert result.process_stopped is True
        assert result.pid == process.pid
        assert process.poll() is not None
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def test_pre_cancelled_workspace_launch_cannot_begin() -> None:
    launch_id = f"test-{uuid.uuid4().hex}"

    result = cancel_workspace_launch(launch_id, target_id="genesis")

    assert result.cancelled is True
    assert result.process_stopped is False
    assert begin_workspace_launch(launch_id, "genesis") is False


def test_attach_workspace_launch_process_rejects_pre_cancelled_launch() -> None:
    launch_id = f"test-{uuid.uuid4().hex}"
    process = _start_sleep_process()
    try:
        result = cancel_workspace_launch(launch_id, target_id="genesis")
        assert result.cancelled is True

        attached = attach_workspace_launch_process(launch_id, process)

        assert attached is False
        assert process.poll() is not None
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def test_terminate_workspace_process_reports_false_when_process_survives_kill(
    monkeypatch,
) -> None:
    class _StuckProcess:
        pid = 1234

        def __init__(self) -> None:
            self.wait_calls = 0

        def poll(self):
            return None

        def wait(self, timeout=None):
            self.wait_calls += 1
            raise subprocess.TimeoutExpired(cmd="stuck", timeout=timeout)

    process = _StuckProcess()

    monkeypatch.setattr(workspace_launches, "_terminate_running_process", lambda _process: None)
    monkeypatch.setattr(workspace_launches, "_kill_running_process", lambda _process: None)

    assert terminate_workspace_process(process) is False
    assert process.wait_calls == 2
