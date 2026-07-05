from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from backend.services.simulator_adapters.direct_urdf import (
    prepare_direct_urdf_workspace,
)
from backend.services.simulator_adapters.params import PYBULLET_WORKSPACE_PROCESS_PARAMS
from backend.tests.simulator_adapter_test_utils import make_workspace_prepare_request


def test_prepare_direct_urdf_workspace_uses_process_workspace_root(
    monkeypatch,
    tmp_path: Path,
) -> None:
    observed: dict[str, object] = {}
    request = make_workspace_prepare_request("<robot name='demo'><link name='base'/></robot>")
    expected_prepared = object()

    def fake_prepare_simulator_workspace_package(
        passed_request,
        *,
        workspace_root: Path,
        error,
    ):
        observed["request"] = passed_request
        observed["workspace_root"] = workspace_root
        observed["error"] = error
        return expected_prepared

    monkeypatch.setattr(
        "backend.services.simulator_adapters.direct_urdf.prepare_simulator_workspace_package",
        fake_prepare_simulator_workspace_package,
    )

    prepared = prepare_direct_urdf_workspace(
        request,
        workspace_process=replace(
            PYBULLET_WORKSPACE_PROCESS_PARAMS,
            workspace_root=tmp_path / "pybullet-workspaces",
        ),
        error=ValueError,
    )

    assert prepared is expected_prepared
    assert observed["request"] is request
    assert observed["workspace_root"] == tmp_path / "pybullet-workspaces"
    assert observed["error"] is ValueError
