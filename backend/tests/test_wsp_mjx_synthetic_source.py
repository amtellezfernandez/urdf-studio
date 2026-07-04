from __future__ import annotations

import pytest

from backend.services.world_model_dataset import validate_world_model_dataset_samples
from backend.services.wsp_mjx_synthetic_source import generate_mjx_synthetic_training_samples

pytest.importorskip("jax")
pytest.importorskip("mujoco")
pytest.importorskip("mujoco.mjx")

_PENDULUM_URDF = """<?xml version="1.0"?>
<robot name="pendulum">
  <link name="base_link">
    <inertial><mass value="1.0"/><origin xyz="0 0 0"/><inertia ixx="0.01" iyy="0.01" izz="0.01" ixy="0" ixz="0" iyz="0"/></inertial>
  </link>
  <link name="arm_link">
    <inertial><mass value="0.5"/><origin xyz="0 0 -0.2"/><inertia ixx="0.01" iyy="0.01" izz="0.01" ixy="0" ixz="0" iyz="0"/></inertial>
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


def test_generate_mjx_synthetic_training_samples_produces_valid_dataset_samples() -> None:
    samples = generate_mjx_synthetic_training_samples(
        urdf_xml=_PENDULUM_URDF, episode_count=2, steps_per_episode=5, seed=3
    )

    assert len(samples) == 2 * (5 - 1)
    for sample in samples:
        assert sample.metadata["split"] == "mjx_synthetic_rollout"
        source_trace_metadata = sample.metadata["source_trace_metadata"]
        assert source_trace_metadata["source_kind"] == "mjx_vectorized_rollout"
        assert source_trace_metadata["mjx_diverged"] is False

    report = validate_world_model_dataset_samples(samples, dataset_id="mjx-synthetic-smoke")
    assert report.ready is True
    assert report.errors == []
