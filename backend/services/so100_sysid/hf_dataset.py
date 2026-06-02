from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from backend.services.so100_sysid.params import (
    SO100_EXPECTED_JOINT_COUNT,
    SO100_HF_DATASET_REPO_ID,
    SO100_HF_DEFAULT_FPS,
    SO100_HF_FIRST_PARQUET_PATH,
    SO100_HF_INFO_PATH,
    SO100_HF_JOINT_NAMES,
    SO100_HF_MIN_TRAJECTORY_ROWS,
    SO100_JOINT_NAMES,
    SO100_ROBOT_TYPE,
)


@dataclass(frozen=True)
class So100HfDatasetMetadata:
    robot_type: str
    fps: float
    action_names: tuple[str, ...]
    state_names: tuple[str, ...]


@dataclass(frozen=True)
class So100HfTrajectory:
    action: np.ndarray
    observation_state: np.ndarray
    timestamp: np.ndarray
    frame_index: np.ndarray
    joint_names: tuple[str, ...]
    hf_joint_names: tuple[str, ...]
    fps: float

    @property
    def transition_action(self) -> np.ndarray:
        return self.action[:-1]

    @property
    def transition_qpos(self) -> np.ndarray:
        return self.observation_state[:-1]

    @property
    def transition_next_qpos(self) -> np.ndarray:
        return self.observation_state[1:]


def _as_mapping(value: Any) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise TypeError("Expected a mapping.")
    return value


def _feature_names(info: Mapping[str, Any], feature_name: str) -> tuple[str, ...]:
    features = _as_mapping(info.get("features"))
    feature = _as_mapping(features.get(feature_name))
    names = feature.get("names")
    if not isinstance(names, Sequence) or isinstance(names, str):
        raise ValueError(f"HF feature '{feature_name}' does not expose joint names.")
    return tuple(str(name) for name in names)


def _feature_fps(info: Mapping[str, Any], feature_name: str) -> float:
    features = _as_mapping(info.get("features"))
    feature = _as_mapping(features.get(feature_name))
    raw_fps = feature.get("fps", info.get("fps", SO100_HF_DEFAULT_FPS))
    fps = float(raw_fps)
    if fps <= 0:
        raise ValueError(f"HF feature '{feature_name}' exposes a non-positive fps: {raw_fps}.")
    return fps


def parse_so100_hf_dataset_metadata(info: Mapping[str, Any]) -> So100HfDatasetMetadata:
    robot_type = str(info.get("robot_type", "")).strip()
    if robot_type != SO100_ROBOT_TYPE:
        raise ValueError(f"Expected HF robot_type '{SO100_ROBOT_TYPE}', got '{robot_type}'.")

    action_names = _feature_names(info, "action")
    state_names = _feature_names(info, "observation.state")
    if action_names != SO100_HF_JOINT_NAMES:
        raise ValueError(f"Unexpected SO100 action names: {action_names}.")
    if state_names != SO100_HF_JOINT_NAMES:
        raise ValueError(f"Unexpected SO100 observation.state names: {state_names}.")

    return So100HfDatasetMetadata(
        robot_type=robot_type,
        fps=_feature_fps(info, "action"),
        action_names=action_names,
        state_names=state_names,
    )


def _read_row_field(row: Mapping[str, Any], dotted_key: str) -> Any:
    if dotted_key in row:
        return row[dotted_key]
    current: Any = row
    for part in dotted_key.split("."):
        if not isinstance(current, Mapping) or part not in current:
            raise KeyError(f"Missing row field '{dotted_key}'.")
        current = current[part]
    return current


def _as_joint_vector(value: Any, field_name: str) -> np.ndarray:
    vector = np.asarray(value, dtype=np.float32)
    if vector.shape != (SO100_EXPECTED_JOINT_COUNT,):
        raise ValueError(
            f"Expected '{field_name}' shape {(SO100_EXPECTED_JOINT_COUNT,)}, got {tuple(vector.shape)}."
        )
    if not np.isfinite(vector).all():
        raise ValueError(f"Field '{field_name}' contains non-finite values.")
    return vector


def _as_scalar(value: Any, field_name: str) -> float:
    scalar = float(np.asarray(value).reshape(()))
    if not np.isfinite(scalar):
        raise ValueError(f"Field '{field_name}' contains a non-finite value.")
    return scalar


def _collect_rows(rows: Iterable[Mapping[str, Any]], max_rows: int | None) -> list[Mapping[str, Any]]:
    collected: list[Mapping[str, Any]] = []
    for row in rows:
        collected.append(row)
        if max_rows is not None and len(collected) >= max_rows:
            break
    if len(collected) < SO100_HF_MIN_TRAJECTORY_ROWS:
        raise ValueError(
            f"Need at least {SO100_HF_MIN_TRAJECTORY_ROWS} SO100 rows, got {len(collected)}."
        )
    return collected


def build_so100_hf_trajectory_from_rows(
    rows: Iterable[Mapping[str, Any]],
    *,
    fps: float = SO100_HF_DEFAULT_FPS,
    max_rows: int | None = None,
) -> So100HfTrajectory:
    collected = _collect_rows(rows, max_rows)

    action = np.stack([_as_joint_vector(_read_row_field(row, "action"), "action") for row in collected])
    observation_state = np.stack(
        [
            _as_joint_vector(_read_row_field(row, "observation.state"), "observation.state")
            for row in collected
        ]
    )
    timestamp = np.asarray(
        [_as_scalar(_read_row_field(row, "timestamp"), "timestamp") for row in collected],
        dtype=np.float32,
    )
    frame_index = np.asarray(
        [_as_scalar(_read_row_field(row, "frame_index"), "frame_index") for row in collected],
        dtype=np.int64,
    )

    if np.any(np.diff(timestamp) < 0):
        raise ValueError("SO100 HF timestamps must be monotonic.")
    if np.any(np.diff(frame_index) < 0):
        raise ValueError("SO100 HF frame indices must be monotonic.")

    resolved_fps = float(fps)
    if resolved_fps <= 0:
        raise ValueError(f"SO100 HF fps must be positive, got {fps}.")

    return So100HfTrajectory(
        action=action,
        observation_state=observation_state,
        timestamp=timestamp,
        frame_index=frame_index,
        joint_names=SO100_JOINT_NAMES,
        hf_joint_names=SO100_HF_JOINT_NAMES,
        fps=resolved_fps,
    )


def load_so100_hf_trajectory_from_parquet(
    parquet_path: Path,
    *,
    metadata: So100HfDatasetMetadata | None = None,
    max_rows: int | None = None,
) -> So100HfTrajectory:
    import pyarrow.parquet as pq

    table = pq.read_table(parquet_path)
    if max_rows is not None:
        table = table.slice(0, max_rows)
    fps = metadata.fps if metadata is not None else SO100_HF_DEFAULT_FPS
    return build_so100_hf_trajectory_from_rows(table.to_pylist(), fps=fps)


def load_so100_hf_trajectory_from_hub(
    *,
    repo_id: str = SO100_HF_DATASET_REPO_ID,
    parquet_path: str = SO100_HF_FIRST_PARQUET_PATH,
    info_path: str = SO100_HF_INFO_PATH,
    max_rows: int | None = None,
) -> So100HfTrajectory:
    from huggingface_hub import hf_hub_download

    info_file = Path(hf_hub_download(repo_id=repo_id, repo_type="dataset", filename=info_path))
    parquet_file = Path(hf_hub_download(repo_id=repo_id, repo_type="dataset", filename=parquet_path))
    metadata = parse_so100_hf_dataset_metadata(json.loads(info_file.read_text(encoding="utf-8")))
    return load_so100_hf_trajectory_from_parquet(parquet_file, metadata=metadata, max_rows=max_rows)
