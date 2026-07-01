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
SIMULATOR_CANONICAL_FRAME_CONVENTION = "ros-rep-103"
SIMULATOR_ID_VALUES = (
    "genesis",
    "mujoco",
    "mjx",
    "pybullet",
    "isaac-sim",
    "isaac-lab",
    "isaac-gym",
    "sapien",
    "coppeliasim",
    "blender",
)
SimulatorId = Literal[*SIMULATOR_ID_VALUES]
(
    SIMULATOR_GENESIS_ID,
    SIMULATOR_MUJOCO_ID,
    SIMULATOR_MJX_ID,
    SIMULATOR_PYBULLET_ID,
    SIMULATOR_ISAAC_SIM_ID,
    SIMULATOR_ISAAC_LAB_ID,
    SIMULATOR_ISAAC_GYM_ID,
    SIMULATOR_SAPIEN_ID,
    SIMULATOR_COPPELIASIM_ID,
    SIMULATOR_BLENDER_ID,
) = SIMULATOR_ID_VALUES

MAX_SIMULATOR_MESH_ASSETS = 512
MAX_SIMULATOR_ASSET_ALIASES = 64
MAX_SIMULATOR_PACKAGE_ROOTS = 128
MAX_SIMULATOR_PACKAGE_ROOT_HINTS = 32
SIMULATOR_RELATIVE_PATH_PATTERN = re.compile(r"^[^:\0]+$")


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

    @field_validator("urdf_asset_path")
    @classmethod
    def validate_urdf_asset_path(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        return validate_simulator_relative_path(value, "URDF asset path")

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
        if self.robot_asset_format == "mjx_mjcf":
            return "mjcf"
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


def _dependency(name: str, import_name: str | None = None) -> SimulatorDependencySpec:
    return SimulatorDependencySpec(name=name, import_name=import_name or name)


def _runtime(
    simulator_id: SimulatorId,
    label: str,
    robot_asset_format: SimulatorAssetFormat,
    transfer_strategy: SimulatorTransferStrategy,
    *,
    target_kind: SimulatorTargetKind = "physics_simulator",
    workspace_target: bool = False,
    motion_validation: bool = False,
    layout_round_trip: bool = False,
    dependencies: tuple[SimulatorDependencySpec, ...] = (),
) -> SimulatorRuntimeSpec:
    return SimulatorRuntimeSpec(
        simulator_id=simulator_id,
        label=label,
        transfer=_transfer(robot_asset_format, transfer_strategy),
        target_kind=target_kind,
        workspace_target=workspace_target,
        motion_validation=motion_validation,
        layout_round_trip=layout_round_trip,
        dependencies=dependencies,
    )


SIMULATOR_RUNTIME_SPECS: tuple[SimulatorRuntimeSpec, ...] = (
    _runtime(
        SIMULATOR_GENESIS_ID,
        "Genesis",
        "urdf",
        "direct",
        workspace_target=True,
        dependencies=(_dependency("genesis"),),
    ),
    _runtime(
        SIMULATOR_MUJOCO_ID,
        "MuJoCo",
        "mjcf",
        "convert",
        workspace_target=True,
        dependencies=(_dependency("mujoco"),),
    ),
    _runtime(
        SIMULATOR_MJX_ID,
        "MuJoCo MJX",
        "mjx_mjcf",
        "convert",
        workspace_target=True,
        motion_validation=True,
        dependencies=(_dependency("mujoco"), _dependency("jax")),
    ),
    _runtime(
        SIMULATOR_PYBULLET_ID,
        "PyBullet",
        "urdf",
        "direct",
        workspace_target=True,
        dependencies=(_dependency("pybullet"),),
    ),
    _runtime(
        SIMULATOR_ISAAC_SIM_ID,
        "Isaac Sim",
        "usd",
        "convert",
        workspace_target=True,
        dependencies=(_dependency("isaacsim"),),
    ),
    _runtime(
        SIMULATOR_ISAAC_LAB_ID,
        "Isaac Lab",
        "usd",
        "convert",
        workspace_target=True,
        motion_validation=True,
        dependencies=(_dependency("isaaclab"), _dependency("isaacsim")),
    ),
    _runtime(
        SIMULATOR_ISAAC_GYM_ID,
        "Isaac Gym",
        "urdf",
        "direct",
        workspace_target=True,
        motion_validation=True,
        dependencies=(_dependency("isaacgym"),),
    ),
    _runtime(
        SIMULATOR_SAPIEN_ID,
        "SAPIEN",
        "urdf",
        "direct",
        workspace_target=True,
        dependencies=(_dependency("sapien"),),
    ),
    _runtime(
        SIMULATOR_COPPELIASIM_ID,
        "CoppeliaSim",
        "urdf",
        "direct",
        workspace_target=True,
        dependencies=(_dependency("coppeliasim-zmqremoteapi-client", "coppeliasim_zmqremoteapi_client"),),
    ),
    _runtime(
        SIMULATOR_BLENDER_ID,
        "Blender",
        "native",
        "direct",
        target_kind="authoring_tool",
        workspace_target=True,
        layout_round_trip=True,
        dependencies=(_dependency("blender", "bpy"),),
    ),
)
SUPPORTED_SIMULATOR_IDS: tuple[SimulatorId, ...] = tuple(
    spec.simulator_id for spec in SIMULATOR_RUNTIME_SPECS
)
SIMULATOR_RUNTIME_SPECS_BY_ID: dict[SimulatorId, SimulatorRuntimeSpec] = {
    spec.simulator_id: spec for spec in SIMULATOR_RUNTIME_SPECS
}


def get_simulator_runtime_spec(simulator_id: SimulatorId) -> SimulatorRuntimeSpec:
    return SIMULATOR_RUNTIME_SPECS_BY_ID[simulator_id]


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
