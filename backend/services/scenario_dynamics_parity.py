from __future__ import annotations

import math
from typing import Any

_DEFAULT_RELATIVE_TOLERANCE = 0.02
_DEFAULT_TIMESTEP_ABS_TOLERANCE = 1e-9
_DEFAULT_GRAVITY_ABS_TOLERANCE = 1e-6


def check_dynamics_parity(
    config_a: dict[str, Any],
    config_b: dict[str, Any],
    *,
    relative_tolerance: float = _DEFAULT_RELATIVE_TOLERANCE,
) -> dict[str, Any]:
    """Flag config differences that would confound a cross-sim divergence read.

    Two backends can appear to "diverge" purely because they were tuned
    differently (a different control-loop timestep, different joint-servo
    gains) rather than because their physics disagrees. This does not gate
    the comparison (unlike a pre-flight parity assertion) — the two engines
    are allowed to run with different tuning — it only surfaces the mismatch
    so a divergence reader isn't misattributed to "the physics differs" when
    it may just be "the controllers were tuned differently".
    """
    mismatches: list[dict[str, Any]] = []

    timestep_a = config_a.get("physics_timestep_s")
    timestep_b = config_b.get("physics_timestep_s")
    if timestep_a is not None and timestep_b is not None:
        if not math.isclose(timestep_a, timestep_b, abs_tol=_DEFAULT_TIMESTEP_ABS_TOLERANCE):
            mismatches.append(
                {
                    "field": "physics_timestep_s",
                    "joint": None,
                    "value_a": timestep_a,
                    "value_b": timestep_b,
                }
            )

    gravity_a = config_a.get("gravity_z")
    gravity_b = config_b.get("gravity_z")
    if gravity_a is not None and gravity_b is not None:
        if not math.isclose(gravity_a, gravity_b, abs_tol=_DEFAULT_GRAVITY_ABS_TOLERANCE):
            mismatches.append(
                {
                    "field": "gravity_z",
                    "joint": None,
                    "value_a": gravity_a,
                    "value_b": gravity_b,
                }
            )

    gains_a: dict[str, dict[str, float]] = config_a.get("joint_gains", {})
    gains_b: dict[str, dict[str, float]] = config_b.get("joint_gains", {})
    for joint_name in sorted(set(gains_a) & set(gains_b)):
        for field in ("kp", "kv"):
            value_a = gains_a[joint_name].get(field)
            value_b = gains_b[joint_name].get(field)
            if value_a is None or value_b is None:
                continue
            if not math.isclose(value_a, value_b, rel_tol=relative_tolerance):
                mismatches.append(
                    {
                        "field": field,
                        "joint": joint_name,
                        "value_a": value_a,
                        "value_b": value_b,
                    }
                )

    return {
        "checked": bool(gains_a or gains_b or timestep_a is not None or timestep_b is not None),
        "matches": not mismatches,
        "mismatches": mismatches,
    }
