"""Adapters from URDF Ops keypoint observations to SO100 geometry-repair tensors."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from backend.services.so100_sysid.geometry_repair import (
    So100KinematicModel,
    parse_so100_kinematic_model,
)
from backend.services.so100_sysid.params import (
    SO100_URDF_OPS_KEYPOINT_ABSOLUTE_MIN_CONFIDENCE,
    SO100_URDF_OPS_KEYPOINT_MAX_CONFIDENCE,
    SO100_URDF_OPS_KEYPOINT_MIN_CONFIDENCE,
    SO100_URDF_OPS_KEYPOINT_POSITION_DIMENSIONS,
    URDF_OPS_KEYPOINT_OBSERVATION_SCHEMA_VERSION,
)


Float3 = tuple[float, float, float]


@dataclass(frozen=True)
class So100KeypointFrameKey:
    episode_index: int
    frame_index: int
    camera_name: str | None


@dataclass(frozen=True)
class So100GeometryKeypointObservations:
    schema_version: str
    frame_keys: tuple[So100KeypointFrameKey, ...]
    frame_indices: np.ndarray
    tracked_link_indices: np.ndarray
    position_xyz_m: np.ndarray
    weights: np.ndarray
    labels: tuple[str, ...]
    link_names: tuple[str, ...]

    @property
    def observation_count(self) -> int:
        return int(self.position_xyz_m.shape[0])


@dataclass(frozen=True)
class So100DenseGeometryKeypointTargets:
    frame_keys: tuple[So100KeypointFrameKey, ...]
    tracked_link_names: tuple[str, ...]
    position_xyz_m: np.ndarray
    weights: np.ndarray


def _as_mapping(value: object, path: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{path} must be an object.")
    return value


def _as_sequence(value: object, path: str) -> Sequence[object]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        raise ValueError(f"{path} must be an array.")
    return value


def _as_non_negative_int(value: object, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{path} must be a non-negative integer.")
    return value


def _as_optional_str(value: object, path: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{path} must be a non-empty string when provided.")
    return value.strip()


def _as_float(value: object, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{path} must be numeric.")
    parsed = float(value)
    if not np.isfinite(parsed):
        raise ValueError(f"{path} must be finite.")
    return parsed


def _as_float3(value: object, path: str) -> Float3:
    coordinates = _as_sequence(value, path)
    if len(coordinates) != SO100_URDF_OPS_KEYPOINT_POSITION_DIMENSIONS:
        raise ValueError(
            f"{path} must have {SO100_URDF_OPS_KEYPOINT_POSITION_DIMENSIONS} numeric values."
        )
    return (
        _as_float(coordinates[0], f"{path}[0]"),
        _as_float(coordinates[1], f"{path}[1]"),
        _as_float(coordinates[2], f"{path}[2]"),
    )


def _frame_key_from_observation(observation: Mapping[str, Any], path: str) -> So100KeypointFrameKey:
    return So100KeypointFrameKey(
        episode_index=_as_non_negative_int(
            observation.get("episode_index"),
            f"{path}.episode_index",
        ),
        frame_index=_as_non_negative_int(observation.get("frame_index"), f"{path}.frame_index"),
        camera_name=_as_optional_str(observation.get("camera_name"), f"{path}.camera_name"),
    )


def _as_confidence(value: object, path: str) -> float:
    confidence = _as_float(value, path)
    if not (
        SO100_URDF_OPS_KEYPOINT_ABSOLUTE_MIN_CONFIDENCE
        <= confidence
        <= SO100_URDF_OPS_KEYPOINT_MAX_CONFIDENCE
    ):
        raise ValueError(
            f"{path} must be between {SO100_URDF_OPS_KEYPOINT_ABSOLUTE_MIN_CONFIDENCE} "
            f"and {SO100_URDF_OPS_KEYPOINT_MAX_CONFIDENCE}."
        )
    return confidence


def build_so100_geometry_keypoint_observations(
    payload: Mapping[str, Any],
    *,
    model: So100KinematicModel | None = None,
    min_confidence: float = SO100_URDF_OPS_KEYPOINT_MIN_CONFIDENCE,
) -> So100GeometryKeypointObservations:
    """Convert URDF Ops keypoint observations into sparse SO100 target tensors."""

    if payload.get("schema_version") != URDF_OPS_KEYPOINT_OBSERVATION_SCHEMA_VERSION:
        raise ValueError(
            "Unsupported keypoint observation schema_version: "
            f"{payload.get('schema_version')!r}. Expected {URDF_OPS_KEYPOINT_OBSERVATION_SCHEMA_VERSION!r}."
        )
    confidence_floor = _as_confidence(min_confidence, "min_confidence")
    kinematic_model = model or parse_so100_kinematic_model()
    tracked_link_index_by_name = {
        link_name: link_index for link_index, link_name in enumerate(kinematic_model.tracked_link_names)
    }

    frame_key_to_index: dict[So100KeypointFrameKey, int] = {}
    frame_keys: list[So100KeypointFrameKey] = []
    frame_indices: list[int] = []
    tracked_link_indices: list[int] = []
    position_rows: list[Float3] = []
    weights: list[float] = []
    labels: list[str] = []
    link_names: list[str] = []

    observations = _as_sequence(payload.get("observations"), "observations")
    for observation_index, raw_observation in enumerate(observations):
        observation_path = f"observations[{observation_index}]"
        observation = _as_mapping(raw_observation, observation_path)
        frame_key = _frame_key_from_observation(observation, observation_path)
        frame_index = frame_key_to_index.get(frame_key)
        if frame_index is None:
            frame_index = len(frame_keys)
            frame_key_to_index[frame_key] = frame_index
            frame_keys.append(frame_key)

        keypoints = _as_sequence(observation.get("keypoints"), f"{observation_path}.keypoints")
        for keypoint_index, raw_keypoint in enumerate(keypoints):
            keypoint_path = f"{observation_path}.keypoints[{keypoint_index}]"
            keypoint = _as_mapping(raw_keypoint, keypoint_path)
            confidence = _as_confidence(keypoint.get("confidence"), f"{keypoint_path}.confidence")
            if confidence < confidence_floor:
                continue
            position_value = keypoint.get("position_xyz_m")
            link_name = _as_optional_str(keypoint.get("link_name"), f"{keypoint_path}.link_name")
            if position_value is None or link_name is None:
                continue
            tracked_link_index = tracked_link_index_by_name.get(link_name)
            if tracked_link_index is None:
                raise ValueError(f"{keypoint_path}.link_name references unknown SO100 link {link_name!r}.")

            label = _as_optional_str(keypoint.get("label"), f"{keypoint_path}.label")
            if label is None:
                raise ValueError(f"{keypoint_path}.label is required.")
            frame_indices.append(frame_index)
            tracked_link_indices.append(tracked_link_index)
            position_rows.append(_as_float3(position_value, f"{keypoint_path}.position_xyz_m"))
            weights.append(confidence)
            labels.append(label)
            link_names.append(link_name)

    if not position_rows:
        raise ValueError("URDF Ops keypoint payload did not contain usable SO100 link-space keypoints.")

    return So100GeometryKeypointObservations(
        schema_version=URDF_OPS_KEYPOINT_OBSERVATION_SCHEMA_VERSION,
        frame_keys=tuple(frame_keys),
        frame_indices=np.asarray(frame_indices, dtype=np.int32),
        tracked_link_indices=np.asarray(tracked_link_indices, dtype=np.int32),
        position_xyz_m=np.asarray(position_rows, dtype=np.float32),
        weights=np.asarray(weights, dtype=np.float32),
        labels=tuple(labels),
        link_names=tuple(link_names),
    )


def build_dense_so100_keypoint_targets(
    observations: So100GeometryKeypointObservations,
    *,
    model: So100KinematicModel | None = None,
) -> So100DenseGeometryKeypointTargets:
    """Build frame-by-link target tensors for differentiable geometry losses."""

    kinematic_model = model or parse_so100_kinematic_model()
    frame_count = len(observations.frame_keys)
    link_count = len(kinematic_model.tracked_link_names)
    weighted_positions = np.zeros(
        (frame_count, link_count, SO100_URDF_OPS_KEYPOINT_POSITION_DIMENSIONS),
        dtype=np.float32,
    )
    weights = np.zeros((frame_count, link_count), dtype=np.float32)

    for row_index, position_xyz_m in enumerate(observations.position_xyz_m):
        frame_index = int(observations.frame_indices[row_index])
        link_index = int(observations.tracked_link_indices[row_index])
        weight = float(observations.weights[row_index])
        weighted_positions[frame_index, link_index] += position_xyz_m * weight
        weights[frame_index, link_index] += weight

    nonzero_weights = weights > 0.0
    positions = np.zeros_like(weighted_positions)
    positions[nonzero_weights] = (
        weighted_positions[nonzero_weights] / weights[nonzero_weights][:, None]
    )
    return So100DenseGeometryKeypointTargets(
        frame_keys=observations.frame_keys,
        tracked_link_names=kinematic_model.tracked_link_names,
        position_xyz_m=positions,
        weights=weights,
    )
