from backend.services.ik_orchestrator_utils import build_seed_list


def _simulate_blocked_reason(
    gate_relaxed: float,
    gate_strict: float,
    pos_error: float,
    label: str,
) -> str | None:
    gate = gate_relaxed
    if label == "strict":
        gate = gate_strict
    if label == "relaxed":
        gate = gate_strict
    if pos_error > gate:
        return "pos_gate_relaxed" if gate == gate_relaxed else "pos_gate_strict"
    return None


def test_blocked_reason_relaxed_gate() -> None:
    seeds = build_seed_list({"joint_a": 0.1}, None)
    assert seeds[0][0] == "current"
    gate_relaxed = 0.01
    gate_strict = 0.005
    blocked = _simulate_blocked_reason(gate_relaxed, gate_strict, 0.02, "ignore")
    assert blocked == "pos_gate_relaxed"


def test_blocked_reason_strict_gate() -> None:
    gate_relaxed = 0.01
    gate_strict = 0.005
    blocked = _simulate_blocked_reason(gate_relaxed, gate_strict, 0.02, "strict")
    assert blocked == "pos_gate_strict"

