from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from backend.services.so100_sysid.params import (
    I_LOVE_URDF_KINEMATIC_STRIP_SCRIPT,
    SO100_CANONICAL_URDF_PATH,
    SO100_EXPECTED_JOINT_COUNT,
    SO100_JOINT_NAMES,
    SO100_MJX_DISABLE_LIMITS_FOR_FREE_SPACE_GRADIENTS,
    SO100_MJX_MODEL_DOF_ARMATURE,
    SO100_MJX_MODEL_DOF_DAMPING,
    SO100_MJX_TIMESTEP_SECONDS,
)


@dataclass(frozen=True)
class So100MujocoModel:
    model: object
    stripped_urdf_xml: str
    joint_names: tuple[str, ...]
    qpos_reference: np.ndarray


def strip_so100_urdf_for_kinematics(
    urdf_path: Path = SO100_CANONICAL_URDF_PATH,
    *,
    strip_script_path: Path = I_LOVE_URDF_KINEMATIC_STRIP_SCRIPT,
) -> str:
    """Strip visual/collision meshes through the i-love-urdf node helper."""

    if not urdf_path.exists():
        raise FileNotFoundError(f"SO100 URDF does not exist: {urdf_path}")
    if not strip_script_path.exists():
        raise FileNotFoundError(f"i-love-urdf strip bridge does not exist: {strip_script_path}")

    completed = subprocess.run(
        ["node", str(strip_script_path), str(urdf_path)],
        check=True,
        capture_output=True,
        encoding="utf-8",
    )
    stripped = completed.stdout.strip()
    if not stripped:
        raise ValueError(f"i-love-urdf returned an empty kinematic URDF for {urdf_path}.")
    return stripped


def _resolve_joint_names(model: object) -> tuple[str, ...]:
    import mujoco

    return tuple(
        mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_JOINT, joint_index) or ""
        for joint_index in range(model.njnt)
    )


def _validate_so100_model(model: object) -> tuple[str, ...]:
    joint_names = _resolve_joint_names(model)
    if joint_names != SO100_JOINT_NAMES:
        raise ValueError(f"Unexpected SO100 joint order: {joint_names}. Expected {SO100_JOINT_NAMES}.")
    if model.nq != SO100_EXPECTED_JOINT_COUNT or model.nv != SO100_EXPECTED_JOINT_COUNT:
        raise ValueError(f"Unexpected SO100 degrees of freedom: nq={model.nq}, nv={model.nv}.")
    return joint_names


def _build_qpos_reference(model: object) -> np.ndarray:
    ranges = np.asarray(model.jnt_range, dtype=np.float32)
    if ranges.shape != (SO100_EXPECTED_JOINT_COUNT, 2):
        return np.zeros(SO100_EXPECTED_JOINT_COUNT, dtype=np.float32)
    return ranges.mean(axis=1).astype(np.float32)


def load_so100_mujoco_model(
    urdf_path: Path = SO100_CANONICAL_URDF_PATH,
    *,
    timestep_seconds: float = SO100_MJX_TIMESTEP_SECONDS,
    dof_damping: float = SO100_MJX_MODEL_DOF_DAMPING,
    dof_armature: float = SO100_MJX_MODEL_DOF_ARMATURE,
    disable_joint_limits: bool = SO100_MJX_DISABLE_LIMITS_FOR_FREE_SPACE_GRADIENTS,
) -> So100MujocoModel:
    """Load SO100 through i-love-urdf mesh stripping and MuJoCo's URDF importer."""

    import mujoco

    stripped_urdf_xml = strip_so100_urdf_for_kinematics(urdf_path)
    model = mujoco.MjModel.from_xml_string(stripped_urdf_xml)
    joint_names = _validate_so100_model(model)

    model.opt.timestep = timestep_seconds
    model.dof_damping[:] = dof_damping
    model.dof_armature[:] = dof_armature
    if disable_joint_limits:
        model.jnt_limited[:] = False

    return So100MujocoModel(
        model=model,
        stripped_urdf_xml=stripped_urdf_xml,
        joint_names=joint_names,
        qpos_reference=_build_qpos_reference(model),
    )
