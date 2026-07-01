from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from backend.services.simulator_adapters.mujoco import apply_mjcf_workspace_repairs
from backend.services.simulator_adapters.numeric import is_finite_number


def apply_initial_joint_positions(
    mujoco: Any,
    model: Any,
    data: Any,
    joint_positions: Mapping[str, float],
) -> int:
    applied_count = 0
    for joint_name, position in joint_positions.items():
        if not is_finite_number(position):
            continue
        try:
            joint = data.joint(joint_name)
        except KeyError:
            continue
        qpos = getattr(joint, "qpos", None)
        if qpos is None:
            continue
        try:
            qpos[0] = float(position)
        except (IndexError, TypeError, ValueError):
            continue
        applied_count += 1
    if applied_count:
        mujoco.mj_forward(model, data)
    return applied_count


def load_model_with_workspace_repair(mujoco: Any, mjcf_path: Path) -> tuple[Any, Path, tuple[str, ...]]:
    try:
        return mujoco.MjModel.from_xml_path(str(mjcf_path.resolve())), mjcf_path, ()
    except ValueError as exc:
        if not is_known_mjcf_inertial_load_error(exc):
            raise
        repaired_content, warnings = apply_mjcf_workspace_repairs(mjcf_path.read_text(encoding="utf-8"))
        if not warnings:
            raise
        repaired_path = mjcf_path.with_name(f"{mjcf_path.stem}.repaired{mjcf_path.suffix}")
        repaired_path.write_text(repaired_content, encoding="utf-8")
        model = mujoco.MjModel.from_xml_path(str(repaired_path.resolve()))
        return model, repaired_path, warnings


def is_known_mjcf_inertial_load_error(error: ValueError) -> bool:
    message = str(error).lower()
    return "inertia" in message or "inertial" in message
