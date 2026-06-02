from __future__ import annotations

from pydantic import BaseModel, Field

from backend.services.cam_to_sim_params import (
    CAM_TO_SIM_DEFAULT_DEVICE_LABEL,
    CAM_TO_SIM_DEFAULT_STREAM_SOURCE,
    CAM_TO_SIM_DEVICE_LABEL_MAX_LENGTH,
    CAM_TO_SIM_STREAM_NOTE_MAX_LENGTH,
    CAM_TO_SIM_STREAM_SOURCE_MAX_LENGTH,
    CAM_TO_SIM_VIDEO_STREAM_URL_MAX_LENGTH,
)


class CamToSimSessionCreateRequest(BaseModel):
    device_label: str = Field(
        default=CAM_TO_SIM_DEFAULT_DEVICE_LABEL,
        min_length=1,
        max_length=CAM_TO_SIM_DEVICE_LABEL_MAX_LENGTH,
    )
    public_base_url: str | None = Field(default=None, min_length=1, max_length=512)


class CamToSimReferenceSyncSummary(BaseModel):
    synced_at_iso: str = Field(..., min_length=1)
    source_root: str = Field(..., min_length=1)
    destination_root: str = Field(..., min_length=1)
    copied_paths: list[str] = Field(default_factory=list)
    missing_paths: list[str] = Field(default_factory=list)


class CamToSimSessionSnapshot(BaseModel):
    session_id: str = Field(..., min_length=1)
    created_at_iso: str = Field(..., min_length=1)
    device_label: str = Field(..., min_length=1)
    connect_url: str = Field(..., min_length=1)
    ingest_stream_url: str = Field(..., min_length=1)
    qr_image_url: str = Field(..., min_length=1)
    reference_sync: CamToSimReferenceSyncSummary


class CamToSimStreamIngestRequest(BaseModel):
    video_stream_url: str = Field(..., min_length=1, max_length=CAM_TO_SIM_VIDEO_STREAM_URL_MAX_LENGTH)
    source: str = Field(
        default=CAM_TO_SIM_DEFAULT_STREAM_SOURCE,
        min_length=1,
        max_length=CAM_TO_SIM_STREAM_SOURCE_MAX_LENGTH,
    )
    note: str | None = Field(default=None, max_length=CAM_TO_SIM_STREAM_NOTE_MAX_LENGTH)


class CamToSimStreamRecord(BaseModel):
    stream_id: str = Field(..., min_length=1)
    received_at_iso: str = Field(..., min_length=1)
    video_stream_url: str = Field(..., min_length=1)
    source: str = Field(..., min_length=1)
    note: str | None = None


class CamToSimStreamIngestResponse(BaseModel):
    session_id: str = Field(..., min_length=1)
    accepted_count: int = Field(..., ge=0)
    last_stream: CamToSimStreamRecord
    workflow_command_preview: str = Field(..., min_length=1)


class CamToSimNetworkGuessResponse(BaseModel):
    detected_ip: str | None = None
    candidates: list[str] = Field(default_factory=list)


class CamToSimStaticWorldTestRunRequest(BaseModel):
    world_layout_label: str = Field(..., min_length=1, max_length=256)
    world_layout_url: str | None = Field(default=None, max_length=4096)
    camera_count: int = Field(default=0, ge=0)
    camera_pose_defined: bool = False


class CamToSimStaticWorldTestRunResponse(BaseModel):
    run_id: str = Field(..., min_length=1)
    created_at_iso: str = Field(..., min_length=1)
    world_layout_label: str = Field(..., min_length=1)
    camera_count: int = Field(..., ge=0)
    camera_pose_defined: bool = False
    ready_for_static_world_checks: bool = False
    ready_for_full_runtime: bool = False
    notes: list[str] = Field(default_factory=list)


class CamToSimGeometryMeshRunRequest(BaseModel):
    mode: str = Field(default="live_capture", min_length=1, max_length=32)
    session_id: str | None = Field(default=None, min_length=1)
    world_layout_label: str | None = Field(default=None, max_length=256)
    reconstruction_mode: str = Field(default="proxy_geometry", min_length=1, max_length=32)
    prioritize_primitives: bool = True
    ignore_textures: bool = True
    object_families: list[str] = Field(default_factory=lambda: ["cube", "sphere", "box", "mug"])


class CamToSimGeometryMeshExecuteRequest(BaseModel):
    session_id: str | None = Field(default=None, min_length=1)
    force: bool = False


class CamToSimGeometryMeshRunResponse(BaseModel):
    job_id: str = Field(..., min_length=1)
    created_at_iso: str = Field(..., min_length=1)
    mode: str = Field(..., min_length=1)
    status: str = Field(..., min_length=1)
    session_id: str | None = None
    world_layout_label: str | None = None
    reconstruction_mode: str = Field(default="proxy_geometry", min_length=1)
    geometry_job_dir: str = Field(..., min_length=1)
    report_path: str = Field(..., min_length=1)
    config_path: str = Field(..., min_length=1)
    ready_for_geometry_reconstruction: bool = False
    ready_for_r2r2r_parity: bool = False
    stack_mode_detected: bool = False
    stack_support_edges_count: int = Field(default=0, ge=0)
    occlusion_completion_mode: str | None = None
    support_hierarchy_nodes_count: int = Field(default=0, ge=0)
    contact_constraints_count: int = Field(default=0, ge=0)
    contact_inference_enabled: bool = False
    dominant_capture_scenario: str | None = None
    executed_in_ui: bool = False
    completed_at_iso: str | None = None
    result_path: str | None = None
    proxy_urdf_path: str | None = None
    proxy_count: int = Field(default=0, ge=0)
    proxy_objects: list[dict[str, object]] = Field(default_factory=list)
    support_hierarchy: list[dict[str, object]] = Field(default_factory=list)
    contact_constraints: list[dict[str, object]] = Field(default_factory=list)
    exact_mesh_ready: bool = False
    exact_mesh_requirements_missing: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    command_hints: list[str] = Field(default_factory=list)


class CamToSimPhoneFrameResponse(BaseModel):
    session_id: str = Field(..., min_length=1)
    frame_id: str = Field(..., min_length=1)
    frame_count: int = Field(..., ge=0)
    received_at_iso: str = Field(..., min_length=1)


class CamToSimPhoneFrameStatsResponse(BaseModel):
    session_id: str = Field(..., min_length=1)
    frame_count: int = Field(..., ge=0)
    last_received_at_iso: str | None = None
    latest_source: str | None = None
    latest_client_time_ms: int | None = Field(default=None, ge=0)
    ingest_fps: float = Field(default=0.0, ge=0.0)
    approx_latency_ms: int | None = Field(default=None, ge=0)
    dropped_frames_estimate: int = Field(default=0, ge=0)
    latest_capture_interval_ms: int | None = Field(default=None, ge=1)
    latest_jpeg_quality: float | None = Field(default=None, ge=0.0, le=1.0)
    latest_max_width_px: int | None = Field(default=None, ge=1)
    has_orientation_data: bool = False
    has_motion_data: bool = False
    has_pose_data: bool = False
    has_depth_data: bool = False
    has_intrinsics_data: bool = False
    has_calibrated_intrinsics_data: bool = False
    has_imu_data: bool = False
    capture_profile: str | None = None


class CamToSimR2R2RPrepareResponse(BaseModel):
    session_id: str = Field(..., min_length=1)
    frame_count: int = Field(..., ge=0)
    export_dir: str = Field(..., min_length=1)
    frames_dir: str = Field(..., min_length=1)
    poses_path: str = Field(..., min_length=1)
    frames_manifest_path: str | None = None
    intrinsics_path: str | None = None
    imu_path: str | None = None
    depth_path: str | None = None
    readiness_path: str | None = None
    manifest_path: str = Field(..., min_length=1)
    reference_root: str = Field(..., min_length=1)
    ready_for_real_to_sim: bool = False
    ready_for_r2r2r_parity: bool = False
    has_pose_data: bool = False
    has_depth_data: bool = False
    has_intrinsics_data: bool = False
    has_calibrated_intrinsics_data: bool = False
    has_imu_data: bool = False
    command_hints: list[str] = Field(default_factory=list)


class CamToSimCaptureReadinessResponse(BaseModel):
    session_id: str = Field(..., min_length=1)
    frame_count: int = Field(..., ge=0)
    has_rgb_frames: bool = False
    has_pose_data: bool = False
    has_depth_data: bool = False
    has_intrinsics_data: bool = False
    has_calibrated_intrinsics_data: bool = False
    has_imu_data: bool = False
    capture_profiles: list[str] = Field(default_factory=list)
    ready_for_real_to_sim: bool = False
    ready_for_r2r2r_parity: bool = False
    missing_requirements: list[str] = Field(default_factory=list)
    recommended_capture_notes: list[str] = Field(default_factory=list)


class CamToSimCaptureCoachTargetSummary(BaseModel):
    target_id: str = Field(..., min_length=1)
    target_label: str = Field(..., min_length=1)
    primitive_family: str | None = None
    frame_count: int = Field(..., ge=0)
    coverage_score: int = Field(..., ge=0, le=100)
    yaw_range_deg: float = Field(..., ge=0.0)
    pitch_range_deg: float = Field(..., ge=0.0)
    ready: bool = False


class CamToSimCaptureCoachResponse(BaseModel):
    session_id: str = Field(..., min_length=1)
    frame_count: int = Field(..., ge=0)
    capture_scenario: str = Field(default="multi_objects", min_length=1)
    coverage_score: int = Field(..., ge=0, le=100)
    yaw_range_deg: float = Field(..., ge=0.0)
    pitch_range_deg: float = Field(..., ge=0.0)
    active_target_id: str | None = None
    active_target_label: str | None = None
    target_frame_count: int = Field(default=0, ge=0)
    completed_targets: int = Field(default=0, ge=0)
    ready_for_processing: bool = False
    status_label: str = Field(..., min_length=1)
    guidance: list[str] = Field(default_factory=list)
    targets: list[CamToSimCaptureCoachTargetSummary] = Field(default_factory=list)


class CamToSimRuntimePreviewFrame(BaseModel):
    filename: str = Field(..., min_length=1)
    image_url: str = Field(..., min_length=1)
    received_at_iso: str | None = None


class CamToSimRuntimeResultResponse(BaseModel):
    session_id: str = Field(..., min_length=1)
    frame_count: int = Field(..., ge=0)
    duration_seconds: float = Field(..., ge=0.0)
    has_pose_data: bool = False
    has_depth_data: bool = False
    yaw_range_deg: float | None = None
    pitch_range_deg: float | None = None
    roll_range_deg: float | None = None
    preview_frames: list[CamToSimRuntimePreviewFrame] = Field(default_factory=list)
