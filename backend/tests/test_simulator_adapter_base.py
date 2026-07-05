from __future__ import annotations

from backend.models.simulator_runtime import SimulatorDependencySpec
from backend.services.simulator_adapters.base import (
    build_runtime_dependency_statuses,
    format_runtime_dependency_status,
)


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
