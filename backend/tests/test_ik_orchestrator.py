from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.models.kinematics import IKDiagnostics, IKResponse, IkSolveRequest
from backend.services import ik_orchestrator


def _ik_response() -> IKResponse:
    return IKResponse(
        solution={"joint_a": 0.0},
        diagnostics=IKDiagnostics(
            termination_reason="ok",
            termination_flags=[True],
            iterations=1,
            cost=0.0,
            lambda_final=0.0,
            validity="valid",
            stability="stable",
            degeneracy="none",
            branch_maybe=False,
            branch_metric=0.0,
            branch_message="ok",
        ),
        metadata={},
    )


def _patch_solver_context(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ik_orchestrator,
        "compile_ik_request",
        lambda _request: IkSolveRequest(
            urdf="<robot name='demo'/>",
            target_link="tool0",
            target_position=[0.0, 0.0, 0.0],
            target_rotation=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            joint_values={"joint_a": 0.0},
            position_tolerance=0.01,
            orientation_tolerance=0.01,
        ),
    )
    monkeypatch.setattr(
        ik_orchestrator,
        "get_ik_config",
        lambda: type(
            "Config",
            (),
            {
                "tolerances": type(
                    "Tolerances",
                    (),
                    {"position_tolerance": 0.01, "orientation_tolerance": 0.01},
                )()
            },
        )(),
    )
    monkeypatch.setattr(
        ik_orchestrator,
        "get_solver_tuning",
        lambda _solver_id: type("Tuning", (), {"orientation_weight": 1.0})(),
    )
    monkeypatch.setattr(
        ik_orchestrator,
        "build_orientation_attempts",
        lambda _mode, _has_orientation: [(False, 1.0, "strict")],
    )
    monkeypatch.setattr(
        ik_orchestrator,
        "build_seed_list",
        lambda _joint_values, _cached_solution: [("current", {})],
    )
    monkeypatch.setattr(
        ik_orchestrator,
        "compute_link_pose",
        lambda _urdf, _solution, _target_link: ([0.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]),
    )
    monkeypatch.setattr(
        ik_orchestrator,
        "amik_ik",
        lambda _request: _ik_response(),
    )
    monkeypatch.setattr(ik_orchestrator, "placo_inverse_kinematics", lambda _request: _ik_response())


def test_solve_ik_ignores_expected_rotation_matrix_conversion_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_solver_context(monkeypatch)
    monkeypatch.setattr(
        ik_orchestrator,
        "rotation_matrix_to_wxyz",
        lambda _rotation: (_ for _ in ()).throw(
            HTTPException(status_code=400, detail="target_rotation must be a 3x3 matrix")
        ),
    )

    response = ik_orchestrator.solve_ik(
        IkSolveRequest(
            urdf="<robot name='demo'/>",
            target_link="tool0",
            target_position=[0.0, 0.0, 0.0],
            target_rotation=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            solver_chain=["amik"],
            orientation_mode="required",
        )
    )

    assert response.solution == {"joint_a": 0.0}
    assert response.metadata["solver_id"] == "amik"
    assert response.metadata["orientation_strategy"] == "strict"


def test_solve_ik_propagates_unexpected_rotation_matrix_conversion_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_solver_context(monkeypatch)
    monkeypatch.setattr(
        ik_orchestrator,
        "rotation_matrix_to_wxyz",
        lambda _rotation: (_ for _ in ()).throw(RuntimeError("unexpected quaternion failure")),
    )

    with pytest.raises(RuntimeError, match="unexpected quaternion failure"):
        ik_orchestrator.solve_ik(
            IkSolveRequest(
                urdf="<robot name='demo'/>",
                target_link="tool0",
                target_position=[0.0, 0.0, 0.0],
                target_rotation=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
                solver_chain=["amik"],
                orientation_mode="required",
            )
        )
