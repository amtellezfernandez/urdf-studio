from __future__ import annotations

import pytest

from backend.scripts import world_bridge_benchmark


def test_run_with_retry_retries_expected_operation_errors() -> None:
    attempts = {"count": 0}

    def _operation() -> None:
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise ValueError("temporary benchmark failure")

    execution = world_bridge_benchmark._run_with_retry(_operation, max_retries=2)

    assert attempts["count"] == 3
    assert execution.success is True
    assert execution.retries_used == 2
    assert execution.error is None


def test_run_with_retry_preserves_unexpected_errors() -> None:
    def _operation() -> None:
        raise TypeError("unexpected benchmark bug")

    with pytest.raises(TypeError, match="unexpected benchmark bug"):
        world_bridge_benchmark._run_with_retry(_operation, max_retries=2)
