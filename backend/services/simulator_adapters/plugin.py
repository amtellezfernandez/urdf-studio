from __future__ import annotations

import os
from typing import TYPE_CHECKING

from backend.models.simulator_runtime import (
    SIMULATOR_CANONICAL_FRAME_CONVENTION,
    SimulatorAssetFormat,
    SimulatorDependencySpec,
    SimulatorId,
    SimulatorRuntimeCapabilities,
    SimulatorRuntimeDependency,
    SimulatorRuntimeDescriptor,
    SimulatorRuntimeSpec,
    SimulatorRuntimeStatus,
    SimulatorRuntimeTransferPolicy,
    SimulatorTargetKind,
    SimulatorTransferSpec,
    SimulatorTransferStrategy,
    SimulatorWorkspacePrepareRequest,
    SimulatorWorkspacePrepareResponse,
)
from backend.services.simulator_adapters.base import (
    SimulatorAdapterError,
    SimulatorCapabilityError,
    build_runtime_dependency_statuses,
    format_runtime_dependency_status,
)
from backend.services.simulator_adapters.params import SimulatorWorkspaceProcessParams
from backend.services.simulator_adapters.workspace_check_spec import (
    PreparedWorkspaceCommand,
    WorkspaceTarget,
)

if TYPE_CHECKING:
    from backend.services.simulator_adapters.workspace_expectations import WorkspaceExpectations

_REGISTRY: dict[SimulatorId, SimulatorPlugin] = {}


class SimulatorPlugin:
    _abstract: bool = True

    # Required class attributes (validated at subclass definition time)
    simulator_id: SimulatorId
    label: str
    robot_asset_format: SimulatorAssetFormat
    transfer_strategy: SimulatorTransferStrategy

    # Optional class attributes with defaults
    target_kind: SimulatorTargetKind = "physics_simulator"
    workspace_target: bool = False
    motion_validation: bool = False
    layout_round_trip: bool = False
    dependencies: tuple[SimulatorDependencySpec, ...] = ()
    frame_convention: str = SIMULATOR_CANONICAL_FRAME_CONVENTION
    workspace_process: SimulatorWorkspaceProcessParams | None = None
    requires_runtime_for_check: bool = True
    include_in_parity: bool = True

    def __init_subclass__(cls, **kwargs: object) -> None:
        super().__init_subclass__(**kwargs)
        if cls.__dict__.get("_abstract"):
            return
        for attr in ("simulator_id", "label", "robot_asset_format", "transfer_strategy"):
            if not hasattr(cls, attr):
                raise TypeError(
                    f"SimulatorPlugin subclass {cls.__name__!r} is missing required attribute {attr!r}"
                )
        if cls.simulator_id in _REGISTRY:
            raise RuntimeError(
                f"Duplicate SimulatorPlugin registration for id {cls.simulator_id!r} "
                f"(existing={type(_REGISTRY[cls.simulator_id]).__name__!r}, new={cls.__name__!r})"
            )
        _REGISTRY[cls.simulator_id] = cls()

    @property
    def capabilities(self) -> SimulatorRuntimeCapabilities:
        return SimulatorRuntimeCapabilities(
            workspace_target=self.workspace_target,
            motion_validation=self.motion_validation,
            layout_round_trip=self.layout_round_trip,
        )

    def runtime_status(self) -> SimulatorRuntimeStatus:
        override_python = os.environ.get(f"STUDIO_{self.simulator_id.upper()}_PYTHON", "").strip()
        deps = build_runtime_dependency_statuses(
            self.dependencies,
            python_executable=override_python or None,
        )
        available, status = format_runtime_dependency_status(
            ready_status="ready",
            missing_status_prefix="Missing optional dependency",
            dependencies=deps,
        )
        return SimulatorRuntimeStatus(
            runtimeName=self.simulator_id,
            available=available,
            status=status,
            dependencies=deps,
        )

    def prepare_workspace(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> SimulatorWorkspacePrepareResponse:
        raise SimulatorCapabilityError(
            f"{self.label} is registered for runtime discovery, "
            "but its workspace adapter is planned."
        )

    def build_check_command(
        self,
        request: SimulatorWorkspacePrepareRequest,
        expectations: WorkspaceExpectations,
    ) -> PreparedWorkspaceCommand:
        raise SimulatorCapabilityError(
            f"{self.label} does not implement a workspace check command."
        )

    def as_runtime_spec(self) -> SimulatorRuntimeSpec:
        return SimulatorRuntimeSpec(
            simulator_id=self.simulator_id,
            label=self.label,
            transfer=SimulatorTransferSpec(
                robot_asset_format=self.robot_asset_format,
                scene_asset_format=self.robot_asset_format,
                transfer_strategy=self.transfer_strategy,
                frame_convention=self.frame_convention,
            ),
            target_kind=self.target_kind,
            workspace_target=self.workspace_target,
            motion_validation=self.motion_validation,
            layout_round_trip=self.layout_round_trip,
            dependencies=self.dependencies,
        )

    def runtime_spec_descriptor(self) -> SimulatorRuntimeDescriptor:
        spec = self.as_runtime_spec()
        return SimulatorRuntimeDescriptor(
            simulatorId=self.simulator_id,
            label=self.label,
            targetKind=self.target_kind,
            capabilities=spec.capabilities_model(),
            transferPolicy=spec.transfer.runtime_model(),
        )

    def transfer_policy(self) -> SimulatorRuntimeTransferPolicy:
        return SimulatorRuntimeTransferPolicy(
            robotAssetFormat=self.robot_asset_format,
            sceneAssetFormat=self.robot_asset_format,
            frameConvention=self.frame_convention,
            transferStrategy=self.transfer_strategy,
        )

    def as_workspace_target(self) -> WorkspaceTarget:
        return WorkspaceTarget(
            simulator_id=self.simulator_id,
            label=self.label,
            prepare=self.build_check_command,
            requires_runtime=self.requires_runtime_for_check,
            include_in_parity=self.include_in_parity,
        )


class DirectUrdfSimulatorPlugin(SimulatorPlugin):
    _abstract = True
    workspace_error_class: type[SimulatorAdapterError] = SimulatorAdapterError

    def prepare_workspace(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> SimulatorWorkspacePrepareResponse:
        from backend.services.simulator_adapters.workspace_package import (
            prepare_simulator_workspace_package,
        )
        from backend.services.simulator_adapters.workspace_process import (
            start_prepared_workspace_process,
        )

        def error(msg: str) -> SimulatorAdapterError:
            return self.workspace_error_class(msg)

        prepared = prepare_simulator_workspace_package(
            request,
            workspace_root=self.workspace_process.workspace_root,
            error=error,
        )
        return start_prepared_workspace_process(
            runtime_spec=self.as_runtime_spec(),
            prepared=prepared,
            simulator_asset_path=prepared.robot_urdf_path,
            simulator_asset_flag="--robot-urdf",
            workspace_process=self.workspace_process,
            error=error,
            launch_id=request.launch_id,
        )


class MjcfSimulatorPlugin(SimulatorPlugin):
    _abstract = True

    def prepare_workspace(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> SimulatorWorkspacePrepareResponse:
        from backend.services.simulator_adapters.mujoco import start_mujoco_workspace

        return start_mujoco_workspace(
            request,
            simulator_id=self.simulator_id,
            simulator_label=self.label,
        )

    def build_check_command(
        self,
        request: SimulatorWorkspacePrepareRequest,
        expectations: WorkspaceExpectations,
    ) -> PreparedWorkspaceCommand:
        from backend.services.simulator_adapters.mujoco import (
            PreparedMujocoWorkspace,
            prepare_mujoco_workspace,
        )
        from backend.services.simulator_adapters.workspace_check_spec import (
            _module_command,
        )

        workspace_process = self.workspace_process
        prepared: PreparedMujocoWorkspace = prepare_mujoco_workspace(
            request,
            simulator_id=self.simulator_id,
        )
        artifact_dir = prepared.shared_workspace.workspace_dir / "artifacts"
        camera_screenshot_dir = artifact_dir / "cameras"
        report_path = artifact_dir / "report.json"
        return PreparedWorkspaceCommand(
            command=_module_command(
                workspace_process,
                world_package_path=prepared.shared_workspace.world_package_path,
                robot_asset_flag="--robot-mjcf",
                robot_asset_path=prepared.mjcf_path,
                duration_sec=expectations.duration_sec,
                frame_map=expectations.frame_map,
                extra_args=(
                    "--robot-urdf",
                    str(prepared.shared_workspace.robot_urdf_path),
                    "--simulator-id",
                    self.simulator_id,
                    "--camera-screenshot-dir",
                    str(camera_screenshot_dir),
                ),
                report_path=report_path,
            ),
            ready_marker=workspace_process.ready_log_marker,
            expected_object_marker=f"world_objects={expectations.object_count}",
            expected_camera_log_marker=f"cameras={expectations.camera_count}",
            extra_expected_markers=(f"camera_screenshots={expectations.camera_count}",),
            expected_image_dirs=((camera_screenshot_dir, expectations.camera_count),),
            expected_report_path=report_path,
            expected_simulator_id=self.simulator_id,
            expected_object_count=expectations.object_count,
            expected_camera_count=expectations.camera_count,
            expected_requested_frame_map=expectations.frame_map,
            expected_frame_map=expectations.resolved_frame_map,
            expected_object_positions_xyz=expectations.object_positions_xyz,
            expected_object_sizes_xyz=expectations.object_sizes_xyz,
            expected_object_asset_refs=expectations.object_asset_refs,
            expected_object_contracts=expectations.object_contracts,
            expected_joint_positions=expectations.joint_positions,
            expected_camera_ids=expectations.camera_ids,
            expected_camera_contracts=expectations.camera_contracts,
            expected_report_artifact_file_keys=("mjcf_path",),
            expected_report_artifact_dir_keys=("camera_screenshot_dir",),
        )


def get_all_plugins() -> tuple[SimulatorPlugin, ...]:
    return tuple(_REGISTRY.values())


def get_workspace_plugins() -> tuple[SimulatorPlugin, ...]:
    return tuple(p for p in _REGISTRY.values() if p.workspace_target)


def get_plugin(simulator_id: SimulatorId) -> SimulatorPlugin:
    try:
        return _REGISTRY[simulator_id]
    except KeyError as exc:
        raise SimulatorCapabilityError(f"Unsupported simulator: {simulator_id}") from exc
