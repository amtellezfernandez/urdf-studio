from backend.world_bridge.conformance import (
    run_world_bridge_conformance,
    run_world_bridge_live_conformance,
)
from backend.world_bridge.conformance_params import (
    CONFORMANCE_WORLDD_HOST,
    CONFORMANCE_WORLDD_PORT,
    CONFORMANCE_WORLDD_TIMEOUT_MS,
)
from backend.world_bridge.worldd_client import WorlddUnavailableError


def test_world_bridge_conformance_passes() -> None:
    result = run_world_bridge_conformance()
    assert result.passed is True
    assert len(result.failures) == 0


def test_world_bridge_live_conformance_reports_unavailable(monkeypatch) -> None:
    class UnavailableWorlddClient:
        def __init__(self, host: str, port: int, timeout_ms: int) -> None:
            _ = (host, port, timeout_ms)

        def request_json(self, method, path, payload=None):
            _ = (method, path, payload)
            raise WorlddUnavailableError("offline")

    monkeypatch.setattr(
        "backend.world_bridge.conformance.WorlddClient",
        UnavailableWorlddClient,
    )
    result = run_world_bridge_live_conformance(
        worldd_host=CONFORMANCE_WORLDD_HOST,
        worldd_port=CONFORMANCE_WORLDD_PORT,
        worldd_timeout_ms=CONFORMANCE_WORLDD_TIMEOUT_MS,
    )
    assert result.passed is False
    assert any("live status check failed" in failure for failure in result.failures)
