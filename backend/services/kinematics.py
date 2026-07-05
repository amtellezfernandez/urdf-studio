from __future__ import annotations

import hashlib
import tempfile
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Sequence

import numpy as np
from fastapi import HTTPException

from backend.models.kinematics import (
    FKLink,
    FKRequest,
    FKResponse,
    JointValueMap,
    KinematicsMetadata,
    QuaternionWxyz,
    Vector3,
)
from backend.services.ilu_urdf import strip_urdf_for_kinematics
from backend.services.yourdfpy_loader import load_yourdfpy_urdf_loader

if TYPE_CHECKING:
    import yourdfpy


@dataclass
class KinematicsEntry:
    urdf_hash: str
    urdf_xml: str
    urdf: yourdfpy.URDF


_KINEMATICS_CACHE: dict[str, KinematicsEntry] = {}


def _hash_urdf(urdf_xml: str) -> str:
    return hashlib.sha256(urdf_xml.encode("utf-8")).hexdigest()


def _load_urdf_from_xml(urdf_xml: str) -> yourdfpy.URDF:
    with tempfile.NamedTemporaryFile("w", suffix=".urdf", delete=False) as urdf_file:
        urdf_file.write(urdf_xml)
        temporary_urdf_path = urdf_file.name
    try:
        load_urdf = load_yourdfpy_urdf_loader()
        loaded_urdf = load_urdf(temporary_urdf_path)
    finally:
        with suppress(OSError):
            Path(temporary_urdf_path).unlink(missing_ok=True)
    return loaded_urdf


def _get_or_create_entry(urdf_xml: str) -> KinematicsEntry:
    if not urdf_xml.strip():
        raise HTTPException(status_code=400, detail="URDF content is empty")
    sanitized_urdf = strip_urdf_for_kinematics(urdf_xml)
    urdf_hash = _hash_urdf(sanitized_urdf)
    cached_entry = _KINEMATICS_CACHE.get(urdf_hash)
    if cached_entry is not None:
        return cached_entry
    try:
        robot_model = _load_urdf_from_xml(sanitized_urdf)
    except (ValueError, OSError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail=f"Failed to load URDF: {exc}") from exc
    entry = KinematicsEntry(
        urdf_hash=urdf_hash,
        urdf_xml=sanitized_urdf,
        urdf=robot_model,
    )
    _KINEMATICS_CACHE[urdf_hash] = entry
    return entry


def _build_actuated_joint_values(
    robot_model: yourdfpy.URDF, requested_joint_values: JointValueMap
) -> JointValueMap:
    return {
        joint_name: float(requested_joint_values.get(joint_name, 0.0))
        for joint_name in robot_model.actuated_joint_names
    }


def _quaternion_from_rotation_matrix(rotation: np.ndarray) -> QuaternionWxyz:
    trace = float(rotation[0, 0] + rotation[1, 1] + rotation[2, 2])
    if trace > 0.0:
        scale = np.sqrt(trace + 1.0) * 2.0
        w = 0.25 * scale
        x = (rotation[2, 1] - rotation[1, 2]) / scale
        y = (rotation[0, 2] - rotation[2, 0]) / scale
        z = (rotation[1, 0] - rotation[0, 1]) / scale
    elif rotation[0, 0] > rotation[1, 1] and rotation[0, 0] > rotation[2, 2]:
        scale = np.sqrt(1.0 + rotation[0, 0] - rotation[1, 1] - rotation[2, 2]) * 2.0
        w = (rotation[2, 1] - rotation[1, 2]) / scale
        x = 0.25 * scale
        y = (rotation[0, 1] + rotation[1, 0]) / scale
        z = (rotation[0, 2] + rotation[2, 0]) / scale
    elif rotation[1, 1] > rotation[2, 2]:
        scale = np.sqrt(1.0 + rotation[1, 1] - rotation[0, 0] - rotation[2, 2]) * 2.0
        w = (rotation[0, 2] - rotation[2, 0]) / scale
        x = (rotation[0, 1] + rotation[1, 0]) / scale
        y = 0.25 * scale
        z = (rotation[1, 2] + rotation[2, 1]) / scale
    else:
        scale = np.sqrt(1.0 + rotation[2, 2] - rotation[0, 0] - rotation[1, 1]) * 2.0
        w = (rotation[1, 0] - rotation[0, 1]) / scale
        x = (rotation[0, 2] + rotation[2, 0]) / scale
        y = (rotation[1, 2] + rotation[2, 1]) / scale
        z = 0.25 * scale

    quaternion = np.array([w, x, y, z], dtype=np.float64)
    norm = float(np.linalg.norm(quaternion))
    if not np.isfinite(norm) or norm <= 0.0:
        return [1.0, 0.0, 0.0, 0.0]
    quaternion /= norm
    return [float(component) for component in quaternion]


def rotation_matrix_to_wxyz(rotation: Sequence[Sequence[float]]) -> QuaternionWxyz:
    rotation_matrix = np.asarray(rotation, dtype=np.float64)
    if rotation_matrix.shape != (3, 3):
        raise HTTPException(
            status_code=400,
            detail="target_rotation must be a 3x3 matrix",
        )
    return _quaternion_from_rotation_matrix(rotation_matrix)


def compute_link_pose(
    urdf_xml: str, joint_values: JointValueMap, target_link: str
) -> tuple[Vector3, QuaternionWxyz]:
    entry = _get_or_create_entry(urdf_xml)
    robot_model = entry.urdf
    if target_link not in robot_model.link_map:
        raise HTTPException(
            status_code=400,
            detail=f"Target link '{target_link}' not found in URDF.",
        )

    try:
        robot_model.update_cfg(_build_actuated_joint_values(robot_model, joint_values))
        transform = np.asarray(
            robot_model.get_transform(target_link),
            dtype=np.float64,
        )
    except (TypeError, ValueError, RuntimeError) as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Forward kinematics failed: {exc}",
        ) from exc

    position = [float(value) for value in transform[:3, 3]]
    quaternion = _quaternion_from_rotation_matrix(transform[:3, :3])
    return position, quaternion


def forward_kinematics(fk_request: FKRequest) -> FKResponse:
    entry = _get_or_create_entry(fk_request.urdf)
    robot_model = entry.urdf

    try:
        robot_model.update_cfg(
            _build_actuated_joint_values(robot_model, fk_request.joint_values)
        )
    except (TypeError, ValueError, RuntimeError) as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Forward kinematics failed: {exc}",
        ) from exc

    links: list[FKLink] = []
    for link_name in robot_model.link_map.keys():
        try:
            transform = np.asarray(
                robot_model.get_transform(link_name),
                dtype=np.float64,
            )
        except (TypeError, ValueError, RuntimeError) as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Forward kinematics failed for link '{link_name}': {exc}",
            ) from exc
        links.append(
            FKLink(
                name=link_name,
                position=[float(value) for value in transform[:3, 3]],
                quaternion_wxyz=_quaternion_from_rotation_matrix(transform[:3, :3]),
            )
        )

    metadata: KinematicsMetadata = {
        "urdf_hash": entry.urdf_hash,
        "actuated_joint_names": list(robot_model.actuated_joint_names),
        "all_link_names": list(robot_model.link_map.keys()),
    }
    return FKResponse(links=links, metadata=metadata)
