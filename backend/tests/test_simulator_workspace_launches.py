from __future__ import annotations

import subprocess
import sys
import uuid

from backend.services.simulator_adapters.workspace_launches import (
    attach_workspace_launch_process,
    begin_workspace_launch,
    cancel_workspace_launch,
)


def test_cancel_workspace_launch_stops_attached_process() -> None:
    launch_id = f"test-{uuid.uuid4().hex}"
    process = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(30)"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )
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


def test_pre_cancelled_workspace_launch_cannot_begin() -> None:
    launch_id = f"test-{uuid.uuid4().hex}"

    result = cancel_workspace_launch(launch_id, target_id="genesis")

    assert result.cancelled is True
    assert result.process_stopped is False
    assert begin_workspace_launch(launch_id, "genesis") is False
