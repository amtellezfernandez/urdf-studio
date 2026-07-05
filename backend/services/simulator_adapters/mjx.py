from __future__ import annotations

import json
import os
from pathlib import Path

from backend.core.paths import BASE_DIR
from backend.models.simulator_runtime import (
    SIMULATOR_MJX_ID,
    SimulatorDependencySpec,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
)
from backend.services.simulator_adapters.base import SimulatorAdapterError
from backend.services.simulator_adapters.plugin import SimulatorPlugin
from backend.services.simulator_adapters.mujoco import prepare_mujoco_workspace

_MJX_WORKSPACE_ROOT = BASE_DIR / ".cache" / "simulator-workspaces" / "mjx"
_MJX_INSPECTION_STEPS = 20


class MjxWorkspaceError(SimulatorAdapterError):
    pass


def _build_mjx_workspace_report(
    *,
    simulator_id: str,
    label: str,
    prepared,
    episode,
) -> dict[str, object]:
    return {
        "simulator": {"id": simulator_id, "label": label},
        "world_package_path": str(prepared.shared_workspace.world_package_path),
        "robot_urdf_path": str(prepared.shared_workspace.robot_urdf_path),
        "robot_mjcf_path": str(prepared.mjcf_path),
        "world_object_count": prepared.shared_workspace.world_object_count,
        "camera_count": prepared.shared_workspace.camera_count,
        "rollout": {
            "steps": _MJX_INSPECTION_STEPS,
            "diverged": episode.diverged,
            "wall_time_ms": episode.wall_time_ms,
            "frame_count": len(episode.trace.frames),
        },
    }


def _build_mjx_workspace_response(*, simulator_id: str, prepared) -> SimulatorWorkspacePrepareResponse:
    return SimulatorWorkspacePrepareResponse(
        simulator_id=simulator_id,
        started=False,
        pid=os.getpid(),
        command=[],
        launch_mode="headless_check",
        log_path=None,
        world_package_path=str(prepared.shared_workspace.world_package_path),
        robot_urdf_path=str(prepared.shared_workspace.robot_urdf_path),
        simulator_asset_path=None,
        simulator_asset_format=None,
        bundled_mesh_count=prepared.shared_workspace.bundle_result.copied_files,
        unresolved_mesh_refs=list(prepared.shared_workspace.bundle_result.unresolved),
        workspace_warnings=[
            f"MJX runs a {_MJX_INSPECTION_STEPS}-step in-process inspection rollout; "
            "use backend.services.mjx_rollout_runner.run_mjx_rollout_batch directly "
            "for batch synthetic-data generation."
        ],
        world_object_count=prepared.shared_workspace.world_object_count,
        camera_count=prepared.shared_workspace.camera_count,
    )


class MjxPlugin(SimulatorPlugin):
    simulator_id = SIMULATOR_MJX_ID
    label = "MJX"
    robot_asset_format = "mjx_mjcf"
    transfer_strategy = "convert"
    workspace_target = True
    dependencies = (
        SimulatorDependencySpec(name="mujoco", import_name="mujoco"),
        SimulatorDependencySpec(name="jax", import_name="jax"),
        SimulatorDependencySpec(name="mujoco_mjx", import_name="mujoco.mjx"),
    )

    def prepare_workspace(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> SimulatorWorkspacePrepareResponse:
        from backend.services.mjx_rollout_runner import MjxRolloutBatchConfig, run_mjx_rollout_batch

        prepared = prepare_mujoco_workspace(
            request,
            simulator_id=SIMULATOR_MJX_ID,
            workspace_root=_MJX_WORKSPACE_ROOT,
        )

        report_path = prepared.shared_workspace.workspace_dir / "artifacts" / "report.json"
        try:
            config = MjxRolloutBatchConfig(
                model_xml_path=prepared.mjcf_path,
                episode_count=1,
                steps_per_episode=_MJX_INSPECTION_STEPS,
            )
            episode = run_mjx_rollout_batch(config)[0]
        except Exception as exc:
            raise MjxWorkspaceError(f"MJX inspection rollout failed: {exc}") from exc

        report = _build_mjx_workspace_report(
            simulator_id=self.simulator_id,
            label=self.label,
            prepared=prepared,
            episode=episode,
        )
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(f"{json.dumps(report, indent=2, sort_keys=True)}\n", encoding="utf-8")

        return _build_mjx_workspace_response(
            simulator_id=self.simulator_id,
            prepared=prepared,
        )
