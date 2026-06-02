from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
from fastapi import HTTPException

import backend.services.cam_to_sim as cam_to_sim_module

from backend.models.cam_to_sim import (
    CamToSimGeometryMeshRunRequest,
    CamToSimSessionCreateRequest,
    CamToSimStaticWorldTestRunRequest,
    CamToSimStreamIngestRequest,
)
from backend.services.cam_to_sim import CamToSimService
from backend.services.cam_to_sim_params import (
    CAM_TO_SIM_REFERENCE_COPY_DIRS,
    CAM_TO_SIM_REFERENCE_COPY_FILES,
    CAM_TO_SIM_REFERENCE_DIRNAME,
    CAM_TO_SIM_R2R2R_REFERENCE_DIRNAME,
    CAM_TO_SIM_R2R2R_EXPORT_DIRNAME,
    CAM_TO_SIM_R2R2R_EXPORT_MANIFEST_FILENAME,
    CAM_TO_SIM_R2R2R_EXPORT_POSES_FILENAME,
    CAM_TO_SIM_PHONE_FRAMES_FILENAME,
    CAM_TO_SIM_SESSIONS_DIRNAME,
    CAM_TO_SIM_SESSION_METADATA_FILENAME,
    CAM_TO_SIM_STREAMS_FILENAME,
)

TEST_BASE_URL = "http://127.0.0.1:8000"
TEST_DEVICE_LABEL = "phone"
TEST_VIDEO_STREAM_URL = "https://example.com/stream.mp4"
EXPECTED_SINGLE_STREAM = 1
HTTP_NOT_FOUND = 404
HTTP_REQUEST_ENTITY_TOO_LARGE = 413
TEST_PHONE_FRAME_PAYLOAD = b"fakejpegpayload"
TEST_PHONE_FRAME_CONTENT_TYPE = "image/jpeg"
TEST_PHONE_FRAME_METADATA = {
    "capture_profile": "qr-web-lite",
    "client_time_ms": 123456789,
    "stream_tuning": {
        "capture_interval_ms": 95,
        "jpeg_quality": 0.68,
        "max_width_px": 680,
    },
    "orientation": {"alpha": 1.0, "beta": 2.0, "gamma": 3.0, "absolute": True},
    "motion": {"interval_ms": 16},
    "imu": {"orientation": {"alpha": 1.0}, "motion": {"interval_ms": 16}},
    "camera_intrinsics": {
        "fx_px": 640.0,
        "fy_px": 640.0,
        "cx_px": 320.0,
        "cy_px": 240.0,
        "estimated": False,
    },
    "pose": {"yaw_deg": 1.0, "pitch_deg": 2.0, "roll_deg": 3.0},
    "depth": {"available": False},
}


def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _build_reference_repo(reference_root: Path) -> None:
    for relative_dir in CAM_TO_SIM_REFERENCE_COPY_DIRS:
        _write_text(reference_root / relative_dir / "placeholder.txt", "reference content")
    for relative_file in CAM_TO_SIM_REFERENCE_COPY_FILES:
        _write_text(reference_root / relative_file, "reference file")


def test_create_session_syncs_reference_code_and_persists_metadata() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )

        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )

        reference_target_root = cam_repo_root / CAM_TO_SIM_REFERENCE_DIRNAME / CAM_TO_SIM_R2R2R_REFERENCE_DIRNAME
        assert snapshot.session_id
        assert snapshot.device_label == TEST_DEVICE_LABEL
        assert snapshot.reference_sync.missing_paths == []
        assert snapshot.qr_image_url.startswith("data:image/svg+xml")
        assert snapshot.reference_sync.source_root == "real2render2real"
        assert snapshot.reference_sync.destination_root == "reference/real2render2real"
        assert (reference_target_root / "scripts").exists()
        assert (
            cam_repo_root
            / CAM_TO_SIM_SESSIONS_DIRNAME
            / snapshot.session_id
            / CAM_TO_SIM_SESSION_METADATA_FILENAME
        ).exists()


def test_run_static_world_test_allows_undefined_camera_pose() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )

        result = service.run_static_world_test(
            CamToSimStaticWorldTestRunRequest(
                world_layout_label="test-world.json",
                camera_count=1,
                camera_pose_defined=False,
            )
        )
        assert result.world_layout_label == "test-world.json"
        assert result.ready_for_static_world_checks is True
        assert result.ready_for_full_runtime is False
        assert any("pose undefined" in note for note in result.notes)


def test_run_geometry_mesh_job_static_world_stages_job() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        result = service.run_geometry_mesh_job(
            CamToSimGeometryMeshRunRequest(
                mode="static_world_test",
                world_layout_label="test-world.json",
                object_families=["cube", "box"],
            )
        )
        assert result.mode == "static_world_test"
        assert result.status == "staged_static_world"
        assert result.ready_for_geometry_reconstruction is True
        assert result.ready_for_r2r2r_parity is False
        assert result.contact_constraints_count == 0
        assert result.support_hierarchy_nodes_count == 0
        assert result.contact_inference_enabled is False
        assert Path(result.report_path).is_absolute() is False
        assert (cam_repo_root / result.report_path).exists()
        assert (cam_repo_root / result.config_path).exists()


def test_execute_geometry_mesh_job_includes_proxy_objects() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        staged = service.run_geometry_mesh_job(
            CamToSimGeometryMeshRunRequest(
                mode="static_world_test",
                world_layout_label="test-world.json",
                object_families=["cube", "sphere", "box", "mug"],
            )
        )

        executed = service.execute_geometry_mesh_job(job_id=staged.job_id)
        assert executed.executed_in_ui is True
        assert executed.status.startswith("completed")
        assert executed.proxy_count > 0
        assert len(executed.proxy_objects) == executed.proxy_count
        assert isinstance(executed.support_hierarchy, list)
        assert isinstance(executed.contact_constraints, list)
        assert executed.proxy_urdf_path is not None
        assert Path(executed.proxy_urdf_path).is_absolute() is False
        assert (cam_repo_root / executed.proxy_urdf_path).exists()


def test_register_stream_appends_stream_payload() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )

        response = service.register_stream(
            snapshot.session_id,
            CamToSimStreamIngestRequest(video_stream_url=TEST_VIDEO_STREAM_URL, source=TEST_DEVICE_LABEL),
        )

        streams_file = (
            cam_repo_root
            / CAM_TO_SIM_SESSIONS_DIRNAME
            / snapshot.session_id
            / CAM_TO_SIM_STREAMS_FILENAME
        )
        payload = json.loads(streams_file.read_text(encoding="utf-8"))
        assert response.accepted_count == EXPECTED_SINGLE_STREAM
        assert payload[0]["video_stream_url"] == TEST_VIDEO_STREAM_URL
        assert response.workflow_command_preview.startswith("python reference/real2render2real/scripts/run.py")
        assert str(cam_repo_root) not in response.workflow_command_preview


def test_get_session_raises_404_for_unknown_session() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        with pytest.raises(HTTPException) as error:
            service.get_session("missing-session")

        assert error.value.status_code == HTTP_NOT_FOUND


def test_register_phone_frame_persists_frame_manifest() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )

        response = service.register_phone_frame(
            snapshot.session_id,
            frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
            content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
            source="phone-camera",
            frame_metadata=TEST_PHONE_FRAME_METADATA,
        )

        frames_manifest_path = (
            cam_repo_root
            / CAM_TO_SIM_SESSIONS_DIRNAME
            / snapshot.session_id
            / CAM_TO_SIM_PHONE_FRAMES_FILENAME
        )
        manifest_payload = json.loads(frames_manifest_path.read_text(encoding="utf-8"))
        assert response.frame_count == EXPECTED_SINGLE_STREAM
        assert manifest_payload[0]["content_type"] == TEST_PHONE_FRAME_CONTENT_TYPE
        assert manifest_payload[0]["metadata"]["client_time_ms"] == TEST_PHONE_FRAME_METADATA["client_time_ms"]


def test_get_phone_frame_stats_returns_latest_metadata() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )
        service.register_phone_frame(
            snapshot.session_id,
            frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
            content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
            source="phone-camera",
            frame_metadata=TEST_PHONE_FRAME_METADATA,
        )

        stats = service.get_phone_frame_stats(snapshot.session_id)
        assert stats.frame_count == EXPECTED_SINGLE_STREAM
        assert stats.latest_source == "phone-camera"
        assert isinstance(stats.last_received_at_iso, str)
        assert stats.latest_client_time_ms == 123456789
        assert stats.latest_capture_interval_ms == 95
        assert stats.latest_jpeg_quality == 0.68
        assert stats.latest_max_width_px == 680
        assert stats.has_orientation_data is True
        assert stats.has_motion_data is True
        assert stats.has_pose_data is True
        assert stats.has_depth_data is False
        assert stats.has_intrinsics_data is True
        assert stats.has_calibrated_intrinsics_data is True
        assert stats.has_imu_data is True
        assert stats.capture_profile == "qr-web-lite"
        assert stats.ingest_fps >= 0.0
        assert stats.dropped_frames_estimate >= 0


def test_get_phone_frame_stats_estimates_dropped_sequences() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )

        metadata_seq_1 = json.loads(json.dumps(TEST_PHONE_FRAME_METADATA))
        metadata_seq_1["frame_sequence"] = 1
        metadata_seq_3 = json.loads(json.dumps(TEST_PHONE_FRAME_METADATA))
        metadata_seq_3["frame_sequence"] = 3

        service.register_phone_frame(
            snapshot.session_id,
            frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
            content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
            source="phone-camera",
            frame_metadata=metadata_seq_1,
        )
        service.register_phone_frame(
            snapshot.session_id,
            frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
            content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
            source="phone-camera",
            frame_metadata=metadata_seq_3,
        )

        stats = service.get_phone_frame_stats(snapshot.session_id)
        assert stats.dropped_frames_estimate >= 1


def test_get_capture_readiness_highlights_missing_depth() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )
        service.register_phone_frame(
            snapshot.session_id,
            frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
            content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
            source="phone-camera",
            frame_metadata=TEST_PHONE_FRAME_METADATA,
        )

        readiness = service.get_capture_readiness(snapshot.session_id)
        assert readiness.has_rgb_frames is True
        assert readiness.has_intrinsics_data is True
        assert readiness.has_pose_data is True
        assert readiness.ready_for_real_to_sim is True
        assert readiness.ready_for_r2r2r_parity is False
        assert "depth_data" in readiness.missing_requirements


def test_get_capture_coach_returns_guidance() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )
        service.register_phone_frame(
            snapshot.session_id,
            frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
            content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
            source="phone-camera",
            frame_metadata=TEST_PHONE_FRAME_METADATA,
        )

        coach = service.get_capture_coach(snapshot.session_id)
        assert coach.frame_count == 1
        assert isinstance(coach.coverage_score, int)
        assert len(coach.guidance) > 0


def test_get_capture_coach_groups_frames_by_capture_target_id() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )

        metadata_object_1 = json.loads(json.dumps(TEST_PHONE_FRAME_METADATA))
        metadata_object_1["capture_target"] = {
            "id": "object_1",
            "label": "Object 1",
            "index": 0,
        }
        metadata_object_2 = json.loads(json.dumps(TEST_PHONE_FRAME_METADATA))
        metadata_object_2["capture_target"] = {
            "id": "object_2",
            "label": "Mug",
            "index": 1,
        }

        service.register_phone_frame(
            snapshot.session_id,
            frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
            content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
            source="phone-camera",
            frame_metadata=metadata_object_1,
        )
        service.register_phone_frame(
            snapshot.session_id,
            frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
            content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
            source="phone-camera",
            frame_metadata=metadata_object_2,
        )

        coach = service.get_capture_coach(snapshot.session_id)
        target_ids = {target.target_id for target in coach.targets}
        assert "object_1" in target_ids
        assert "object_2" in target_ids
        assert coach.active_target_id == "object_2"


def test_get_capture_coach_preserves_target_family_from_metadata() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )

        mug_metadata = json.loads(json.dumps(TEST_PHONE_FRAME_METADATA))
        mug_metadata["capture_target"] = {
            "id": "object_1",
            "label": "Mug",
            "family": "mug",
            "primitive_family": "mug",
            "index": 0,
        }
        service.register_phone_frame(
            snapshot.session_id,
            frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
            content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
            source="phone-camera",
            frame_metadata=mug_metadata,
        )

        coach = service.get_capture_coach(snapshot.session_id)
        assert len(coach.targets) == 1
        assert coach.targets[0].primitive_family == "mug"


def test_run_geometry_mesh_job_exact_mode_blocks_without_depth() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )
        service.register_phone_frame(
            snapshot.session_id,
            frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
            content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
            source="phone-camera",
            frame_metadata=TEST_PHONE_FRAME_METADATA,
        )
        result = service.run_geometry_mesh_job(
            CamToSimGeometryMeshRunRequest(
                mode="live_capture",
                reconstruction_mode="exact_mesh",
                session_id=snapshot.session_id,
            )
        )
        assert result.reconstruction_mode == "exact_mesh"
        assert result.exact_mesh_ready is False
        assert "depth_data" in result.exact_mesh_requirements_missing
        assert result.status == "blocked_missing_exact_signals"


def test_prepare_r2r2r_export_writes_manifest_and_poses() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )
        service.register_phone_frame(
            snapshot.session_id,
            frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
            content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
            source="phone-camera",
            frame_metadata=TEST_PHONE_FRAME_METADATA,
        )

        prepared = service.prepare_r2r2r_export(snapshot.session_id)
        export_dir = (
            cam_repo_root
            / CAM_TO_SIM_SESSIONS_DIRNAME
            / snapshot.session_id
            / CAM_TO_SIM_R2R2R_EXPORT_DIRNAME
        )
        assert prepared.frame_count == EXPECTED_SINGLE_STREAM
        assert prepared.ready_for_real_to_sim is True
        assert prepared.has_intrinsics_data is True
        assert prepared.has_imu_data is True
        assert prepared.ready_for_r2r2r_parity is False
        assert Path(prepared.export_dir).is_absolute() is False
        assert (cam_repo_root / prepared.export_dir).exists()
        assert (cam_repo_root / prepared.manifest_path).exists()
        assert (cam_repo_root / prepared.poses_path).exists()
        assert (export_dir / CAM_TO_SIM_R2R2R_EXPORT_MANIFEST_FILENAME).exists()
        assert (export_dir / CAM_TO_SIM_R2R2R_EXPORT_POSES_FILENAME).exists()


def test_build_runtime_result_returns_preview_frames() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )
        for _index in range(3):
            service.register_phone_frame(
                snapshot.session_id,
                frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
                content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
                source="phone-camera",
                frame_metadata=TEST_PHONE_FRAME_METADATA,
            )

        runtime_result = service.build_runtime_result(snapshot.session_id)
        assert runtime_result.frame_count == 3
        assert runtime_result.has_pose_data is True
        assert len(runtime_result.preview_frames) == 3


def test_reset_phone_frames_clears_manifest_and_export() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )
        service.register_phone_frame(
            snapshot.session_id,
            frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
            content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
            source="phone-camera",
            frame_metadata=TEST_PHONE_FRAME_METADATA,
        )
        service.prepare_r2r2r_export(snapshot.session_id)

        stats_after_reset = service.reset_phone_frames(snapshot.session_id)
        export_dir = (
            cam_repo_root
            / CAM_TO_SIM_SESSIONS_DIRNAME
            / snapshot.session_id
            / CAM_TO_SIM_R2R2R_EXPORT_DIRNAME
        )
        assert stats_after_reset.frame_count == 0
        assert stats_after_reset.last_received_at_iso is None
        assert export_dir.exists() is False


def test_register_stream_rejects_excessive_stream_records(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cam_to_sim_module, "CAM_TO_SIM_MAX_STREAM_RECORDS_PER_SESSION", 1)
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )
        service.register_stream(
            snapshot.session_id,
            CamToSimStreamIngestRequest(video_stream_url=TEST_VIDEO_STREAM_URL, source=TEST_DEVICE_LABEL),
        )

        with pytest.raises(HTTPException) as error:
            service.register_stream(
                snapshot.session_id,
                CamToSimStreamIngestRequest(video_stream_url=TEST_VIDEO_STREAM_URL, source=TEST_DEVICE_LABEL),
            )

        assert error.value.status_code == HTTP_REQUEST_ENTITY_TOO_LARGE


def test_register_phone_frame_rejects_session_frame_count_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cam_to_sim_module, "CAM_TO_SIM_MAX_PHONE_FRAMES_PER_SESSION", 1)
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )
        service.register_phone_frame(
            snapshot.session_id,
            frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
            content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
            source="phone-camera",
            frame_metadata=TEST_PHONE_FRAME_METADATA,
        )

        with pytest.raises(HTTPException) as error:
            service.register_phone_frame(
                snapshot.session_id,
                frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
                content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
                source="phone-camera",
                frame_metadata=TEST_PHONE_FRAME_METADATA,
            )

        assert error.value.status_code == HTTP_REQUEST_ENTITY_TOO_LARGE


def test_register_phone_frame_rejects_session_total_bytes_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        cam_to_sim_module,
        "CAM_TO_SIM_MAX_PHONE_FRAME_TOTAL_BYTES",
        len(TEST_PHONE_FRAME_PAYLOAD),
    )
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )
        service.register_phone_frame(
            snapshot.session_id,
            frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
            content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
            source="phone-camera",
            frame_metadata=TEST_PHONE_FRAME_METADATA,
        )

        with pytest.raises(HTTPException) as error:
            service.register_phone_frame(
                snapshot.session_id,
                frame_bytes=TEST_PHONE_FRAME_PAYLOAD,
                content_type=TEST_PHONE_FRAME_CONTENT_TYPE,
                source="phone-camera",
                frame_metadata=TEST_PHONE_FRAME_METADATA,
            )

        assert error.value.status_code == HTTP_REQUEST_ENTITY_TOO_LARGE


def test_execute_geometry_mesh_job_requires_session_id_for_live_capture() -> None:
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        cam_repo_root = temp_root / "cam-to-sim"
        reference_repo_root = temp_root / "real2render2real"
        cam_repo_root.mkdir(parents=True, exist_ok=True)
        _build_reference_repo(reference_repo_root)

        service = CamToSimService(
            cam_to_sim_repo_dir=cam_repo_root,
            real2render2real_repo_dir=reference_repo_root,
        )
        snapshot = service.create_session(
            CamToSimSessionCreateRequest(device_label=TEST_DEVICE_LABEL),
            base_url=TEST_BASE_URL,
        )
        staged = service.run_geometry_mesh_job(
            CamToSimGeometryMeshRunRequest(
                mode="live_capture",
                session_id=snapshot.session_id,
            )
        )

        with pytest.raises(HTTPException) as error:
            service.execute_geometry_mesh_job(job_id=staged.job_id)

        assert error.value.status_code == 422
        assert error.value.detail == "session_id is required for live-capture geometry jobs."
