from __future__ import annotations

import importlib

import pytest

from backend.models.simulator_runtime import SimulatorDependencySpec
from backend.services.simulator_adapters.base import (
    build_runtime_dependency_statuses,
    format_runtime_dependency_status,
    is_python_module_available,
)


def test_is_python_module_available_returns_false_for_import_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _missing_module(_name: str) -> object:
        raise ModuleNotFoundError(name="yourdfpy")

    monkeypatch.setattr(
        importlib,
        "import_module",
        _missing_module,
    )

    assert is_python_module_available("yourdfpy") is False


def test_is_python_module_available_returns_false_for_missing_parent_package(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _missing_parent(_name: str) -> object:
        raise ModuleNotFoundError(name="mujoco")

    monkeypatch.setattr(importlib, "import_module", _missing_parent)

    assert is_python_module_available("mujoco.mjx") is False


def test_is_python_module_available_preserves_unexpected_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        importlib,
        "import_module",
        lambda _name: (_ for _ in ()).throw(ImportError("unexpected import failure")),
    )

    with pytest.raises(ImportError, match="unexpected import failure"):
        is_python_module_available("yourdfpy")


def test_is_python_module_available_preserves_missing_nested_dependency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _missing_nested_dependency(_name: str) -> object:
        raise ModuleNotFoundError(name="unexpected_nested_dependency")

    monkeypatch.setattr(importlib, "import_module", _missing_nested_dependency)

    with pytest.raises(ModuleNotFoundError) as exc_info:
        is_python_module_available("mujoco.mjx")
    assert exc_info.value.name == "unexpected_nested_dependency"


def test_build_runtime_dependency_statuses_uses_selected_python_probe(monkeypatch) -> None:
    observed: list[tuple[str, str]] = []

    def fake_is_python_module_available_in_python(
        python_executable: str,
        import_name: str,
    ) -> bool:
        observed.append((python_executable, import_name))
        return import_name == "mujoco"

    monkeypatch.setattr(
        "backend.services.simulator_adapters.base.is_python_module_available_in_python",
        fake_is_python_module_available_in_python,
    )

    statuses = build_runtime_dependency_statuses(
        (
            SimulatorDependencySpec(name="mujoco", import_name="mujoco"),
            SimulatorDependencySpec(name="mjlab", import_name="mjlab", required=False),
        ),
        python_executable="/opt/sim/bin/python",
    )

    assert observed == [
        ("/opt/sim/bin/python", "mujoco"),
        ("/opt/sim/bin/python", "mjlab"),
    ]
    assert [(status.name, status.available) for status in statuses] == [
        ("mujoco", True),
        ("mjlab", False),
    ]


def test_format_runtime_dependency_status_lists_missing_required_dependencies(monkeypatch) -> None:
    def fake_is_python_module_available(import_name: str) -> bool:
        return False

    monkeypatch.setattr(
        "backend.services.simulator_adapters.base.is_python_module_available",
        fake_is_python_module_available,
    )

    statuses = build_runtime_dependency_statuses(
        (
            SimulatorDependencySpec(name="mujoco", import_name="mujoco"),
            SimulatorDependencySpec(name="mjlab", import_name="mjlab"),
            SimulatorDependencySpec(name="warp", import_name="warp", required=False),
        ),
    )

    available, status = format_runtime_dependency_status(
        ready_status="ready",
        missing_status_prefix="Missing optional dependency",
        dependencies=statuses,
    )

    assert available is False
    assert status == "Missing optional dependency: mujoco, mjlab"
