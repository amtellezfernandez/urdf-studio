from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.models.json_payload import JsonObject

SCENARIO_SCHEMA_VERSION = "scenario-v1"

SCENARIO_OBJECT_ROLES = ("target", "container", "obstacle", "tool", "reference")
SCENARIO_POLICY_KINDS = ("waypoint", "replay", "vla_ws", "none")
SCENARIO_OBSERVATION_MODALITIES = ("joint_positions", "object_poses", "camera_rgb")

Vector3 = tuple[float, float, float]


class ScenarioWorldRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    package: str = Field(..., min_length=1)
    frame_map: Literal["auto", "identity", "studio-y-up-to-z-up"] = "identity"
    include_hidden: bool = False


class ScenarioPose(BaseModel):
    model_config = ConfigDict(extra="forbid")

    xyz: Vector3 = (0.0, 0.0, 0.0)
    rpy: Vector3 = (0.0, 0.0, 0.0)


class ScenarioRobotSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    urdf: str | None = None
    base_pose: ScenarioPose = Field(default_factory=ScenarioPose)
    init_joint_positions: dict[str, float] = Field(default_factory=dict)
    init_noise_joint_regex: dict[str, float] = Field(default_factory=dict)
    end_effector_link: str | None = None


class ScenarioObjectBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["target", "container", "obstacle", "tool", "reference"]
    world_object_id: str = Field(..., min_length=1)


class ScenarioRegion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    aabb_min: Vector3
    aabb_max: Vector3


class ScenarioPoseJitter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position_jitter_m: Vector3 = (0.0, 0.0, 0.0)
    yaw_jitter_rad: float = 0.0
    region: str | None = None


class ScenarioRandomization(BaseModel):
    model_config = ConfigDict(extra="forbid")

    seed: int = 0
    object_pose: dict[str, ScenarioPoseJitter] = Field(default_factory=dict)
    regions: dict[str, ScenarioRegion] = Field(default_factory=dict)


class ScenarioTaskSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    family: str = Field(..., min_length=1)
    instruction: str = Field(..., min_length=1)
    objects: dict[str, ScenarioObjectBinding] = Field(default_factory=dict)
    randomization: ScenarioRandomization = Field(default_factory=ScenarioRandomization)


class ScenarioSuccessSpec(BaseModel):
    """Structured success conditions, compiled into the Genie Sim checker DSL.

    ``all_of`` entries are single-key mappings of a supported condition to its
    params (validated by the loader compile step). ``acts`` is a raw Genie
    checker-DSL passthrough that overrides ``all_of``/``timeout`` when set.
    ``guards`` are hard-failure checks evaluated by the runner (decision:
    reject) rather than by the vendored action tree.
    """

    model_config = ConfigDict(extra="forbid")

    all_of: list[JsonObject] = Field(default_factory=list)
    guards: list[JsonObject] = Field(default_factory=list)
    timeout_sim_seconds: float | None = Field(default=None, gt=0.0)
    acts: JsonObject | None = None

    @field_validator("all_of", "guards")
    @classmethod
    def _validate_single_key_entries(cls, value: list[JsonObject]) -> list[JsonObject]:
        for index, entry in enumerate(value):
            if len(entry) != 1:
                raise ValueError(
                    f"entry [{index}] must be a single-key mapping of condition -> params"
                )
        return value


class ScenarioObservationSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    modalities: list[Literal["joint_positions", "object_poses", "camera_rgb"]] = Field(
        default_factory=lambda: ["joint_positions", "object_poses"]
    )


class ScenarioRuntimeSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    physics_timestep_s: float = Field(default=0.002, gt=0.0)
    control_hz: float = Field(default=50.0, gt=0.0)
    checker_interval_steps: int = Field(default=5, ge=1)
    max_episode_steps: int = Field(default=1500, ge=1)
    observation: ScenarioObservationSpec = Field(default_factory=ScenarioObservationSpec)
    # "weld" enables the kinematic grasp-attach cheat: an attach event pins the
    # object to the robot attach link. Deterministic demo mode; reported
    # honestly in episode artifacts.
    grasp_attach: Literal["none", "weld"] = "none"
    attach_link: str | None = None


class ScenarioPolicySpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["waypoint", "replay", "vla_ws", "none"] = "none"
    params: JsonObject = Field(default_factory=dict)


class ScenarioEvaluationSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    episodes: int = Field(default=1, ge=1)
    seeds: list[int] = Field(default_factory=list)
    record_trace: bool = True
    record_decisions: bool = True
    record_video: bool = False


class ScenarioDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["scenario-v1"]
    scenario_id: str = Field(..., min_length=1, pattern=r"^[A-Za-z0-9][A-Za-z0-9_\-]*$")
    title: str | None = None
    world: ScenarioWorldRef
    robot: ScenarioRobotSpec = Field(default_factory=ScenarioRobotSpec)
    task: ScenarioTaskSpec
    success: ScenarioSuccessSpec
    runtime: ScenarioRuntimeSpec = Field(default_factory=ScenarioRuntimeSpec)
    policy: ScenarioPolicySpec = Field(default_factory=ScenarioPolicySpec)
    metrics: list[str] = Field(default_factory=lambda: ["success_rate"])
    evaluation: ScenarioEvaluationSpec = Field(default_factory=ScenarioEvaluationSpec)


class EpisodeObjectPlacement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position_xyz: Vector3
    rotation_rpy_rad: Vector3


class EpisodeManifest(BaseModel):
    """Fully resolved per-episode initial conditions.

    Sampled once by the orchestrator (seeded) and fed identically to every
    simulator so cross-sim comparisons share exact initial states.
    """

    model_config = ConfigDict(extra="forbid")

    scenario_id: str
    episode_index: int = Field(..., ge=0)
    seed: int
    object_placements: dict[str, EpisodeObjectPlacement] = Field(default_factory=dict)
    init_joint_positions: dict[str, float] = Field(default_factory=dict)
