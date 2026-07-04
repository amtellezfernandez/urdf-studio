from backend.services.ik_orchestrator_utils import (
    build_orientation_attempts,
    build_seed_list,
    build_strategies,
    generate_jitter_seeds,
    position_gate_for_orientation_label,
)


def test_orientation_attempts() -> None:
    assert build_orientation_attempts("ignore", True) == [(True, 0.0, "ignore")]
    assert build_orientation_attempts("required", True) == [(False, 1.0, "strict")]
    assert build_orientation_attempts("optional", True) == [
        (False, 1.0, "strict"),
        (False, 0.2, "relaxed"),
        (True, 0.0, "ignore"),
    ]
    assert build_orientation_attempts("position_first", True) == [
        (True, 0.0, "ignore"),
        (False, 0.2, "relaxed"),
        (False, 1.0, "strict"),
    ]
    assert build_orientation_attempts("prefer", True) == [
        (False, 1.0, "strict"),
        (False, 0.2, "relaxed"),
        (True, 0.0, "ignore"),
    ]
    assert build_orientation_attempts("prefer", False) == [(True, 0.0, "no_orientation")]


def test_strategy_ordering() -> None:
    chain = ["placo", "amik"]
    strategies = build_strategies(chain, "optional", True)
    assert strategies == [
        ("placo", False, 1.0, "strict"),
        ("amik", False, 1.0, "strict"),
        ("placo", False, 0.2, "relaxed"),
        ("amik", False, 0.2, "relaxed"),
        ("placo", True, 0.0, "ignore"),
        ("amik", True, 0.0, "ignore"),
    ]


def test_strategy_ordering_accepts_single_pass_iterables() -> None:
    chain = (solver_id for solver_id in ["placo", "amik"])
    strategies = build_strategies(chain, "optional", True)

    assert strategies == [
        ("placo", False, 1.0, "strict"),
        ("amik", False, 1.0, "strict"),
        ("placo", False, 0.2, "relaxed"),
        ("amik", False, 0.2, "relaxed"),
        ("placo", True, 0.0, "ignore"),
        ("amik", True, 0.0, "ignore"),
    ]


def test_seed_ordering() -> None:
    base = {"joint_a": 0.1, "joint_b": -0.2}
    cached = {"joint_a": 0.2}
    seeds = build_seed_list(base, cached)
    sources = [source for source, _ in seeds]
    assert sources[0] == "current"
    assert sources[1] == "last_success"
    assert sources[2].startswith("jitter_")
    assert sources[3].startswith("jitter_")


def test_seed_fallback() -> None:
    seeds = build_seed_list({}, None)
    sources = [source for source, _ in seeds]
    assert sources == ["zeros"]


def test_jitter_seed_values_are_deterministic() -> None:
    seed = {"joint_b": 0.0, "joint_a": 1.0, "joint_c": -1.0, "joint_d": 2.0}

    assert generate_jitter_seeds(seed, count=2, magnitude=0.1) == [
        {"joint_b": -0.1, "joint_a": 1.1, "joint_c": -0.9, "joint_d": 2.0},
        {"joint_b": 0.1, "joint_a": 0.9, "joint_c": -1.1, "joint_d": 2.0},
    ]


def test_position_gate_follows_orientation_strategy() -> None:
    assert position_gate_for_orientation_label("ignore", 0.01, 0.005) == 0.01
    assert position_gate_for_orientation_label("no_orientation", 0.01, 0.005) == 0.01
    assert position_gate_for_orientation_label("relaxed", 0.01, 0.005) == 0.005
    assert position_gate_for_orientation_label("strict", 0.01, 0.005) == 0.005
