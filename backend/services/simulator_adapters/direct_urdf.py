from __future__ import annotations

from pathlib import Path
from typing import Callable

from backend.models.simulator_runtime import (
    SimulatorWorkspacePrepareRequest,
)
from backend.services.simulator_adapters.workspace_package import (
    PreparedSimulatorWorkspace,
    prepare_simulator_workspace_package,
)
from backend.services.simulator_adapters.params import SimulatorWorkspaceProcessParams


def _direct_urdf_workspace_root(
    workspace_process: SimulatorWorkspaceProcessParams,
) -> Path:
    return workspace_process.workspace_root


def prepare_direct_urdf_workspace(
    request: SimulatorWorkspacePrepareRequest,
    *,
    workspace_process: SimulatorWorkspaceProcessParams,
    error: Callable[[str], Exception],
) -> PreparedSimulatorWorkspace:
    return prepare_simulator_workspace_package(
        request,
        workspace_root=_direct_urdf_workspace_root(workspace_process),
        error=error,
    )
