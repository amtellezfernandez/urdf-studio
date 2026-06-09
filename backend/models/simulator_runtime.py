from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.models.world_scene_package import WorldScenePackageManifest


SIMULATOR_ID_VALUES = (
    "genesis",
    "mjlab",
    "mujoco",
    "mjx",
    "pybullet",
    "sapien2",
    "sapien3",
    "isaacsim",
    "isaacgym",
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
    SIMULATOR_ISAACGYM_ID,
    SIMULATOR_NEWTON_ID,
    SIMULATOR_BLENDER_ID,
    SIMULATOR_ROBOSPLATTER_ID,
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


class SimulatorWorldOpenRequest(BaseModel):
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


class SimulatorWorldOpenResponse(BaseModel):
    simulator_id: SimulatorId = SIMULATOR_GENESIS_ID
    started: bool
    pid: int
    command: list[str]
    log_path: str | None = None
    world_package_path: str
    robot_urdf_path: str
    simulator_asset_path: str | None = None
    simulator_asset_format: Literal["urdf", "mjcf", "usd"] | None = None
    bundled_mesh_count: int = 0
    unresolved_mesh_refs: list[str] = Field(default_factory=list)


class SimulatorRuntimeCamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class SimulatorRuntimeDependency(SimulatorRuntimeCamelModel):
    name: str
    available: bool


class SimulatorRuntimeCapabilities(SimulatorRuntimeCamelModel):
    world_viewer: bool = Field(default=False, alias="worldViewer")
    motion_validation: bool = Field(default=False, alias="motionValidation")


@dataclass(frozen=True)
class SimulatorDependencySpec:
    name: str
    import_name: str


@dataclass(frozen=True)
class SimulatorRuntimeSpec:
    simulator_id: SimulatorId
    label: str
    world_viewer: bool = False
    motion_validation: bool = False
    dependencies: tuple[SimulatorDependencySpec, ...] = ()

    def capabilities_model(self) -> SimulatorRuntimeCapabilities:
        return SimulatorRuntimeCapabilities(
            world_viewer=self.world_viewer,
            motion_validation=self.motion_validation,
        )


class SimulatorRuntimeDescriptor(SimulatorRuntimeCamelModel):
    simulator_id: SimulatorId = Field(..., alias="simulatorId")
    label: str
    capabilities: SimulatorRuntimeCapabilities


class SimulatorRuntimeListResponse(SimulatorRuntimeCamelModel):
    simulators: list[SimulatorRuntimeDescriptor] = Field(default_factory=list)


class SimulatorRuntimeStatus(SimulatorRuntimeCamelModel):
    runtime_name: str = Field(..., alias="runtimeName")
    available: bool
    status: str
    dependencies: list[SimulatorRuntimeDependency] = Field(default_factory=list)


SIMULATOR_RUNTIME_SPECS: tuple[SimulatorRuntimeSpec, ...] = (
    SimulatorRuntimeSpec(
        simulator_id=SIMULATOR_GENESIS_ID,
        label="Genesis",
        world_viewer=True,
        dependencies=(SimulatorDependencySpec(name="genesis", import_name="genesis"),),
    ),
    SimulatorRuntimeSpec(
        simulator_id=SIMULATOR_MJLAB_ID,
        label="MJLab",
        world_viewer=True,
        motion_validation=True,
    ),
    SimulatorRuntimeSpec(
        simulator_id=SIMULATOR_MUJOCO_ID,
        label="MuJoCo",
        world_viewer=True,
        dependencies=(SimulatorDependencySpec(name="mujoco", import_name="mujoco"),),
    ),
    SimulatorRuntimeSpec(
        simulator_id=SIMULATOR_MJX_ID,
        label="MJX",
        dependencies=(
            SimulatorDependencySpec(name="mujoco", import_name="mujoco"),
            SimulatorDependencySpec(name="jax", import_name="jax"),
        ),
    ),
    SimulatorRuntimeSpec(
        simulator_id=SIMULATOR_PYBULLET_ID,
        label="PyBullet",
        dependencies=(SimulatorDependencySpec(name="pybullet", import_name="pybullet"),),
    ),
    SimulatorRuntimeSpec(
        simulator_id=SIMULATOR_SAPIEN2_ID,
        label="SAPIEN 2",
        dependencies=(SimulatorDependencySpec(name="sapien", import_name="sapien"),),
    ),
    SimulatorRuntimeSpec(
        simulator_id=SIMULATOR_SAPIEN3_ID,
        label="SAPIEN 3",
        dependencies=(SimulatorDependencySpec(name="sapien", import_name="sapien"),),
    ),
    SimulatorRuntimeSpec(
        simulator_id=SIMULATOR_ISAACSIM_ID,
        label="Isaac Sim",
        dependencies=(SimulatorDependencySpec(name="isaacsim", import_name="isaacsim"),),
    ),
    SimulatorRuntimeSpec(
        simulator_id=SIMULATOR_ISAACGYM_ID,
        label="Isaac Gym",
        dependencies=(SimulatorDependencySpec(name="isaacgym", import_name="isaacgym"),),
    ),
    SimulatorRuntimeSpec(
        simulator_id=SIMULATOR_NEWTON_ID,
        label="Newton",
        dependencies=(SimulatorDependencySpec(name="newton", import_name="newton"),),
    ),
    SimulatorRuntimeSpec(
        simulator_id=SIMULATOR_BLENDER_ID,
        label="Blender",
        dependencies=(SimulatorDependencySpec(name="bpy", import_name="bpy"),),
    ),
    SimulatorRuntimeSpec(
        simulator_id=SIMULATOR_ROBOSPLATTER_ID,
        label="RoboSplatter",
        dependencies=(SimulatorDependencySpec(name="robosplatter", import_name="robosplatter"),),
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
    normalized = value.replace("\\", "/").strip().lstrip("/")
    normalized = re.sub(r"/+", "/", normalized)
    if not normalized:
        raise ValueError(f"{label} must be non-empty")
    if not SIMULATOR_RELATIVE_PATH_PATTERN.match(normalized):
        raise ValueError(f"{label} must be relative")
    parts = [part for part in normalized.split("/") if part and part != "."]
    if any(part == ".." for part in parts):
        raise ValueError(f"{label} must not traverse directories")
    return "/".join(parts)
