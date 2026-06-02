from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from backend.services.so100_sysid.model import So100MujocoModel, load_so100_mujoco_model
from backend.services.so100_sysid.params import (
    SO100_SYNTHETIC_ACTION_AMPLITUDE_RAD,
    SO100_SYNTHETIC_ACTION_FREQUENCY_SCALE,
    SO100_SYNTHETIC_CONTROL_LIMIT_NM,
    SO100_SYNTHETIC_INITIAL_DAMPING,
    SO100_SYNTHETIC_INITIAL_GAIN,
    SO100_SYNTHETIC_LEARNING_RATE,
    SO100_SYNTHETIC_OPTIMIZER_STEPS,
    SO100_SYNTHETIC_PHASE_OFFSET_RAD,
    SO100_SYNTHETIC_STEP_COUNT,
    SO100_SYNTHETIC_TRUE_DAMPING,
    SO100_SYNTHETIC_TRUE_GAIN,
)


@dataclass(frozen=True)
class So100SysIdBenchmarkResult:
    initial_loss: float
    final_loss: float
    loss_reduction_ratio: float
    recovered_gain: float
    recovered_damping: float
    true_gain: float
    true_damping: float
    final_gradient_norm: float
    optimizer_steps: int
    rollout_steps: int
    joint_names: tuple[str, ...]


def _relative_loss_reduction(initial_loss: float, final_loss: float) -> float:
    if initial_loss <= 0:
        return 0.0
    return (initial_loss - final_loss) / initial_loss


def _tree_l2_norm(tree: object) -> float:
    import jax
    import jax.numpy as jnp

    leaves = jax.tree_util.tree_leaves(tree)
    if not leaves:
        return 0.0
    return float(jnp.sqrt(sum(jnp.sum(jnp.square(leaf)) for leaf in leaves)))


def _build_reference_actions(model: So100MujocoModel, step_count: int):
    import jax.numpy as jnp

    qpos_reference = jnp.asarray(model.qpos_reference, dtype=jnp.float32)
    time = jnp.linspace(0.0, 1.0, step_count, dtype=jnp.float32)
    joint_targets = [
        SO100_SYNTHETIC_ACTION_AMPLITUDE_RAD
        * jnp.sin(
            2.0 * jnp.pi * SO100_SYNTHETIC_ACTION_FREQUENCY_SCALE * (joint_index + 1) * time
            + SO100_SYNTHETIC_PHASE_OFFSET_RAD * joint_index
        )
        for joint_index in range(len(model.joint_names))
    ]
    return qpos_reference + jnp.stack(joint_targets, axis=1)


def run_so100_synthetic_sysid_benchmark(
    *,
    model: So100MujocoModel | None = None,
    optimizer_steps: int = SO100_SYNTHETIC_OPTIMIZER_STEPS,
    rollout_steps: int = SO100_SYNTHETIC_STEP_COUNT,
) -> So100SysIdBenchmarkResult:
    """Recover SO100 PD gain/damping from synthetic MJX trajectory data."""

    import jax
    import jax.numpy as jnp
    import optax
    from mujoco import mjx

    so100_model = model or load_so100_mujoco_model()
    mjx_model = mjx.put_model(so100_model.model)
    mjx_data = mjx.make_data(mjx_model)
    qpos_reference = jnp.asarray(so100_model.qpos_reference, dtype=jnp.float32)
    actions = _build_reference_actions(so100_model, rollout_steps)

    def rollout(params: dict[str, jnp.ndarray]):
        initial_data = mjx_data.replace(
            qpos=qpos_reference,
            qvel=jnp.zeros(mjx_model.nv, dtype=jnp.float32),
        )

        def step(carry, target_qpos):
            gain = jnp.exp(params["log_gain"])
            damping = jnp.exp(params["log_damping"])
            torque = gain * (target_qpos - carry.qpos) - damping * carry.qvel
            bounded_torque = jnp.clip(
                torque,
                -SO100_SYNTHETIC_CONTROL_LIMIT_NM,
                SO100_SYNTHETIC_CONTROL_LIMIT_NM,
            )
            next_data = mjx.step(mjx_model, carry.replace(qfrc_applied=bounded_torque))
            return next_data, next_data.qpos

        _, qpos_history = jax.lax.scan(step, initial_data, actions)
        return qpos_history

    true_params = {
        "log_gain": jnp.log(jnp.asarray(SO100_SYNTHETIC_TRUE_GAIN, dtype=jnp.float32)),
        "log_damping": jnp.log(jnp.asarray(SO100_SYNTHETIC_TRUE_DAMPING, dtype=jnp.float32)),
    }
    observed_qpos = rollout(true_params)

    def loss(params: dict[str, jnp.ndarray]):
        predicted_qpos = rollout(params)
        return jnp.mean(jnp.square(predicted_qpos - observed_qpos))

    value_and_grad = jax.jit(jax.value_and_grad(loss))
    params = {
        "log_gain": jnp.log(jnp.asarray(SO100_SYNTHETIC_INITIAL_GAIN, dtype=jnp.float32)),
        "log_damping": jnp.log(jnp.asarray(SO100_SYNTHETIC_INITIAL_DAMPING, dtype=jnp.float32)),
    }
    optimizer = optax.adam(SO100_SYNTHETIC_LEARNING_RATE)
    optimizer_state = optimizer.init(params)
    initial_loss = float(loss(params))
    gradients = None

    for _ in range(optimizer_steps):
        _, gradients = value_and_grad(params)
        updates, optimizer_state = optimizer.update(gradients, optimizer_state, params)
        params = optax.apply_updates(params, updates)

    final_loss = float(loss(params))
    _, final_gradients = value_and_grad(params)
    recovered_gain = float(jnp.exp(params["log_gain"]))
    recovered_damping = float(jnp.exp(params["log_damping"]))

    return So100SysIdBenchmarkResult(
        initial_loss=initial_loss,
        final_loss=final_loss,
        loss_reduction_ratio=_relative_loss_reduction(initial_loss, final_loss),
        recovered_gain=recovered_gain,
        recovered_damping=recovered_damping,
        true_gain=SO100_SYNTHETIC_TRUE_GAIN,
        true_damping=SO100_SYNTHETIC_TRUE_DAMPING,
        final_gradient_norm=_tree_l2_norm(final_gradients if gradients is not None else {}),
        optimizer_steps=optimizer_steps,
        rollout_steps=rollout_steps,
        joint_names=so100_model.joint_names,
    )


def assert_so100_sysid_result_is_healthy(result: So100SysIdBenchmarkResult) -> None:
    from backend.services.so100_sysid.params import (
        SO100_SYNTHETIC_MAX_DAMPING_RELATIVE_ERROR,
        SO100_SYNTHETIC_MAX_FINAL_LOSS,
        SO100_SYNTHETIC_MAX_GAIN_RELATIVE_ERROR,
        SO100_SYNTHETIC_MIN_LOSS_REDUCTION_RATIO,
    )

    gain_error = abs(result.recovered_gain - result.true_gain) / result.true_gain
    damping_error = abs(result.recovered_damping - result.true_damping) / result.true_damping
    checks = {
        "initial_loss_finite": np.isfinite(result.initial_loss),
        "final_loss_finite": np.isfinite(result.final_loss),
        "final_loss_below_threshold": result.final_loss <= SO100_SYNTHETIC_MAX_FINAL_LOSS,
        "loss_reduction": result.loss_reduction_ratio >= SO100_SYNTHETIC_MIN_LOSS_REDUCTION_RATIO,
        "gain_recovery": gain_error <= SO100_SYNTHETIC_MAX_GAIN_RELATIVE_ERROR,
        "damping_recovery": damping_error <= SO100_SYNTHETIC_MAX_DAMPING_RELATIVE_ERROR,
    }
    failed = [name for name, passed in checks.items() if not passed]
    if failed:
        raise AssertionError(f"SO100 SysID benchmark failed checks: {failed}. Result: {result}")
