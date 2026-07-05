from __future__ import annotations

import importlib
from types import SimpleNamespace

import pytest

from backend.models.ik_solvers import IkSolverInfo
from backend.services import ik_registry


def test_solver_info_list_defaults_are_independent() -> None:
    first_solver = IkSolverInfo(id="first", label="First")
    second_solver = IkSolverInfo(id="second", label="Second")

    first_solver.capabilities.append("Pose")
    first_solver.requirements.append("Backend")

    assert second_solver.capabilities == []
    assert second_solver.requirements == []


def test_available_solvers_exclude_placo_when_runtime_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ik_registry, "_placo_available", lambda: False)

    assert [solver.id for solver in ik_registry.list_available_solvers()] == ["amik"]
    assert ik_registry.default_solver_chain() == ["amik"]


def test_available_solvers_keep_registry_order_when_placo_is_available(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ik_registry, "_placo_available", lambda: True)

    assert [solver.id for solver in ik_registry.list_available_solvers()] == [
        "placo",
        "amik",
    ]
    assert ik_registry.default_solver_chain() == ["placo", "amik"]


def test_placo_available_rejects_incomplete_module(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _fake_import_module(name: str) -> object:
        if name == "placo":
            return SimpleNamespace(RobotWrapper=None, KinematicsSolver=object)
        raise ImportError(name)

    monkeypatch.setattr(importlib, "import_module", _fake_import_module)

    assert ik_registry._placo_available() is False
