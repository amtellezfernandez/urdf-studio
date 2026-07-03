from backend.services.ik_orchestrator_utils import (
    build_orientation_attempts,
    build_seed_list,
    build_strategies,
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
