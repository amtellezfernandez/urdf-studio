"""Ingest real LeRobot episodes from HuggingFace into the WSP pipeline.

Supported robots:
  - SO-101: lerobot/svla_so101_pickplace  (default, robot="so101")
  - SO-100: lerobot/svla_so100_pickplace  (robot="so100")

Values:  degrees — converted to radians before FK

Provides the first real-hardware data tier for the WSP benchmark.
Requires: datasets >= 4.0  (already in .venv-lerobot)
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.models.physical_state import (
    ActionToken,
    PhysicalEntity,
    PhysicalRolloutTrace,
    PhysicalStateFrame,
    WorldModelTrainingSample,
)
from backend.services.robot_rollout_generator import UrdfEntry, fk_position, load_urdf_entry
from backend.services.world_model_dataset import build_world_model_training_samples

# ── Robot configuration registry ─────────────────────────────────────────────

_REPO_ROOT = Path(__file__).parents[2]

@dataclass(frozen=True)
class _RobotConfig:
    urdf_path: Path
    ee_link: str
    entity_id: str


_ROBOT_CONFIGS: dict[str, _RobotConfig] = {
    "so101": _RobotConfig(
        urdf_path=(
            _REPO_ROOT / "third_party/so-arm100/Simulation/SO101/so101_new_calib.urdf"
        ),
        ee_link="gripper_link",
        entity_id="so101",
    ),
    "so100": _RobotConfig(
        urdf_path=(
            _REPO_ROOT / "third_party/so-arm100/Simulation/SO100/so100.urdf"
        ),
        ee_link="jaw",
        entity_id="so100",
    ),
}

# Joint order as it appears in both lerobot datasets (degrees).
# Verified by matching observed ranges against SO-1xx physical joint limits.
SO101_DATASET_JOINT_NAMES = [
    "shoulder_pan",
    "shoulder_lift",
    "elbow_flex",
    "wrist_flex",
    "wrist_roll",
    "gripper",
]

# ── URDF entry cache (keyed by robot name) ────────────────────────────────────

_ENTRY_CACHE: dict[str, UrdfEntry] = {}


def get_robot_urdf_entry(robot: str = "so101") -> UrdfEntry:
    """Return (cached) UrdfEntry for the given robot name."""
    if robot not in _ENTRY_CACHE:
        cfg = _ROBOT_CONFIGS.get(robot)
        if cfg is None:
            raise ValueError(
                f"Unknown robot {robot!r}. Available: {list(_ROBOT_CONFIGS)}"
            )
        urdf_text = cfg.urdf_path.read_text(encoding="utf-8")
        _ENTRY_CACHE[robot] = load_urdf_entry(urdf_text)
    return _ENTRY_CACHE[robot]


# ── Conversion helpers ────────────────────────────────────────────────────────


def joint_dict_from_degrees(state_degrees: list[float]) -> dict[str, float]:
    """Map dataset joint values (degrees) to a {joint_name: radians} dict."""
    return {
        name: math.radians(val)
        for name, val in zip(SO101_DATASET_JOINT_NAMES, state_degrees)
    }


def fk_ee_from_degrees(state_degrees: list[float], robot: str = "so101") -> list[float]:
    """Return end-effector [x, y, z] (m) from joint state in degrees."""
    cfg = _ROBOT_CONFIGS[robot]
    entry = get_robot_urdf_entry(robot)
    return fk_position(entry, joint_dict_from_degrees(state_degrees), cfg.ee_link)


def _robot_entity(
    state_degrees: list[float],
    entry: UrdfEntry,
    *,
    robot: str = "so101",
) -> PhysicalEntity:
    cfg = _ROBOT_CONFIGS[robot]
    q_dict = joint_dict_from_degrees(state_degrees)
    ee_pos = fk_position(entry, q_dict, cfg.ee_link)
    return PhysicalEntity(
        entity_id=cfg.entity_id,
        entity_type="robot",
        geometry_type="box",
        position_xyz=ee_pos,
        size_xyz=[0.03, 0.03, 0.03],
        metadata={
            "joint_state_deg": state_degrees,
            "joint_names": SO101_DATASET_JOINT_NAMES,
            "source_kind": "lerobot_hf",
        },
    )


def _table_entity() -> PhysicalEntity:
    return PhysicalEntity(
        entity_id="work_surface",
        entity_type="surface",
        geometry_type="box",
        position_xyz=[0.0, 0.0, -0.025],
        size_xyz=[1.0, 0.8, 0.05],
        movable=False,
        metadata={"source_kind": "lerobot_hf_scene"},
    )


def _action_token(
    action_degrees: list[float],
    *,
    frame_index: int,
    trace_id: str,
    robot: str = "so101",
) -> ActionToken:
    cfg = _ROBOT_CONFIGS[robot]
    return ActionToken(
        action_id=f"{trace_id}:f{frame_index}",
        action_type="set_pose",
        actor_id=cfg.entity_id,
        params={
            "joint_targets_deg": action_degrees,
            "joint_targets_rad": [math.radians(v) for v in action_degrees],
            "joint_names": SO101_DATASET_JOINT_NAMES,
        },
    )


# ── Main ingest API ───────────────────────────────────────────────────────────


def load_lerobot_hf_episode(
    repo_id: str = "lerobot/svla_so101_pickplace",
    episode_index: int = 0,
    *,
    robot: str = "so101",
    max_frames: int | None = None,
) -> PhysicalRolloutTrace:
    """Load a real LeRobot HuggingFace episode and compile it to a PhysicalRolloutTrace.

    Joint positions in the dataset are in degrees; FK is computed via the
    robot URDF so entity positions are in world-space metres.

    Args:
        repo_id: HuggingFace dataset repo id.
        episode_index: Which episode to load.
        robot: "so101" (default) or "so100".
        max_frames: Optional cap on number of frames to load.

    Requires: pip install datasets  (already in .venv-lerobot)
    """
    try:
        from datasets import load_dataset  # type: ignore[import-not-found]
    except ImportError as exc:
        raise ImportError(
            "Loading HuggingFace datasets requires: pip install datasets"
        ) from exc

    cfg = _ROBOT_CONFIGS.get(robot)
    if cfg is None:
        raise ValueError(f"Unknown robot {robot!r}. Available: {list(_ROBOT_CONFIGS)}")

    ds = load_dataset(repo_id, split="train", streaming=True)
    raw_frames = sorted(
        (row for row in ds if row["episode_index"] == episode_index),
        key=lambda r: r["frame_index"],
    )
    if max_frames is not None:
        raw_frames = raw_frames[:max_frames]

    if len(raw_frames) < 2:
        raise ValueError(
            f"Episode {episode_index} in {repo_id!r} has {len(raw_frames)} frame(s); "
            "need ≥2 for a WSP trace."
        )

    entry = get_robot_urdf_entry(robot)
    trace_id = f"lerobot-hf-{repo_id.split('/')[-1]}-ep{episode_index:04d}"
    table = _table_entity()
    frames: list[PhysicalStateFrame] = []
    actions: list[ActionToken] = []

    for idx, row in enumerate(raw_frames):
        t_ms = int(round(row["timestamp"] * 1000))
        robot_entity = _robot_entity(row["observation.state"], entry, robot=robot)
        frames.append(
            PhysicalStateFrame(
                frame_id=f"{trace_id}:f{idx}",
                t_ms=t_ms,
                frame_convention="ros-z-up",
                entities=[robot_entity, table],
                metadata={
                    "source_kind": "lerobot_hf",
                    "frame_index": int(row["frame_index"]),
                    "episode_index": episode_index,
                    "task_index": int(row["task_index"]),
                    "repo_id": repo_id,
                },
            )
        )
        # Actions connect frame[idx] → frame[idx+1]; last frame has no outgoing action
        if idx < len(raw_frames) - 1:
            actions.append(
                _action_token(row["action"], frame_index=idx, trace_id=trace_id, robot=robot)
            )

    return PhysicalRolloutTrace(
        trace_id=trace_id,
        frames=frames,
        actions=actions,
        metadata={
            "source_kind": "lerobot_hf",
            "repo_id": repo_id,
            "episode_index": episode_index,
            "frame_count": len(frames),
            "robot": robot,
            "ee_link": cfg.ee_link,
        },
    )


def build_so101_hf_benchmark(
    repo_id: str = "lerobot/svla_so101_pickplace",
    *,
    robot: str = "so101",
    episode_indices: list[int] | None = None,
    max_episodes: int = 5,
    max_frames_per_episode: int = 50,
) -> list[WorldModelTrainingSample]:
    """Build a real-data WSP benchmark from HuggingFace SO-1xx pick-place episodes.

    Each real episode becomes a PhysicalRolloutTrace; the WSP deterministic audit
    labels each transition (joint limits, reachability, contact stability, etc.).

    Returns one WorldModelTrainingSample per consecutive frame pair across all episodes.
    """
    indices = episode_indices if episode_indices is not None else list(range(max_episodes))
    samples: list[WorldModelTrainingSample] = []
    for ep_idx in indices:
        trace = load_lerobot_hf_episode(
            repo_id,
            episode_index=ep_idx,
            robot=robot,
            max_frames=max_frames_per_episode,
        )
        ep_samples = build_world_model_training_samples(
            trace,
            metadata={
                "split": "lerobot_hf_real_data",
                "source": "real_hardware",
                "repo_id": repo_id,
                "episode_index": ep_idx,
                "sim_replay_label": "not_replayed",
                "corpus_noise_config": None,
            },
        )
        samples.extend(ep_samples)
    return samples
