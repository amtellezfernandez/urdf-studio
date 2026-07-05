from __future__ import annotations

from pathlib import Path

import pytest

from backend.services.executability_audit import audit_physical_rollout_trace
from backend.services.mjx_rollout_runner import MjxRolloutBatchConfig, run_mjx_rollout_batch

pytest.importorskip("jax")
pytest.importorskip("mujoco")
pytest.importorskip("mujoco.mjx")

_PENDULUM_URDF = """<?xml version="1.0"?>
<robot name="pendulum">
  <link name="base_link">
    <inertial><mass value="1.0"/><origin xyz="0 0 0"/><inertia ixx="0.01" iyy="0.01" izz="0.01" ixy="0" ixz="0" iyz="0"/></inertial>
    <visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual>
  </link>
  <link name="arm_link">
    <inertial><mass value="0.5"/><origin xyz="0 0 -0.2"/><inertia ixx="0.01" iyy="0.01" izz="0.01" ixy="0" ixz="0" iyz="0"/></inertial>
    <visual><geometry><box size="0.05 0.05 0.4"/></geometry></visual>
  </link>
  <joint name="shoulder" type="revolute">
    <parent link="base_link"/>
    <child link="arm_link"/>
    <origin xyz="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-3.14" upper="3.14" effort="10" velocity="5"/>
  </joint>
</robot>
"""


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"episode_count": 0}, "episode_count"),
        ({"steps_per_episode": 0}, "steps_per_episode"),
        ({"timestep_seconds": 0.0}, "timestep_seconds"),
        ({"action_amplitude_rad": -0.1}, "action_amplitude_rad"),
        ({"action_frequency_hz": 0.0}, "action_frequency_hz"),
        ({"friction_scale_range": (1.5, 0.5)}, "friction_scale_range"),
        ({"mass_scale_range": (0.0, 1.0)}, "mass_scale_range"),
        ({"trace_id_prefix": ""}, "trace_id_prefix"),
    ],
)
def test_mjx_rollout_batch_config_rejects_invalid_values(
    kwargs: dict[str, object],
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        MjxRolloutBatchConfig(urdf_xml=_PENDULUM_URDF, **kwargs)


def test_run_mjx_rollout_batch_produces_shaped_traces() -> None:
    config = MjxRolloutBatchConfig(urdf_xml=_PENDULUM_URDF, episode_count=2, steps_per_episode=5, seed=1)

    episodes = run_mjx_rollout_batch(config)

    assert len(episodes) == 2
    for episode in episodes:
        assert episode.diverged is False
        assert episode.wall_time_ms >= 0.0
        assert len(episode.trace.frames) == 5
        assert len(episode.trace.actions) == 5
        for frame in episode.trace.frames:
            assert frame.frame_convention == "mujoco-z-up"
            entity_ids = {entity.entity_id for entity in frame.entities}
            assert entity_ids == {"base_link", "arm_link"}


def test_run_mjx_rollout_batch_loads_model_xml_path(tmp_path: Path) -> None:
    model_path = tmp_path / "robot.xml"
    model_path.write_text(
        """<mujoco>
  <worldbody>
    <body name="base_link" pos="0 0 0">
      <joint name="shoulder" type="hinge" axis="0 1 0"/>
      <geom type="box" size="0.05 0.05 0.05"/>
    </body>
  </worldbody>
</mujoco>
""",
        encoding="utf-8",
    )
    config = MjxRolloutBatchConfig(
        model_xml_path=model_path,
        episode_count=1,
        steps_per_episode=3,
    )

    episode = run_mjx_rollout_batch(config)[0]

    assert episode.diverged is False
    assert len(episode.trace.frames) == 3
    assert {entity.entity_id for entity in episode.trace.frames[0].entities} == {"base_link"}


def test_run_mjx_rollout_batch_rejects_invalid_model_xml_encoding(tmp_path: Path) -> None:
    model_path = tmp_path / "robot.xml"
    model_path.write_bytes(b"\xff\xfe\x00")

    with pytest.raises(ValueError, match=r"Failed to read MJCF model XML:"):
        run_mjx_rollout_batch(
            MjxRolloutBatchConfig(
                model_xml_path=model_path,
                episode_count=1,
                steps_per_episode=3,
            )
        )


def test_run_mjx_rollout_batch_output_passes_executability_audit() -> None:
    config = MjxRolloutBatchConfig(urdf_xml=_PENDULUM_URDF, episode_count=1, steps_per_episode=5, seed=2)

    episode = run_mjx_rollout_batch(config)[0]
    report = audit_physical_rollout_trace(episode.trace)

    assert report.success is True


def test_run_mjx_rollout_batch_domain_randomization_varies_per_episode() -> None:
    config = MjxRolloutBatchConfig(
        urdf_xml=_PENDULUM_URDF,
        episode_count=3,
        steps_per_episode=3,
        seed=7,
        friction_scale_range=(0.5, 1.5),
        mass_scale_range=(0.8, 1.2),
    )

    episodes = run_mjx_rollout_batch(config)

    friction_scales = {episode.trace.metadata["friction_scale"] for episode in episodes}
    mass_scales = {episode.trace.metadata["mass_scale"] for episode in episodes}
    assert len(friction_scales) == 3
    assert len(mass_scales) == 3
