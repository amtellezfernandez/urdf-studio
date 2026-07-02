from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.models.world_scene_package import WorldScenePackageManifest


SimulatorAssetFormat = Literal["urdf", "mjcf", "mjx_mjcf", "usd", "native"]
SimulatorWorkspaceAssetFormat = Literal["urdf", "mjcf", "usd", "native"]
SimulatorTransferStrategy = Literal["direct", "convert", "planned"]
SimulatorTargetKind = Literal["physics_simulator", "authoring_tool", "renderer"]
SimulatorDependencyScope = Literal["workspace", "validation", "runtime"]
SimulatorWorkspaceLaunchMode = Literal["interactive_viewer", "headless_check"]
SIMULATOR_CANONICAL_FRAME_CONVENTION = "ros-rep-103"
SIMULATOR_ID_VALUES = (
    "genesis",
    "mjlab",
    "mujoco",
    "mjx",
    "pybullet",
    "sapien2",
    "sapien3",
    "isaacsim",
    "newton",
    "blender",
    "robosplatter",
)
SimulatorId = Literal[*SIMULATOR_ID_VALUES]
(
    SIMULATOR_GENESIS_ID,
    SIMULATOR_MJLAB_ID,
    SIMULATOR_MUJOCO_ID,
    SIMULATOR_MJX_ID,
    SIMULATOR_PYBULLET_ID,
    SIMULATOR_SAPIEN2_ID,
    SIMULATOR_SAPIEN3_ID,
    SIMULATOR_ISAACSIM_ID,
    SIMULATOR_NEWTON_ID,
    SIMULATOR_BLENDER_ID,
    SIMULATOR_ROBOSPLATTER_ID,
) = SIMULATOR_ID_VALUES

MAX_SIMULATOR_MESH_ASSETS = 512
MAX_SIMULATOR_ASSET_ALIASES = 64
MAX_SIMULATOR_PACKAGE_ROOTS = 128
MAX_SIMULATOR_PACKAGE_ROOT_HINTS = 32
SIMULATOR_RELATIVE_PATH_PATTERN = re.compile(r"^[^:\0]+$")
SIMULATOR_WORKSPACE_LAUNCH_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


def validate_simulator_workspace_launch_id(value: str, context: str = "launch id") -> str:
    normalized = value.strip()
    if not normalized or not SIMULATOR_WORKSPACE_LAUNCH_ID_PATTERN.fullmatch(normalized):
        raise ValueError(f"{context} must be a portable launch identifier")
    return normalized


class SimulatorMeshAssetUpload(BaseModel):
    path: str = Field(..., min_length=1, max_length=512)
    aliases: list[str] = Field(default_factory=list, max_length=MAX_SIMULATOR_ASSET_ALIASES)
    content_base64: str = Field(..., min_length=1)
    mime: str | None = Field(default=None, max_length=128)

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: str) -> str:
        return validate_simulator_relative_path(value, "mesh asset path")

    @field_validator("aliases")
    @classmethod
    def validate_aliases(cls, values: list[str]) -> list[str]:
        return [validate_simulator_relative_path(value, "mesh asset alias") for value in values]


class SimulatorWorkspacePrepareRequest(BaseModel):
    world_package: WorldScenePackageManifest
    urdf_asset_path: str | None = Field(default=None, max_length=512)
    mesh_assets: list[SimulatorMeshAssetUpload] = Field(
        default_factory=list,
        max_length=MAX_SIMULATOR_MESH_ASSETS,
    )
    package_roots: dict[str, list[str]] = Field(
        default_factory=dict,
        max_length=MAX_SIMULATOR_PACKAGE_ROOTS,
    )
    ilu_session_id: str | None = Field(default=None, max_length=128)
    launch_id: str | None = Field(default=None, max_length=128)

    @field_validator("urdf_asset_path")
    @classmethod
    def validate_urdf_asset_path(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        return validate_simulator_relative_path(value, "URDF asset path")

    @field_validator("launch_id")
    @classmethod
    def validate_launch_id(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        return validate_simulator_workspace_launch_id(value)

    @field_validator("package_roots")
    @classmethod
    def validate_package_roots(cls, value: dict[str, list[str]]) -> dict[str, list[str]]:
        cleaned: dict[str, list[str]] = {}
        for package_name, roots in value.items():
            normalized_name = package_name.strip()
            if not normalized_name:
                raise ValueError("package root name must be non-empty")
            if len(roots) > MAX_SIMULATOR_PACKAGE_ROOT_HINTS:
                raise ValueError("package root has too many hints")
            cleaned[normalized_name] = [
                validate_simulator_relative_path(root, "package root hint")
                for root in roots
                if root.strip()
            ]
        return cleaned


class SimulatorWorkspacePrepareResponse(BaseModel):
    simulator_id: SimulatorId = SIMULATOR_GENESIS_ID
    started: bool
    pid: int
    command: list[str]
    launch_mode: SimulatorWorkspaceLaunchMode = "interactive_viewer"
    log_path: str | None = None
    world_package_path: str
    robot_urdf_path: str
    simulator_asset_path: str | None = None
    simulator_asset_format: SimulatorWorkspaceAssetFormat | None = None
    bundled_mesh_count: int = 0
    unresolved_mesh_refs: list[str] = Field(default_factory=list)
    world_object_count: int = Field(default=0, ge=0)
    camera_count: int = Field(default=0, ge=0)


class WorkspaceChangeSetApplyRequest(BaseModel):
    world_package: WorldScenePackageManifest
    change_set: dict[str, Any]


class WorkspaceChangeSetApplyResponse(BaseModel):
    simulator_id: SimulatorId
    world_package: WorldScenePackageManifest
    applied_change_count: int
    review_only_count: int


class SimulatorRuntimeCamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class SimulatorRuntimeDependency(SimulatorRuntimeCamelModel):
    name: str
    available: bool
    required: bool = True
    scope: SimulatorDependencyScope = "workspace"


class SimulatorRuntimeCapabilities(SimulatorRuntimeCamelModel):
    workspace_target: bool = Field(default=False, alias="workspaceTarget")
    motion_validation: bool = Field(default=False, alias="motionValidation")
    layout_round_trip: bool = Field(default=False, alias="layoutRoundTrip")


class SimulatorRuntimeTransferPolicy(SimulatorRuntimeCamelModel):
    robot_asset_format: SimulatorAssetFormat = Field(..., alias="robotAssetFormat")
    scene_asset_format: SimulatorAssetFormat = Field(..., alias="sceneAssetFormat")
    frame_convention: str = Field(
        default=SIMULATOR_CANONICAL_FRAME_CONVENTION,
        alias="frameConvention",
    )
    transfer_strategy: SimulatorTransferStrategy = Field(..., alias="transferStrategy")


@dataclass(frozen=True)
class SimulatorDependencySpec:
    name: str
    import_name: str
    required: bool = True
    scope: SimulatorDependencyScope = "workspace"


@dataclass(frozen=True)
class SimulatorTransferSpec:
    robot_asset_format: SimulatorAssetFormat
    scene_asset_format: SimulatorAssetFormat
    transfer_strategy: SimulatorTransferStrategy
    frame_convention: str = SIMULATOR_CANONICAL_FRAME_CONVENTION

    def runtime_model(self) -> SimulatorRuntimeTransferPolicy:
        return SimulatorRuntimeTransferPolicy(
            robotAssetFormat=self.robot_asset_format,
            sceneAssetFormat=self.scene_asset_format,
            frameConvention=self.frame_convention,
            transferStrategy=self.transfer_strategy,
        )

    def workspace_asset_format(self) -> SimulatorWorkspaceAssetFormat:
        if self.robot_asset_format not in ("urdf", "mjcf", "usd", "native"):
            raise ValueError(
                f"{self.robot_asset_format} is not a workspace simulator asset format"
            )
        return self.robot_asset_format


@dataclass(frozen=True)
class SimulatorRuntimeSpec:
    simulator_id: SimulatorId
    label: str
    transfer: SimulatorTransferSpec
    target_kind: SimulatorTargetKind = "physics_simulator"
    workspace_target: bool = False
    motion_validation: bool = False
    layout_round_trip: bool = False
    dependencies: tuple[SimulatorDependencySpec, ...] = ()

    def capabilities_model(self) -> SimulatorRuntimeCapabilities:
        return SimulatorRuntimeCapabilities(
            workspace_target=self.workspace_target,
            motion_validation=self.motion_validation,
            layout_round_trip=self.layout_round_trip,
        )


class SimulatorRuntimeDescriptor(SimulatorRuntimeCamelModel):
    simulator_id: SimulatorId = Field(..., alias="simulatorId")
    label: str
    target_kind: SimulatorTargetKind = Field(..., alias="targetKind")
    capabilities: SimulatorRuntimeCapabilities
    transfer_policy: SimulatorRuntimeTransferPolicy = Field(..., alias="transferPolicy")


class SimulatorRuntimeListResponse(SimulatorRuntimeCamelModel):
    simulators: list[SimulatorRuntimeDescriptor] = Field(default_factory=list)


class SimulatorRuntimeStatus(SimulatorRuntimeCamelModel):
    runtime_name: str = Field(..., alias="runtimeName")
    available: bool
    status: str
    dependencies: list[SimulatorRuntimeDependency] = Field(default_factory=list)


def _transfer(
    robot_asset_format: SimulatorAssetFormat,
    transfer_strategy: SimulatorTransferStrategy,
    *,
    scene_asset_format: SimulatorAssetFormat | None = None,
) -> SimulatorTransferSpec:
    return SimulatorTransferSpec(
        robot_asset_format=robot_asset_format,
        scene_asset_format=scene_asset_format or robot_asset_format,
        transfer_strategy=transfer_strategy,
    )


def validate_simulator_relative_path(value: str, label: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError(f"{label} must be non-empty")
    if stripped.startswith(("/", "\\")):
        raise ValueError(f"{label} must be relative")
    normalized = stripped.replace("\\", "/")
    normalized = re.sub(r"/+", "/", normalized)
    if not SIMULATOR_RELATIVE_PATH_PATTERN.match(normalized):
        raise ValueError(f"{label} must be relative")
    parts = [part for part in normalized.split("/") if part and part != "."]
    if not parts:
        raise ValueError(f"{label} must be non-empty")
    if any(part == ".." for part in parts):
        raise ValueError(f"{label} must not traverse directories")
    return "/".join(parts)
