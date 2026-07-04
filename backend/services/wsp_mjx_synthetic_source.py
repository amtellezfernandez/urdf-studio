from __future__ import annotations

from backend.models.physical_state import WorldModelTrainingSample
from backend.services.mjx_rollout_runner import MjxRolloutBatchConfig, run_mjx_rollout_batch
from backend.services.world_model_dataset import build_world_model_training_samples


def generate_mjx_synthetic_training_samples(
    *,
    urdf_xml: str,
    episode_count: int,
    steps_per_episode: int,
    seed: int,
) -> list[WorldModelTrainingSample]:
    config = MjxRolloutBatchConfig(
        urdf_xml=urdf_xml,
        episode_count=episode_count,
        steps_per_episode=steps_per_episode,
        seed=seed,
    )
    episodes = run_mjx_rollout_batch(config)

    samples: list[WorldModelTrainingSample] = []
    for episode in episodes:
        trace = episode.trace.model_copy(deep=True)
        trace.metadata["source_kind"] = "mjx_vectorized_rollout"
        trace.metadata["mjx_diverged"] = episode.diverged
        samples.extend(
            build_world_model_training_samples(
                trace,
                metadata={"split": "mjx_synthetic_rollout"},
            )
        )
    return samples
