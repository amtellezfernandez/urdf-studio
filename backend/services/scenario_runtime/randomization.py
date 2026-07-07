from __future__ import annotations

import random

from backend.models.scenario import (
    EpisodeManifest,
    EpisodeObjectPlacement,
    ScenarioDocument,
)
from backend.models.world_scene_package import WorldSceneRegistryEnvelope


def sample_episode_manifests(
    scenario: ScenarioDocument,
    world: WorldSceneRegistryEnvelope,
) -> list[EpisodeManifest]:
    """Sample fully-resolved initial conditions for every episode.

    One manifest per episode, seeded from evaluation.seeds (padded with
    randomization.seed + index); the same manifests are fed to every simulator
    so cross-sim comparisons share exact initial states.
    """
    seeds = list(scenario.evaluation.seeds)
    while len(seeds) < scenario.evaluation.episodes:
        seeds.append(scenario.task.randomization.seed + len(seeds))
    base_poses = _world_object_poses(world)
    manifests: list[EpisodeManifest] = []
    for episode_index in range(scenario.evaluation.episodes):
        seed = seeds[episode_index]
        rng = random.Random(seed)
        placements: dict[str, EpisodeObjectPlacement] = {}
        for object_id, jitter in scenario.task.randomization.object_pose.items():
            base_position, base_rotation = base_poses.get(
                object_id, ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
            )
            position = [
                base + rng.uniform(-magnitude, magnitude)
                for base, magnitude in zip(base_position, jitter.position_jitter_m)
            ]
            if jitter.region is not None:
                region = scenario.task.randomization.regions[jitter.region]
                position = [
                    min(max(value, low), high)
                    for value, low, high in zip(position, region.aabb_min, region.aabb_max)
                ]
            yaw = base_rotation[2] + rng.uniform(-jitter.yaw_jitter_rad, jitter.yaw_jitter_rad)
            placements[object_id] = EpisodeObjectPlacement(
                position_xyz=(position[0], position[1], position[2]),
                rotation_rpy_rad=(base_rotation[0], base_rotation[1], yaw),
            )
        init_joints = dict(scenario.robot.init_joint_positions)
        for pattern, magnitude in scenario.robot.init_noise_joint_regex.items():
            import re

            matcher = re.compile(pattern)
            for joint_name in list(init_joints):
                if matcher.search(joint_name):
                    init_joints[joint_name] += rng.uniform(-magnitude, magnitude)
        manifests.append(
            EpisodeManifest(
                scenario_id=scenario.scenario_id,
                episode_index=episode_index,
                seed=seed,
                object_placements=placements,
                init_joint_positions=init_joints,
            )
        )
    return manifests


def _world_object_poses(
    world: WorldSceneRegistryEnvelope,
) -> dict[str, tuple[tuple[float, float, float], tuple[float, float, float]]]:
    poses: dict[str, tuple[tuple[float, float, float], tuple[float, float, float]]] = {}
    for world_object in world.world.objects:
        if not isinstance(world_object, dict):
            continue
        object_id = str(world_object.get("id", "")).strip()
        if not object_id:
            continue
        position = tuple(float(v) for v in world_object.get("position_xyz", (0.0, 0.0, 0.0)))
        rotation = tuple(float(v) for v in world_object.get("rotation_rpy_rad", (0.0, 0.0, 0.0)))
        poses[object_id] = (position, rotation)
    return poses
