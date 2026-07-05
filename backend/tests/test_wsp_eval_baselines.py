from __future__ import annotations

import pytest

from backend.models.physical_state import PhysicalRolloutTrace
from backend.services import executability_audit
from backend.services.wsp_eval_baselines import wsp_audit_score


def test_wsp_audit_score_treats_expected_audit_errors_as_corrupted(monkeypatch) -> None:
    def fail_audit(_trace: PhysicalRolloutTrace):
        raise ValueError("bad trace")

    monkeypatch.setattr(executability_audit, "audit_physical_rollout_trace", fail_audit)

    score, runtime_ms = wsp_audit_score(PhysicalRolloutTrace(trace_id="bad", frames=[]))

    assert score == 1.0
    assert runtime_ms >= 0.0


def test_wsp_audit_score_propagates_unexpected_audit_errors(monkeypatch) -> None:
    def fail_audit(_trace: PhysicalRolloutTrace):
        raise RuntimeError("unexpected audit failure")

    monkeypatch.setattr(executability_audit, "audit_physical_rollout_trace", fail_audit)

    with pytest.raises(RuntimeError, match="unexpected audit failure"):
        wsp_audit_score(PhysicalRolloutTrace(trace_id="bad", frames=[]))
