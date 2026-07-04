from __future__ import annotations

import math
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from backend.models.physical_state import ActionToken, PhysicalEntity, PhysicalRolloutTrace, PhysicalStateFrame
from backend.services.ilu_urdf import convert_urdf_to_mjcf

_PD_GAIN = 20.0
_PD_DAMPING = 2.0
_MJX_CONTACT_DISABLED_SUFFIX = ".mjx"


def _validate_positive_int(name: str, value: int) -> None:
    if value <= 0:
        raise ValueError(f"{name} must be > 0.")


def _validate_finite_positive_float(name: str, value: float) -> None:
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be a finite value > 0.")


def _validate_non_negative_float(name: str, value: float) -> None:
    if not math.isfinite(value) or value < 0:
        raise ValueError(f"{name} must be a finite value >= 0.")


def _validate_scale_range(name: str, value: tuple[float, float]) -> None:
    lower, upper = value
    _validate_finite_positive_float(f"{name}[0]", lower)
    _validate_finite_positive_float(f"{name}[1]", upper)
    if lower > upper:
        raise ValueError(f"{name} lower bound must be <= upper bound.")


@dataclass(frozen=True)
class MjxRolloutBatchConfig:
    urdf_xml: str = ""
    model_xml_path: Path | None = None
    episode_count: int = 4
    steps_per_episode: int = 50
    seed: int = 0
    timestep_seconds: float | None = None
    action_amplitude_rad: float = 0.3
    action_frequency_hz: float = 1.0
    friction_scale_range: tuple[float, float] = (1.0, 1.0)
    mass_scale_range: tuple[float, float] = (1.0, 1.0)
    trace_id_prefix: str = "mjx-rollout"

    def __post_init__(self) -> None:
        has_urdf_xml = bool(self.urdf_xml.strip())
        if not has_urdf_xml and self.model_xml_path is None:
            raise ValueError("urdf_xml or model_xml_path must be provided.")
        if not self.trace_id_prefix.strip():
            raise ValueError("trace_id_prefix must not be empty.")
        _validate_positive_int("episode_count", self.episode_count)
        _validate_positive_int("steps_per_episode", self.steps_per_episode)
        if self.timestep_seconds is not None:
            _validate_finite_positive_float("timestep_seconds", self.timestep_seconds)
        _validate_non_negative_float("action_amplitude_rad", self.action_amplitude_rad)
        _validate_finite_positive_float("action_frequency_hz", self.action_frequency_hz)
        _validate_scale_range("friction_scale_range", self.friction_scale_range)
        _validate_scale_range("mass_scale_range", self.mass_scale_range)


@dataclass(frozen=True)
class MjxRolloutEpisode:
    trace: PhysicalRolloutTrace
    diverged: bool
    wall_time_ms: float


def _disable_mjcf_contacts(mjcf_content: str) -> str:
    root = ET.fromstring(mjcf_content)
    for geom in root.iter("geom"):
        geom.set("contype", "0")
        geom.set("conaffinity", "0")
    contact_node = root.find("contact")
    if contact_node is not None:
        root.remove(contact_node)
    return ET.tostring(root, encoding="unicode")


def _write_mjx_compatible_model_xml(source_path: Path) -> Path:
    compatible_path = source_path.with_name(
        f"{source_path.stem}{_MJX_CONTACT_DISABLED_SUFFIX}{source_path.suffix}"
    )
    compatible_path.write_text(
        _disable_mjcf_contacts(source_path.read_text(encoding="utf-8")),
        encoding="utf-8",
    )
    return compatible_path


def _finite_vector(values: np.ndarray, expected_length: int) -> list[float] | None:
    vector = np.asarray(values, dtype=float).reshape(-1)
    if vector.shape != (expected_length,) or not np.all(np.isfinite(vector)):
        return None
    return vector.tolist()


def run_mjx_rollout_batch(config: MjxRolloutBatchConfig) -> list[MjxRolloutEpisode]:
    import jax
    import jax.numpy as jnp
    import mujoco
    from mujoco import mjx

    if config.model_xml_path is not None:
        model_xml_path = _write_mjx_compatible_model_xml(config.model_xml_path)
        mj_model = mujoco.MjModel.from_xml_path(str(model_xml_path.resolve()))
    else:
        conversion = convert_urdf_to_mjcf(config.urdf_xml)
        mj_model = mujoco.MjModel.from_xml_string(_disable_mjcf_contacts(conversion.mjcf_content))
    if config.timestep_seconds is not None:
        mj_model.opt.timestep = config.timestep_seconds
    dt = float(mj_model.opt.timestep)
    step_count = config.steps_per_episode

    body_names = tuple(
        mujoco.mj_id2name(mj_model, mujoco.mjtObj.mjOBJ_BODY, body_index) or f"body_{body_index}"
        for body_index in range(mj_model.nbody)
    )

    base_mjx_model = mjx.put_model(mj_model)
    base_mjx_data = mjx.make_data(base_mjx_model)

    rng = np.random.default_rng(config.seed)
    friction_scales = rng.uniform(*config.friction_scale_range, size=config.episode_count)
    mass_scales = rng.uniform(*config.mass_scale_range, size=config.episode_count)
    phase_offsets = rng.uniform(0.0, 2.0 * np.pi, size=(config.episode_count, mj_model.nv))

    time_seconds = jnp.arange(step_count, dtype=jnp.float32) * dt
    joint_freq_scale = jnp.arange(1, mj_model.nv + 1, dtype=jnp.float32)

    def action_targets(qpos0, phase_offset):
        deltas = config.action_amplitude_rad * jnp.sin(
            2.0 * jnp.pi * config.action_frequency_hz * joint_freq_scale[None, :] * time_seconds[:, None]
            + phase_offset[None, :]
        )
        return qpos0[None, :] + deltas

    def single_rollout(friction_scale, mass_scale, phase_offset):
        model = base_mjx_model.replace(
            geom_friction=base_mjx_model.geom_friction * friction_scale,
            body_mass=base_mjx_model.body_mass * mass_scale,
        )
        targets = action_targets(base_mjx_data.qpos, phase_offset)

        def step_fn(carry, target_qpos):
            torque = _PD_GAIN * (target_qpos - carry.qpos) - _PD_DAMPING * carry.qvel
            next_data = mjx.step(model, carry.replace(qfrc_applied=torque))
            return next_data, (next_data.qpos, next_data.xpos, next_data.xquat)

        _, history = jax.lax.scan(step_fn, base_mjx_data, targets)
        qpos_hist, xpos_hist, xquat_hist = history
        return qpos_hist, xpos_hist, xquat_hist, targets

    batched_rollout = jax.vmap(single_rollout, in_axes=(0, 0, 0))

    started_at = time.monotonic()
    qpos_batch, xpos_batch, xquat_batch, target_batch = batched_rollout(
        jnp.asarray(friction_scales, dtype=jnp.float32),
        jnp.asarray(mass_scales, dtype=jnp.float32),
        jnp.asarray(phase_offsets, dtype=jnp.float32),
    )
    jax.block_until_ready((qpos_batch, xpos_batch, xquat_batch, target_batch))
    total_wall_time_ms = (time.monotonic() - started_at) * 1000.0
    per_episode_wall_time_ms = total_wall_time_ms / max(config.episode_count, 1)

    qpos_np = np.asarray(qpos_batch)
    xpos_np = np.asarray(xpos_batch)
    xquat_np = np.asarray(xquat_batch)
    target_np = np.asarray(target_batch)

    episodes: list[MjxRolloutEpisode] = []
    for episode_index in range(config.episode_count):
        diverged = not (
            bool(np.all(np.isfinite(qpos_np[episode_index])))
            and bool(np.all(np.isfinite(xpos_np[episode_index])))
        )
        frames: list[PhysicalStateFrame] = []
        for step_index in range(step_count):
            entities: list[PhysicalEntity] = []
            for body_index in range(1, mj_model.nbody):
                position_xyz = _finite_vector(
                    xpos_np[episode_index, step_index, body_index],
                    3,
                )
                quat_wxyz = _finite_vector(
                    xquat_np[episode_index, step_index, body_index],
                    4,
                )
                if position_xyz is None or quat_wxyz is None:
                    continue
                entities.append(
                    PhysicalEntity(
                        entity_id=body_names[body_index],
                        entity_type="robot",
                        geometry_type="unknown",
                        position_xyz=position_xyz,
                        quat_wxyz=quat_wxyz,
                    )
                )
            frames.append(
                PhysicalStateFrame(
                    frame_id=f"{config.trace_id_prefix}-{episode_index:04d}:{step_index}",
                    t_ms=int(round(step_index * dt * 1000.0)),
                    frame_convention="mujoco-z-up",
                    entities=entities,
                )
            )
        actions = [
            ActionToken(
                action_id=f"mjx-target-{step_index:04d}",
                action_type="set_pose",
                actor_id=body_names[1] if mj_model.nbody > 1 else None,
                params={"target_qpos": target_np[episode_index, step_index].tolist()},
                start_time_ms=int(round(step_index * dt * 1000.0)),
            )
            for step_index in range(step_count)
        ]
        trace = PhysicalRolloutTrace(
            trace_id=f"{config.trace_id_prefix}-{episode_index:04d}",
            frames=frames,
            actions=actions,
            metadata={
                "friction_scale": float(friction_scales[episode_index]),
                "mass_scale": float(mass_scales[episode_index]),
            },
        )
        episodes.append(
            MjxRolloutEpisode(
                trace=trace,
                diverged=diverged,
                wall_time_ms=per_episode_wall_time_ms,
            )
        )

    return episodes
