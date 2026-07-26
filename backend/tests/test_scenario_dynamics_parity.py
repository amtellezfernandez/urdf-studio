from __future__ import annotations

from backend.services.scenario_dynamics_parity import check_dynamics_parity


def _config(**overrides) -> dict:
    base = {
        "physics_timestep_s": 0.002,
        "gravity_z": -9.81,
        "joint_gains": {"joint_1": {"kp": 60.0, "kv": 4.0}},
    }
    base.update(overrides)
    return base


def test_matching_configs_report_no_mismatches() -> None:
    result = check_dynamics_parity(_config(), _config())

    assert result["checked"] is True
    assert result["matches"] is True
    assert result["mismatches"] == []


def test_flags_timestep_mismatch() -> None:
    result = check_dynamics_parity(_config(), _config(physics_timestep_s=0.005))

    assert result["matches"] is False
    assert {m["field"] for m in result["mismatches"]} == {"physics_timestep_s"}


def test_flags_per_joint_gain_mismatch_but_not_shared_joints_within_tolerance() -> None:
    config_a = _config(
        joint_gains={
            "arm_joint": {"kp": 60.0, "kv": 4.0},
            "gripper_joint": {"kp": 70.0, "kv": 5.0},
        }
    )
    config_b = _config(
        joint_gains={
            "arm_joint": {"kp": 60.5, "kv": 4.0},  # within 2% relative tolerance
            "gripper_joint": {"kp": 700.0, "kv": 42.0},  # far outside tolerance
        }
    )

    result = check_dynamics_parity(config_a, config_b)

    assert result["matches"] is False
    mismatched_joints = {m["joint"] for m in result["mismatches"]}
    assert mismatched_joints == {"gripper_joint"}


def test_missing_control_config_values_are_skipped_not_flagged() -> None:
    result = check_dynamics_parity(
        {"physics_timestep_s": None, "gravity_z": None, "joint_gains": {}},
        _config(),
    )

    assert result["checked"] is True
    assert result["matches"] is True
    assert result["mismatches"] == []


def test_two_empty_configs_are_unchecked() -> None:
    empty = {"physics_timestep_s": None, "gravity_z": None, "joint_gains": {}}

    result = check_dynamics_parity(empty, empty)

    assert result["checked"] is False
    assert result["matches"] is True
