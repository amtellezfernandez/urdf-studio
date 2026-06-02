from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass

import numpy as np

from backend.services.so100_sysid.model import So100MujocoModel, load_so100_mujoco_model
from backend.services.so100_sysid.params import (
    SO100_GEOMETRY_REPAIR_ACTION_AMPLITUDE_RAD,
    SO100_GEOMETRY_REPAIR_LEARNING_RATE,
    SO100_GEOMETRY_REPAIR_MAX_FINAL_LOSS,
    SO100_GEOMETRY_REPAIR_MAX_ORIGIN_DELTA_M,
    SO100_GEOMETRY_REPAIR_MAX_ORIGIN_ERROR_M,
    SO100_GEOMETRY_REPAIR_MIN_LOSS_REDUCTION_RATIO,
    SO100_GEOMETRY_REPAIR_OPTIMIZER_STEPS,
    SO100_GEOMETRY_REPAIR_PHASE_OFFSET_RAD,
    SO100_GEOMETRY_REPAIR_REGULARIZATION_WEIGHT,
    SO100_GEOMETRY_REPAIR_STEP_COUNT,
    SO100_GEOMETRY_REPAIR_TARGET_ORIGIN_OFFSETS_M,
    SO100_JOINT_NAMES,
)


Float3 = tuple[float, float, float]


@dataclass(frozen=True)
class So100KinematicJoint:
    name: str
    joint_type: str
    parent_link: str
    child_link: str
    origin_xyz: Float3
    origin_rpy: Float3
    axis_xyz: Float3
    qpos_index: int | None


@dataclass(frozen=True)
class So100KinematicModel:
    joints: tuple[So100KinematicJoint, ...]
    link_names: tuple[str, ...]
    tracked_link_names: tuple[str, ...]
    qpos_reference: np.ndarray


@dataclass(frozen=True)
class So100GeometryRepairResult:
    initial_loss: float
    final_loss: float
    loss_reduction_ratio: float
    max_origin_error_m: float
    optimizer_steps: int
    rollout_steps: int
    recovered_offsets_m: dict[str, Float3]
    target_offsets_m: dict[str, Float3]
    tracked_link_names: tuple[str, ...]


def _parse_float3(raw_value: str | None, fallback: Float3) -> Float3:
    if not raw_value:
        return fallback
    parts = raw_value.split()
    if len(parts) != len(fallback):
        return fallback
    try:
        parsed = tuple(float(part) for part in parts)
    except ValueError:
        return fallback
    return (parsed[0], parsed[1], parsed[2])


def _joint_parent(joint: ET.Element) -> str:
    parent = joint.find("parent")
    if parent is None or not parent.get("link"):
        raise ValueError(f"Joint '{joint.get('name')}' is missing a parent link.")
    return parent.get("link", "")


def _joint_child(joint: ET.Element) -> str:
    child = joint.find("child")
    if child is None or not child.get("link"):
        raise ValueError(f"Joint '{joint.get('name')}' is missing a child link.")
    return child.get("link", "")


def _joint_origin(joint: ET.Element) -> tuple[Float3, Float3]:
    origin = joint.find("origin")
    if origin is None:
        return (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)
    return (
        _parse_float3(origin.get("xyz"), (0.0, 0.0, 0.0)),
        _parse_float3(origin.get("rpy"), (0.0, 0.0, 0.0)),
    )


def _joint_axis(joint: ET.Element) -> Float3:
    axis = joint.find("axis")
    if axis is None:
        return (1.0, 0.0, 0.0)
    return _parse_float3(axis.get("xyz"), (1.0, 0.0, 0.0))


def _root_link_name(root: ET.Element, joints: list[ET.Element]) -> str:
    link_names = {link.get("name", "") for link in root.findall("./link") if link.get("name")}
    child_names = {_joint_child(joint) for joint in joints}
    root_links = sorted(link_name for link_name in link_names if link_name not in child_names)
    if len(root_links) != 1:
        raise ValueError(f"Expected one SO100 root link, found {root_links}.")
    return root_links[0]


def parse_so100_kinematic_model(model: So100MujocoModel | None = None) -> So100KinematicModel:
    so100_model = model or load_so100_mujoco_model()
    root = ET.fromstring(so100_model.stripped_urdf_xml)
    xml_joints = list(root.findall("./joint"))
    root_link = _root_link_name(root, xml_joints)
    children_by_parent: dict[str, list[ET.Element]] = {}
    for joint in xml_joints:
        children_by_parent.setdefault(_joint_parent(joint), []).append(joint)

    qpos_index_by_joint = {joint_name: index for index, joint_name in enumerate(SO100_JOINT_NAMES)}
    link_names: list[str] = [root_link]
    parsed_joints: list[So100KinematicJoint] = []

    def visit_link(link_name: str) -> None:
        for joint in children_by_parent.get(link_name, []):
            joint_name = joint.get("name", "")
            joint_type = joint.get("type", "fixed")
            origin_xyz, origin_rpy = _joint_origin(joint)
            child_link = _joint_child(joint)
            link_names.append(child_link)
            parsed_joints.append(
                So100KinematicJoint(
                    name=joint_name,
                    joint_type=joint_type,
                    parent_link=link_name,
                    child_link=child_link,
                    origin_xyz=origin_xyz,
                    origin_rpy=origin_rpy,
                    axis_xyz=_joint_axis(joint),
                    qpos_index=qpos_index_by_joint.get(joint_name),
                )
            )
            visit_link(child_link)

    visit_link(root_link)
    tracked_link_names = tuple(joint.child_link for joint in parsed_joints)
    return So100KinematicModel(
        joints=tuple(parsed_joints),
        link_names=tuple(link_names),
        tracked_link_names=tracked_link_names,
        qpos_reference=so100_model.qpos_reference,
    )


def _rpy_to_matrix(rpy):
    import jax.numpy as jnp

    roll, pitch, yaw = rpy
    sin_roll, cos_roll = jnp.sin(roll), jnp.cos(roll)
    sin_pitch, cos_pitch = jnp.sin(pitch), jnp.cos(pitch)
    sin_yaw, cos_yaw = jnp.sin(yaw), jnp.cos(yaw)
    rotation_x = jnp.asarray(
        [
            [1.0, 0.0, 0.0],
            [0.0, cos_roll, -sin_roll],
            [0.0, sin_roll, cos_roll],
        ],
        dtype=jnp.float32,
    )
    rotation_y = jnp.asarray(
        [
            [cos_pitch, 0.0, sin_pitch],
            [0.0, 1.0, 0.0],
            [-sin_pitch, 0.0, cos_pitch],
        ],
        dtype=jnp.float32,
    )
    rotation_z = jnp.asarray(
        [
            [cos_yaw, -sin_yaw, 0.0],
            [sin_yaw, cos_yaw, 0.0],
            [0.0, 0.0, 1.0],
        ],
        dtype=jnp.float32,
    )
    return rotation_z @ rotation_y @ rotation_x


def _axis_angle_to_matrix(axis, angle):
    import jax.numpy as jnp

    normalized_axis = axis / jnp.linalg.norm(axis)
    axis_x, axis_y, axis_z = normalized_axis
    sin_angle = jnp.sin(angle)
    cos_angle = jnp.cos(angle)
    one_minus_cos = 1.0 - cos_angle
    return jnp.asarray(
        [
            [
                cos_angle + axis_x * axis_x * one_minus_cos,
                axis_x * axis_y * one_minus_cos - axis_z * sin_angle,
                axis_x * axis_z * one_minus_cos + axis_y * sin_angle,
            ],
            [
                axis_y * axis_x * one_minus_cos + axis_z * sin_angle,
                cos_angle + axis_y * axis_y * one_minus_cos,
                axis_y * axis_z * one_minus_cos - axis_x * sin_angle,
            ],
            [
                axis_z * axis_x * one_minus_cos - axis_y * sin_angle,
                axis_z * axis_y * one_minus_cos + axis_x * sin_angle,
                cos_angle + axis_z * axis_z * one_minus_cos,
            ],
        ],
        dtype=jnp.float32,
    )


def _transform(rotation, translation):
    import jax.numpy as jnp

    upper = jnp.concatenate([rotation, translation.reshape(3, 1)], axis=1)
    lower = jnp.asarray([[0.0, 0.0, 0.0, 1.0]], dtype=jnp.float32)
    return jnp.concatenate([upper, lower], axis=0)


def _build_geometry_arrays(model: So100KinematicModel):
    link_index_by_name = {link_name: index for index, link_name in enumerate(model.link_names)}
    return {
        "origin_xyz": np.asarray([joint.origin_xyz for joint in model.joints], dtype=np.float32),
        "origin_rpy": np.asarray([joint.origin_rpy for joint in model.joints], dtype=np.float32),
        "axis_xyz": np.asarray([joint.axis_xyz for joint in model.joints], dtype=np.float32),
        "parent_indices": tuple(link_index_by_name[joint.parent_link] for joint in model.joints),
        "child_indices": tuple(link_index_by_name[joint.child_link] for joint in model.joints),
        "qpos_indices": tuple(joint.qpos_index for joint in model.joints),
        "tracked_indices": np.asarray(
            [link_index_by_name[link_name] for link_name in model.tracked_link_names],
            dtype=np.int32,
        ),
        "link_count": len(model.link_names),
    }


def forward_tracked_link_positions(
    model: So100KinematicModel,
    qpos_batch: np.ndarray,
    origin_delta_m: np.ndarray,
):
    import jax
    import jax.numpy as jnp

    arrays = _build_geometry_arrays(model)
    origin_xyz = jnp.asarray(arrays["origin_xyz"])
    origin_rpy = jnp.asarray(arrays["origin_rpy"])
    axis_xyz = jnp.asarray(arrays["axis_xyz"])
    tracked_indices = jnp.asarray(arrays["tracked_indices"])
    identity_transform = jnp.eye(4, dtype=jnp.float32)

    def single_sample(qpos):
        transforms = jnp.tile(identity_transform[None, :, :], (arrays["link_count"], 1, 1))
        for joint_index, qpos_index in enumerate(arrays["qpos_indices"]):
            parent_transform = transforms[arrays["parent_indices"][joint_index]]
            origin_rotation = _rpy_to_matrix(origin_rpy[joint_index])
            origin_transform = _transform(
                origin_rotation,
                origin_xyz[joint_index] + origin_delta_m[joint_index],
            )
            joint_transform = origin_transform
            if qpos_index is not None:
                joint_transform = joint_transform @ _transform(
                    _axis_angle_to_matrix(axis_xyz[joint_index], qpos[qpos_index]),
                    jnp.zeros(3, dtype=jnp.float32),
                )
            child_transform = parent_transform @ joint_transform
            transforms = transforms.at[arrays["child_indices"][joint_index]].set(child_transform)
        return transforms[tracked_indices, :3, 3]

    return jax.vmap(single_sample)(jnp.asarray(qpos_batch, dtype=jnp.float32))


def _build_geometry_repair_qpos_batch(model: So100KinematicModel, step_count: int) -> np.ndarray:
    time = np.linspace(0.0, 1.0, step_count, dtype=np.float32)
    qpos_reference = np.asarray(model.qpos_reference, dtype=np.float32)
    joint_offsets = [
        SO100_GEOMETRY_REPAIR_ACTION_AMPLITUDE_RAD
        * np.sin(2.0 * np.pi * (joint_index + 1) * time + SO100_GEOMETRY_REPAIR_PHASE_OFFSET_RAD * joint_index)
        for joint_index in range(len(SO100_JOINT_NAMES))
    ]
    return qpos_reference + np.stack(joint_offsets, axis=1)


def _sparse_origin_delta(model: So100KinematicModel, offsets_by_joint: dict[str, Float3]) -> np.ndarray:
    delta = np.zeros((len(model.joints), 3), dtype=np.float32)
    for joint_index, joint in enumerate(model.joints):
        offset = offsets_by_joint.get(joint.name)
        if offset is not None:
            delta[joint_index] = np.asarray(offset, dtype=np.float32)
    return delta


def _loss_reduction(initial_loss: float, final_loss: float) -> float:
    if initial_loss <= 0:
        return 0.0
    return (initial_loss - final_loss) / initial_loss


def run_so100_geometry_repair_benchmark(
    *,
    model: So100KinematicModel | None = None,
    optimizer_steps: int = SO100_GEOMETRY_REPAIR_OPTIMIZER_STEPS,
    rollout_steps: int = SO100_GEOMETRY_REPAIR_STEP_COUNT,
) -> So100GeometryRepairResult:
    import jax
    import jax.numpy as jnp
    import optax

    kinematic_model = model or parse_so100_kinematic_model()
    qpos_batch = _build_geometry_repair_qpos_batch(kinematic_model, rollout_steps)
    target_delta = _sparse_origin_delta(kinematic_model, SO100_GEOMETRY_REPAIR_TARGET_ORIGIN_OFFSETS_M)
    target_positions = forward_tracked_link_positions(kinematic_model, qpos_batch, target_delta)
    target_mask = jnp.asarray((np.abs(target_delta).sum(axis=1) > 0).astype(np.float32))[:, None]

    def bounded_delta(raw_delta):
        return SO100_GEOMETRY_REPAIR_MAX_ORIGIN_DELTA_M * jnp.tanh(raw_delta) * target_mask

    def loss(raw_delta):
        candidate_delta = bounded_delta(raw_delta)
        predicted_positions = forward_tracked_link_positions(kinematic_model, qpos_batch, candidate_delta)
        residual = jnp.mean(jnp.square(predicted_positions - target_positions))
        regularization = SO100_GEOMETRY_REPAIR_REGULARIZATION_WEIGHT * jnp.mean(jnp.square(candidate_delta))
        return residual + regularization

    raw_delta = jnp.zeros_like(jnp.asarray(target_delta))
    optimizer = optax.adam(SO100_GEOMETRY_REPAIR_LEARNING_RATE)
    optimizer_state = optimizer.init(raw_delta)
    value_and_grad = jax.jit(jax.value_and_grad(loss))
    initial_loss = float(loss(raw_delta))

    for _ in range(optimizer_steps):
        _, gradients = value_and_grad(raw_delta)
        updates, optimizer_state = optimizer.update(gradients, optimizer_state, raw_delta)
        raw_delta = optax.apply_updates(raw_delta, updates)

    recovered_delta = np.asarray(bounded_delta(raw_delta), dtype=np.float32)
    final_loss = float(loss(raw_delta))
    target_delta_np = np.asarray(target_delta, dtype=np.float32)
    target_joint_indices = np.flatnonzero(np.abs(target_delta_np).sum(axis=1) > 0)
    origin_errors = np.linalg.norm(
        recovered_delta[target_joint_indices] - target_delta_np[target_joint_indices],
        axis=1,
    )
    max_origin_error = float(origin_errors.max()) if origin_errors.size else 0.0

    return So100GeometryRepairResult(
        initial_loss=initial_loss,
        final_loss=final_loss,
        loss_reduction_ratio=_loss_reduction(initial_loss, final_loss),
        max_origin_error_m=max_origin_error,
        optimizer_steps=optimizer_steps,
        rollout_steps=rollout_steps,
        recovered_offsets_m={
            joint.name: tuple(float(value) for value in recovered_delta[joint_index])
            for joint_index, joint in enumerate(kinematic_model.joints)
            if joint.name in SO100_GEOMETRY_REPAIR_TARGET_ORIGIN_OFFSETS_M
        },
        target_offsets_m=SO100_GEOMETRY_REPAIR_TARGET_ORIGIN_OFFSETS_M,
        tracked_link_names=kinematic_model.tracked_link_names,
    )


def assert_so100_geometry_repair_result_is_healthy(result: So100GeometryRepairResult) -> None:
    checks = {
        "initial_loss_finite": np.isfinite(result.initial_loss),
        "final_loss_finite": np.isfinite(result.final_loss),
        "final_loss_below_threshold": result.final_loss <= SO100_GEOMETRY_REPAIR_MAX_FINAL_LOSS,
        "loss_reduction": result.loss_reduction_ratio >= SO100_GEOMETRY_REPAIR_MIN_LOSS_REDUCTION_RATIO,
        "origin_recovery": result.max_origin_error_m <= SO100_GEOMETRY_REPAIR_MAX_ORIGIN_ERROR_M,
    }
    failed = [name for name, passed in checks.items() if not passed]
    if failed:
        raise AssertionError(f"SO100 geometry repair benchmark failed checks: {failed}. Result: {result}")
