from __future__ import annotations

import os
from typing import TYPE_CHECKING

from backend.models.simulator_runtime import (
    SIMULATOR_CANONICAL_FRAME_CONVENTION,
    SimulatorAssetFormat,
    SimulatorDependencySpec,
    SimulatorId,
    SimulatorRuntimeCapabilities,
    SimulatorRuntimeDescriptor,
    SimulatorRuntimeDependency,
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
    from backend.services.simulator_adapters.mujoco import PreparedMujocoWorkspace
    from backend.services.simulator_adapters.workspace_package import PreparedSimulatorWorkspace
    from backend.services.simulator_adapters.workspace_expectations import WorkspaceExpectations

_REGISTRY: dict[SimulatorId, SimulatorPlugin] = {}
_REQUIRED_PLUGIN_ATTRIBUTES = (
    "simulator_id",
    "label",
    "robot_asset_format",
    "transfer_strategy",
)
READY_RUNTIME_STATUS = "ready"
MISSING_OPTIONAL_DEPENDENCY_STATUS_PREFIX = "Missing optional dependency"


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

    @property
    def runtime_override_python_env_var(self) -> str:
        return f"STUDIO_{self.simulator_id.upper()}_PYTHON"

    def __init_subclass__(cls, **kwargs: object) -> None:
        super().__init_subclass__(**kwargs)
        if cls.__dict__.get("_abstract"):
            return
        for attr in _REQUIRED_PLUGIN_ATTRIBUTES:
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

    def _resolve_runtime_override_python(self) -> str | None:
        override_python = os.environ.get(self.runtime_override_python_env_var, "").strip()
        return override_python or None

    def _runtime_dependencies(self) -> list[SimulatorRuntimeDependency]:
        return build_runtime_dependency_statuses(
            self.dependencies,
            python_executable=self._resolve_runtime_override_python(),
        )

    def _transfer_spec(self) -> SimulatorTransferSpec:
        return SimulatorTransferSpec(
            robot_asset_format=self.robot_asset_format,
            scene_asset_format=self.robot_asset_format,
            transfer_strategy=self.transfer_strategy,
            frame_convention=self.frame_convention,
        )

    def runtime_status(self) -> SimulatorRuntimeStatus:
        dependencies = self._runtime_dependencies()
        available, status = format_runtime_dependency_status(
            ready_status=READY_RUNTIME_STATUS,
            missing_status_prefix=MISSING_OPTIONAL_DEPENDENCY_STATUS_PREFIX,
            dependencies=dependencies,
        )
        return SimulatorRuntimeStatus(
            runtimeName=self.simulator_id,
            available=available,
            status=status,
            dependencies=dependencies,
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
            transfer=self._transfer_spec(),
            target_kind=self.target_kind,
            workspace_target=self.workspace_target,
            motion_validation=self.motion_validation,
            layout_round_trip=self.layout_round_trip,
            dependencies=self.dependencies,
        )

    def runtime_spec_descriptor(self) -> SimulatorRuntimeDescriptor:
        return SimulatorRuntimeDescriptor(
            simulatorId=self.simulator_id,
            label=self.label,
            targetKind=self.target_kind,
            capabilities=self.capabilities,
            transferPolicy=self.transfer_policy(),
        )

    def transfer_policy(self) -> SimulatorRuntimeTransferPolicy:
        return self._transfer_spec().runtime_model()

    def require_workspace_process(self) -> SimulatorWorkspaceProcessParams:
        workspace_process = self.workspace_process
        if workspace_process is None:
            raise SimulatorCapabilityError(
                f"{self.label} is missing workspace process configuration."
            )
        return workspace_process

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

    def _workspace_error(self, msg: str) -> SimulatorAdapterError:
        return self.workspace_error_class(msg)

    def prepare_workspace_package(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> PreparedSimulatorWorkspace:
        from backend.services.simulator_adapters.direct_urdf import (
            prepare_direct_urdf_workspace,
        )

        return prepare_direct_urdf_workspace(
            request,
            workspace_process=self.require_workspace_process(),
            error=self._workspace_error,
        )

    def prepare_workspace(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> SimulatorWorkspacePrepareResponse:
        from backend.services.simulator_adapters.workspace_process import (
            start_prepared_workspace_process,
        )

        workspace_process = self.require_workspace_process()
        prepared = self.prepare_workspace_package(request)
        return start_prepared_workspace_process(
            runtime_spec=self.as_runtime_spec(),
            prepared=prepared,
            simulator_asset_path=prepared.robot_urdf_path,
            simulator_asset_flag="--robot-urdf",
            workspace_process=workspace_process,
            error=self._workspace_error,
            launch_id=request.launch_id,
        )


class MjcfSimulatorPlugin(SimulatorPlugin):
    _abstract = True

    def prepare_workspace_package(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> PreparedMujocoWorkspace:
        from backend.services.simulator_adapters.mujoco import prepare_mujoco_workspace

        return prepare_mujoco_workspace(
            request,
            simulator_id=self.simulator_id,
        )

    def prepare_workspace(
        self,
        request: SimulatorWorkspacePrepareRequest,
    ) -> SimulatorWorkspacePrepareResponse:
        from backend.services.simulator_adapters.mujoco import _mujoco_error
        from backend.services.simulator_adapters.workspace_process import (
            start_prepared_workspace_process,
        )

        prepared: PreparedMujocoWorkspace = self.prepare_workspace_package(request)
        shared = prepared.shared_workspace
        workspace_process = self.require_workspace_process()
        return start_prepared_workspace_process(
            runtime_spec=self.as_runtime_spec(),
            prepared=shared,
            simulator_asset_path=prepared.mjcf_path,
            simulator_asset_flag="--robot-mjcf",
            workspace_process=workspace_process,
            error=_mujoco_error,
            simulator_label=self.label,
            extra_simulator_args=(
                "--robot-urdf",
                str(shared.robot_urdf_path),
                "--simulator-id",
                self.simulator_id,
            ),
            launch_id=request.launch_id,
        )

    def build_check_command(
        self,
        request: SimulatorWorkspacePrepareRequest,
        expectations: WorkspaceExpectations,
    ) -> PreparedWorkspaceCommand:
        from backend.services.simulator_adapters.workspace_check_spec import (
            _module_command,
        )

        workspace_process = self.require_workspace_process()
        prepared: PreparedMujocoWorkspace = self.prepare_workspace_package(request)
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
