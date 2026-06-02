from __future__ import annotations

import hashlib
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
from fastapi import HTTPException

import yourdfpy  # type: ignore

from backend.models.kinematics import FKLink, FKRequest, FKResponse
from backend.services.ilu_urdf import strip_urdf_for_kinematics


@dataclass
class KinematicsEntry:
    urdf_hash: str
    urdf_xml: str
    urdf: yourdfpy.URDF


_KINEMATICS_CACHE: Dict[str, KinematicsEntry] = {}


def _hash_urdf(urdf_xml: str) -> str:
    return hashlib.sha256(urdf_xml.encode("utf-8")).hexdigest()


def _load_urdf_from_xml(urdf_xml: str) -> yourdfpy.URDF:
    with tempfile.NamedTemporaryFile("w", suffix=".urdf", delete=False) as tmp:
        tmp.write(urdf_xml)
        tmp_path = tmp.name
    try:
        urdf = yourdfpy.URDF.load(tmp_path)  # type: ignore[attr-defined]
    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except OSError:
            pass
    return urdf


def _get_or_create_entry(urdf_xml: str) -> KinematicsEntry:
    if not urdf_xml.strip():
        raise HTTPException(status_code=400, detail="URDF content is empty")
    sanitized_urdf = strip_urdf_for_kinematics(urdf_xml)
    urdf_hash = _hash_urdf(sanitized_urdf)
    entry = _KINEMATICS_CACHE.get(urdf_hash)
    if entry is not None:
        return entry
    try:
        urdf = _load_urdf_from_xml(sanitized_urdf)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to load URDF: {exc}") from exc
    entry = KinematicsEntry(urdf_hash=urdf_hash, urdf_xml=sanitized_urdf, urdf=urdf)
    _KINEMATICS_CACHE[urdf_hash] = entry
    return entry


def _build_joint_values(
    urdf: yourdfpy.URDF, joint_values: Dict[str, float]
) -> Dict[str, float]:
    return {
        name: float(joint_values.get(name, 0.0))
        for name in urdf.actuated_joint_names
    }


def _quaternion_from_rotation_matrix(rotation: np.ndarray) -> List[float]:
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
    return [float(value) for value in quaternion]


def rotation_matrix_to_wxyz(rotation: List[List[float]]) -> List[float]:
    rotation_matrix = np.asarray(rotation, dtype=np.float64)
    if rotation_matrix.shape != (3, 3):
      raise HTTPException(status_code=400, detail="target_rotation must be a 3x3 matrix")
    return _quaternion_from_rotation_matrix(rotation_matrix)


def compute_link_pose(
    urdf_xml: str, joint_values: Dict[str, float], target_link: str
) -> Tuple[List[float], List[float]]:
    entry = _get_or_create_entry(urdf_xml)
    urdf = entry.urdf
    if target_link not in urdf.link_map:
        raise HTTPException(
            status_code=400,
            detail=f"Target link '{target_link}' not found in URDF.",
        )

    try:
        urdf.update_cfg(_build_joint_values(urdf, joint_values))
        transform = np.asarray(urdf.get_transform(target_link), dtype=np.float64)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Forward kinematics failed: {exc}") from exc

    position = [float(value) for value in transform[:3, 3]]
    quaternion = _quaternion_from_rotation_matrix(transform[:3, :3])
    return position, quaternion


def forward_kinematics(req: FKRequest) -> FKResponse:
    entry = _get_or_create_entry(req.urdf)
    urdf = entry.urdf

    try:
        urdf.update_cfg(_build_joint_values(urdf, req.joint_values))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Forward kinematics failed: {exc}") from exc

    links: List[FKLink] = []
    for name in urdf.link_map.keys():
        try:
            transform = np.asarray(urdf.get_transform(name), dtype=np.float64)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Forward kinematics failed for link '{name}': {exc}",
            ) from exc
        links.append(
            FKLink(
                name=name,
                position=[float(value) for value in transform[:3, 3]],
                quaternion_wxyz=_quaternion_from_rotation_matrix(transform[:3, :3]),
            )
        )

    metadata: Dict[str, Any] = {
        "urdf_hash": entry.urdf_hash,
        "actuated_joint_names": list(urdf.actuated_joint_names),
        "all_link_names": list(urdf.link_map.keys()),
    }
    return FKResponse(links=links, metadata=metadata)
