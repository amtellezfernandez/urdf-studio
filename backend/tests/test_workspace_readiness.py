from __future__ import annotations

from pathlib import Path

import pytest

from backend.services.simulator_adapters.workspace_package import (
    wait_for_workspace_readiness,
)


class _FakeProcess:
    def __init__(self, poll_results: list[int | None]) -> None:
        self._poll_results = poll_results
        self._index = 0

    def poll(self) -> int | None:
        if self._index >= len(self._poll_results):
            return self._poll_results[-1]
        result = self._poll_results[self._index]
        self._index += 1
        return result


def _value_error(message: str) -> ValueError:
    return ValueError(message)


def test_wait_for_workspace_readiness_raises_cancelled_before_ready(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    log_path = tmp_path / "workspace.log"
    log_path.write_text("", encoding="utf-8")
    monkeypatch.setattr("backend.services.simulator_adapters.workspace_package.time.monotonic", lambda: 0.0)
    monkeypatch.setattr("backend.services.simulator_adapters.workspace_package.time.sleep", lambda _seconds: None)

    with pytest.raises(ValueError, match="PyBullet workspace launch was cancelled."):
        wait_for_workspace_readiness(
            _FakeProcess([None]),
            simulator_label="PyBullet",
            log_path=log_path,
            ready_log_marker="READY",
            log_tail_chars=256,
            poll_sec=0.01,
            ready_timeout_sec=1.0,
            post_ready_grace_sec=0.01,
            error=_value_error,
            should_cancel=lambda: True,
        )


def test_wait_for_workspace_readiness_reports_process_exit_log_tail(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    log_path = tmp_path / "workspace.log"
    log_path.write_text("fatal startup detail\n", encoding="utf-8")
    monkeypatch.setattr("backend.services.simulator_adapters.workspace_package.time.monotonic", lambda: 0.0)
    monkeypatch.setattr("backend.services.simulator_adapters.workspace_package.time.sleep", lambda _seconds: None)

    with pytest.raises(ValueError, match="workspace process exited immediately with code 7"):
        wait_for_workspace_readiness(
            _FakeProcess([7]),
            simulator_label="Genesis",
            log_path=log_path,
            ready_log_marker="READY",
            log_tail_chars=256,
            poll_sec=0.01,
            ready_timeout_sec=1.0,
            post_ready_grace_sec=0.01,
            error=_value_error,
        )
