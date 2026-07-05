from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.models.kinematics import IKDiagnostics, IKResponse, IkSolveRequest
from backend.services import ik_orchestrator


def _ik_request() -> IkSolveRequest:
    return IkSolveRequest(
        urdf="<robot name='demo'/>",
        target_link="tool",
        target_position=[0.0, 0.0, 0.0],
        target_rotation=[
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ],
        joint_values={"joint_a": 0.0},
        solver_chain=["amik"],
        orientation_mode="prefer",
        position_tolerance=0.001,
        orientation_tolerance=0.001,
    )


def _ik_response() -> IKResponse:
    return IKResponse(
        solution={"joint_a": 0.0},
        diagnostics=IKDiagnostics(
            termination_reason="solved",
            termination_flags=[True, False, False, False],
            iterations=1,
            cost=0.0,
            lambda_final=0.0,
            validity="valid",
            stability="stable",
            degeneracy="none",
            branch_maybe=False,
            branch_metric=0.0,
            branch_message="",
        ),
        metadata={},
    )


def test_solve_ik_ignores_expected_rotation_conversion_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ik_orchestrator, "amik_ik", lambda _request: _ik_response())
    monkeypatch.setattr(
        ik_orchestrator,
        "compute_link_pose",
        lambda _urdf, _solution, _target_link: ([0.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]),
    )
    monkeypatch.setattr(
        ik_orchestrator,
        "rotation_matrix_to_wxyz",
        lambda _rotation: (_ for _ in ()).throw(
            HTTPException(status_code=400, detail="bad rotation")
        ),
    )

    response = ik_orchestrator.solve_ik(_ik_request())

    assert response.solution == {"joint_a": 0.0}
    assert response.metadata["orientation_strategy"] == "ignore"


def test_solve_ik_preserves_unexpected_rotation_conversion_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ik_orchestrator, "amik_ik", lambda _request: _ik_response())
    monkeypatch.setattr(
        ik_orchestrator,
        "compute_link_pose",
        lambda _urdf, _solution, _target_link: ([0.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]),
    )
    monkeypatch.setattr(
        ik_orchestrator,
        "rotation_matrix_to_wxyz",
        lambda _rotation: (_ for _ in ()).throw(
            KeyError("unexpected rotation conversion failure")
        ),
    )

    with pytest.raises(KeyError, match="unexpected rotation conversion failure"):
        ik_orchestrator.solve_ik(_ik_request())
