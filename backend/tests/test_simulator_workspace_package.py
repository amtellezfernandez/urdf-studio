from __future__ import annotations

import pytest

from backend.models.simulator_runtime import SimulatorWorkspacePrepareRequest
from backend.models.world_scene_package import WorldArtifactRef
from backend.services.simulator_adapters.workspace_package import (
    SimulatorWorkspacePackageValidationError,
    prepare_simulator_workspace_package,
)
from backend.tests.simulator_adapter_test_utils import make_world_package


def test_prepare_simulator_workspace_rejects_mismatched_world_snapshot_digest(
    tmp_path,
) -> None:
    world_package = make_world_package("<robot name=\"demo\"><link name=\"base\"/></robot>")
    world_package.artifacts = [
        WorldArtifactRef(
            kind="world_snapshot",
            digest_sha256="0" * 64,
            uri="inline://snapshot",
        )
    ]
    request = SimulatorWorkspacePrepareRequest(world_package=world_package)

    with pytest.raises(SimulatorWorkspacePackageValidationError, match="world_snapshot"):
        prepare_simulator_workspace_package(
            request,
            workspace_root=tmp_path,
            error=ValueError,
        )

    assert list(tmp_path.iterdir()) == []
