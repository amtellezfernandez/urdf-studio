from __future__ import annotations

import numpy as np
import pytest
from fastapi import HTTPException

from backend.services.placo_kinematics import _quat_to_matrix


def test_quat_to_matrix_returns_identity_for_identity_quaternion() -> None:
    assert np.allclose(
        _quat_to_matrix([1.0, 0.0, 0.0, 0.0]),
        np.eye(3, dtype=np.float64),
    )


def test_quat_to_matrix_normalizes_input_quaternion() -> None:
    normalized_rotation = _quat_to_matrix([1.0, 0.0, 0.0, 0.0])
    scaled_rotation = _quat_to_matrix([2.0, 0.0, 0.0, 0.0])

    assert np.allclose(scaled_rotation, normalized_rotation)


def test_quat_to_matrix_returns_identity_for_zero_quaternion() -> None:
    assert np.allclose(
        _quat_to_matrix([0.0, 0.0, 0.0, 0.0]),
        np.eye(3, dtype=np.float64),
    )


def test_quat_to_matrix_rejects_invalid_length() -> None:
    with pytest.raises(HTTPException) as exc_info:
        _quat_to_matrix([1.0, 0.0, 0.0])

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "target_wxyz must have length 4 when provided"
