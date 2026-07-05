from __future__ import annotations

from collections.abc import Mapping

import pytest

from backend.services import ik_config


IK_ENV_KEYS = (
    "URDF_IK_AMIK_POS_WEIGHT",
    "URDF_IK_AMIK_SOLVE_ITER",
    "URDF_IK_TIMEOUT_REQUEST_MS",
    "URDF_IK_DRAG_MAX_SPEED",
)


def _install_config(
    monkeypatch: pytest.MonkeyPatch,
    config: Mapping[str, object],
) -> None:
    monkeypatch.setattr(ik_config, "read_app_config", lambda: config)
    for env_key in IK_ENV_KEYS:
        monkeypatch.delenv(env_key, raising=False)


def test_get_ik_config_applies_app_config_solver_overrides(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_config(
        monkeypatch,
        {
            "ik": {
                "timeouts": {"request_ms": 900},
                "solverTuning": {
                    "amik": {
                        "positionWeight": 42.0,
                        "solveIterations": 9,
                    }
                },
            }
        },
    )

    config = ik_config.get_ik_config()

    assert config.timeouts.request_ms == 900
    assert config.solver_tuning["amik"].position_weight == 42.0
    assert config.solver_tuning["amik"].solve_iterations == 9


def test_get_ik_config_coerces_string_app_config_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_config(
        monkeypatch,
        {
            "ik": {
                "timeouts": {"requestMs": "900"},
                "drag": {"maxDragSpeed": "1.25", "ikThrottleMs": "75"},
                "orbit": {"radius": "0.45"},
                "tolerances": {"positionTolerance": "0.01"},
                "solverTuning": {
                    "amik": {
                        "positionWeight": "42.0",
                        "solveIterations": "9",
                    }
                },
            }
        },
    )

    config = ik_config.get_ik_config()

    assert config.timeouts.request_ms == 900
    assert config.drag.max_drag_speed == 1.25
    assert config.drag.ik_throttle_ms == 75
    assert config.orbit.radius == 0.45
    assert config.tolerances.position_tolerance == 0.01
    assert config.solver_tuning["amik"].position_weight == 42.0
    assert config.solver_tuning["amik"].solve_iterations == 9


def test_get_ik_config_ignores_invalid_app_config_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_config(
        monkeypatch,
        {
            "ik": {
                "timeouts": {"requestMs": True},
                "drag": {"maxDragSpeed": "nan", "ikThrottleMs": []},
                "orbit": {"radius": ""},
                "tolerances": {"positionTolerance": "bad"},
                "solverTuning": {
                    "amik": {
                        "positionWeight": False,
                        "solveIterations": "bad",
                    }
                },
            }
        },
    )

    config = ik_config.get_ik_config()

    assert config.timeouts.request_ms == 1200
    assert config.drag.max_drag_speed == 0.8
    assert config.drag.ik_throttle_ms == 60
    assert config.orbit.radius == 0.3
    assert config.tolerances.position_tolerance == 0.002
    assert config.solver_tuning["amik"].position_weight == 100.0
    assert config.solver_tuning["amik"].solve_iterations == 28


def test_get_ik_config_env_overrides_app_config_solver_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_config(
        monkeypatch,
        {
            "ik": {
                "solverTuning": {
                    "amik": {
                        "positionWeight": 42.0,
                        "solveIterations": 9,
                    }
                }
            }
        },
    )
    monkeypatch.setenv("URDF_IK_AMIK_POS_WEIGHT", "55.5")
    monkeypatch.setenv("URDF_IK_AMIK_SOLVE_ITER", "12")

    config = ik_config.get_ik_config()

    assert config.solver_tuning["amik"].position_weight == 55.5
    assert config.solver_tuning["amik"].solve_iterations == 12


def test_get_ik_config_ignores_invalid_env_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_config(
        monkeypatch,
        {
            "ik": {
                "solverTuning": {
                    "amik": {
                        "solveIterations": 9,
                    }
                }
            }
        },
    )
    monkeypatch.setenv("URDF_IK_AMIK_SOLVE_ITER", "not-an-int")

    config = ik_config.get_ik_config()

    assert config.solver_tuning["amik"].solve_iterations == 9


@pytest.mark.parametrize("raw_value", ["nan", "inf", "-inf"])
def test_get_ik_config_ignores_non_finite_float_env_override(
    monkeypatch: pytest.MonkeyPatch,
    raw_value: str,
) -> None:
    _install_config(monkeypatch, {})
    monkeypatch.setenv("URDF_IK_DRAG_MAX_SPEED", raw_value)

    config = ik_config.get_ik_config()

    assert config.drag.max_drag_speed == 0.8
