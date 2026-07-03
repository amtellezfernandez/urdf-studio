from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.ros_viz.params import (
    DEFAULT_CLOCK_MODE,
    DEFAULT_DETERMINISTIC_MODE,
    DEFAULT_FIXED_FRAME,
    DEFAULT_FRAME_ID_BASE_LINK,
    DEFAULT_FRAME_ID_TOOL0,
    DEFAULT_PARENT_BASE,
    DEFAULT_PARENT_WORLD,
    MAX_TOPIC_SUBSCRIPTIONS,
    STREAM_SEQUENCE_START,
)

DeterministicMode = Literal["strict", "smooth"]
RosVizModeProfile = Literal["studio", "ros_debug"]
RosVizDataSource = Literal["live_ros"]
RosVizClockMode = Literal["live"]
RosVizSessionMode = Literal["live_debug"]
RosVizTimeSource = Literal["ros_clock"]
RosVizTransportSource = Literal["ros_topics"]


class RosVizQosProfile(BaseModel):
    reliability: Literal["reliable", "best_effort"] = "reliable"
    durability: Literal["volatile", "transient_local"] = "volatile"
    history: Literal["keep_last", "keep_all"] = "keep_last"
    depth: int = Field(default=10, ge=1)


class RosVizTopicInfo(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    topic_id: int = Field(..., ge=1)
    name: str = Field(..., min_length=1)
    schema_name: str = Field(..., min_length=1, alias="schema")
    encoding: Literal["json", "flatbuffer", "raw"] = "json"
    qos: RosVizQosProfile = Field(default_factory=RosVizQosProfile)


class RosVizRuntimeCapabilities(BaseModel):
    can_toggle_play: bool = False
    can_step: bool = False
    can_seek: bool = False
    can_set_playback_rate: bool = False


class RosVizSessionCreateRequest(BaseModel):
    fixed_frame: str = Field(default=DEFAULT_FIXED_FRAME, min_length=1)
    ros_domain_id: int | None = Field(default=None, ge=0)
    deterministic_mode: DeterministicMode = DEFAULT_DETERMINISTIC_MODE
    mode_profile: RosVizModeProfile = "ros_debug"
    data_source: RosVizDataSource = "live_ros"
    session_mode: RosVizSessionMode | None = None


class RosVizSessionSnapshot(BaseModel):
    session_id: str = Field(..., min_length=1)
    created_at_ms: int = Field(..., ge=0)
    updated_at_ms: int = Field(..., ge=0)
    fixed_frame: str = Field(..., min_length=1)
    ros_domain_id: int | None = Field(default=None, ge=0)
    deterministic_mode: DeterministicMode = DEFAULT_DETERMINISTIC_MODE
    mode_profile: RosVizModeProfile = "ros_debug"
    data_source: RosVizDataSource = "live_ros"
    session_mode: RosVizSessionMode = "live_debug"
    topic_count: int = Field(..., ge=0)
    next_sequence: int = Field(default=STREAM_SEQUENCE_START, ge=STREAM_SEQUENCE_START)
    deterministic_session_hash: str = Field(default="", min_length=0)


class RosVizStreamTicketResponse(BaseModel):
    session_id: str = Field(..., min_length=1)
    ticket: str = Field(..., min_length=1)
    expires_at_ms: int = Field(..., ge=0)


class RosVizModeUpdateRequest(BaseModel):
    mode: RosVizSessionMode


class RosVizSessionStateResponse(BaseModel):
    session_id: str = Field(..., min_length=1)
    mode: RosVizSessionMode = "live_debug"
    fixed_frame: str = Field(default=DEFAULT_FIXED_FRAME, min_length=1)
    deterministic_mode: DeterministicMode = DEFAULT_DETERMINISTIC_MODE
    data_source: RosVizDataSource = "live_ros"
    time_source: RosVizTimeSource = "ros_clock"
    transport_source: RosVizTransportSource = "ros_topics"
    clock_mode: RosVizClockMode = DEFAULT_CLOCK_MODE
    is_playing: bool = True
    tick_index: int = Field(default=0, ge=0)
    tick_ns: int = Field(default=0, ge=0)
    playback_rate: float = Field(default=1.0, gt=0.0)
    capabilities: RosVizRuntimeCapabilities = Field(default_factory=RosVizRuntimeCapabilities)
    updated_at_ms: int = Field(..., ge=0)


class RosVizClockControlRequest(BaseModel):
    mode: RosVizClockMode | None = None
    is_playing: bool | None = None
    step_ticks: int = Field(default=0, ge=0, le=10_000)
    seek_tick_index: int | None = Field(default=None, ge=0)
    playback_rate: float | None = Field(default=None, gt=0.0, le=8.0)


class RosVizClockState(BaseModel):
    session_id: str = Field(..., min_length=1)
    mode: RosVizClockMode = DEFAULT_CLOCK_MODE
    is_playing: bool = True
    tick_index: int = Field(default=0, ge=0)
    tick_ns: int = Field(default=0, ge=0)
    playback_rate: float = Field(default=1.0, gt=0.0)
    data_source: RosVizDataSource = "live_ros"
    session_mode: RosVizSessionMode = "live_debug"
    can_control: bool = False
    updated_at_ms: int = Field(..., ge=0)


class RosVizTopicCatalogResponse(BaseModel):
    session_id: str = Field(..., min_length=1)
    topics: list[RosVizTopicInfo] = Field(default_factory=list)


class RosVizSubscriptionRequest(BaseModel):
    topic_ids: list[int] = Field(default_factory=list, max_length=MAX_TOPIC_SUBSCRIPTIONS)
    include_clock: bool = True


class RosVizSubscriptionResponse(BaseModel):
    session_id: str = Field(..., min_length=1)
    subscribed_topic_ids: list[int] = Field(default_factory=list)
    include_clock: bool = True


class RosVizClockTick(BaseModel):
    mode: RosVizClockMode = DEFAULT_CLOCK_MODE
    t_ns: int = Field(..., ge=0)
    tick_index: int = Field(default=0, ge=0)


class RosVizResolvedFramePose(BaseModel):
    robot_id: str = Field(..., min_length=1)
    frame_id: str = Field(..., min_length=1)
    parent_frame_id: str = Field(..., min_length=1)
    translation_xyz: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0], min_length=3, max_length=3)
    quaternion_xyzw: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0, 1.0], min_length=4, max_length=4)


class RosVizResolvedFramePoseBatch(BaseModel):
    fixed_frame: str = Field(default=DEFAULT_FIXED_FRAME, min_length=1)
    t_ns: int = Field(..., ge=0)
    pose_hash: str = Field(default="", min_length=0)
    poses: list[RosVizResolvedFramePose] = Field(
        default_factory=lambda: [
            RosVizResolvedFramePose(
                robot_id="robot_0",
                frame_id=DEFAULT_FRAME_ID_BASE_LINK,
                parent_frame_id=DEFAULT_PARENT_WORLD,
            ),
            RosVizResolvedFramePose(
                robot_id="robot_0",
                frame_id=DEFAULT_FRAME_ID_TOOL0,
                parent_frame_id=DEFAULT_PARENT_BASE,
                translation_xyz=[0.0, 0.0, 0.25],
            ),
        ]
    )


class RosVizMarker(BaseModel):
    namespace: str = Field(..., min_length=1)
    marker_id: int = Field(..., ge=0)
    frame_id: str = Field(..., min_length=1)
    marker_type: Literal["sphere", "cube", "line_strip"] = "sphere"
    pose_position_xyz: list[float] = Field(
        default_factory=lambda: [0.0, 0.0, 0.0],
        min_length=3,
        max_length=3,
    )
    pose_quaternion_xyzw: list[float] = Field(
        default_factory=lambda: [0.0, 0.0, 0.0, 1.0],
        min_length=4,
        max_length=4,
    )
    scale_xyz: list[float] = Field(
        default_factory=lambda: [0.03, 0.03, 0.03],
        min_length=3,
        max_length=3,
    )
    color_rgba: list[float] = Field(
        default_factory=lambda: [0.2, 0.7, 1.0, 1.0],
        min_length=4,
        max_length=4,
    )
    points_xyz: list[list[float]] = Field(default_factory=list)
    lifetime_ms: int = Field(default=0, ge=0)


class RosVizMarkerDelta(BaseModel):
    action: Literal["add_or_modify", "delete", "delete_all"] = "add_or_modify"
    namespace: str = Field(default="default", min_length=1)
    marker_id: int | None = Field(default=None, ge=0)
    marker: RosVizMarker | None = None


class RosVizMarkerDeltaBatch(BaseModel):
    fixed_frame: str = Field(default=DEFAULT_FIXED_FRAME, min_length=1)
    t_ns: int = Field(..., ge=0)
    deltas: list[RosVizMarkerDelta] = Field(default_factory=list)


class RosVizDiagnosticEvent(BaseModel):
    code: str = Field(..., min_length=1)
    severity: Literal["info", "warning", "error"] = "info"
    message: str = Field(..., min_length=1)
    details: dict[str, str] = Field(default_factory=dict)
