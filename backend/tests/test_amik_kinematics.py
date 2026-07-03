from __future__ import annotations

from types import SimpleNamespace

from backend.services.amik_kinematics import _clamp, _get_joint_limits


def _joint_with_limits(lower: float | None, upper: float | None) -> SimpleNamespace:
    return SimpleNamespace(limit=SimpleNamespace(lower=lower, upper=upper))


def test_clamp_bounds_value() -> None:
    assert _clamp(-2.0, lower=-1.0, upper=1.0) == -1.0
    assert _clamp(0.25, lower=-1.0, upper=1.0) == 0.25
    assert _clamp(2.0, lower=-1.0, upper=1.0) == 1.0


def test_get_joint_limits_returns_numeric_limits() -> None:
    joint = _joint_with_limits(lower=-0.5, upper=1.25)

    assert _get_joint_limits(joint) == (-0.5, 1.25)


def test_get_joint_limits_ignores_missing_or_partial_limits() -> None:
    assert _get_joint_limits(SimpleNamespace(limit=None)) == (None, None)
    assert _get_joint_limits(_joint_with_limits(lower=None, upper=1.0)) == (None, None)
    assert _get_joint_limits(_joint_with_limits(lower=-1.0, upper=None)) == (None, None)
