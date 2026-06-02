from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import app
from backend.api.cam_to_sim import _resolve_public_base_url
from backend.core.simulator_security import (
    CAM_TO_SIM_PROXY_TOKEN_HEADER,
    RUNTIME_SESSION_TOKEN_HEADER,
    SIMULATOR_TOKEN_HEADER,
)
from backend.models.cam_to_sim import (
    CamToSimCaptureCoachResponse,
    CamToSimCaptureReadinessResponse,
    CamToSimGeometryMeshRunResponse,
    CamToSimPhoneFrameStatsResponse,
    CamToSimR2R2RPrepareResponse,
    CamToSimReferenceSyncSummary,
    CamToSimRuntimePreviewFrame,
    CamToSimRuntimeResultResponse,
    CamToSimSessionSnapshot,
    CamToSimStaticWorldTestRunResponse,
    CamToSimStreamRecord,
    CamToSimStreamIngestResponse,
)


TEST_BASE_LOOPBACK = "http://127.0.0.1:8000"
TEST_BASE_LAN = "http://192.168.1.44:8000"
TEST_DISCOVERED_LAN_IP = "192.168.1.50"
TEST_CONFIGURED_PUBLIC_BASE_URL = "https://public.example.com"
TEST_SIMULATOR_TOKEN = "sim-token"
TEST_PROXY_TOKEN = "proxy-token"
TEST_SESSION_TOKEN = "session-token"
TEST_SESSION_ID = "session-123"
TEST_HOST_HEADER = "192.168.1.44:8000"


def _patch_simulator_settings(token: str | None = TEST_SIMULATOR_TOKEN):
    return patch(
        "backend.core.simulator_security.settings",
        SimpleNamespace(simulator_api_token=token, cam_to_sim_proxy_token=None),
    )


def _simulator_headers() -> dict[str, str]:
    return {SIMULATOR_TOKEN_HEADER: TEST_SIMULATOR_TOKEN}


def _session_headers() -> dict[str, str]:
    return {RUNTIME_SESSION_TOKEN_HEADER: TEST_SESSION_TOKEN}


def _session_snapshot() -> CamToSimSessionSnapshot:
    return CamToSimSessionSnapshot(
        session_id=TEST_SESSION_ID,
        created_at_iso="2026-02-20T12:00:00+00:00",
        device_label="phone",
        connect_url=(
            f"{TEST_CONFIGURED_PUBLIC_BASE_URL}/cam-to-sim/connect/{TEST_SESSION_ID}"
            f"?token={TEST_SESSION_TOKEN}"
        ),
        ingest_stream_url=(
            f"{TEST_CONFIGURED_PUBLIC_BASE_URL}/cam-to-sim/sessions/{TEST_SESSION_ID}/stream"
            f"?token={TEST_SESSION_TOKEN}"
        ),
        qr_image_url="data:image/svg+xml;charset=utf-8,<svg></svg>",
        reference_sync=CamToSimReferenceSyncSummary(
            synced_at_iso="2026-02-20T12:00:00+00:00",
            source_root="real2render2real",
            destination_root="reference/real2render2real",
        ),
    )


def test_resolve_public_base_url_uses_configured_override() -> None:
    resolved = _resolve_public_base_url(
        TEST_BASE_LOOPBACK,
        TEST_CONFIGURED_PUBLIC_BASE_URL,
    )
    assert resolved == TEST_CONFIGURED_PUBLIC_BASE_URL


def test_resolve_public_base_url_keeps_non_loopback_host() -> None:
    resolved = _resolve_public_base_url(TEST_BASE_LAN, None)
    assert resolved == TEST_BASE_LAN


def test_resolve_public_base_url_rewrites_loopback_to_lan_ip() -> None:
    with patch("backend.api.cam_to_sim._discover_lan_ip", return_value=TEST_DISCOVERED_LAN_IP):
        resolved = _resolve_public_base_url(TEST_BASE_LOOPBACK, None)
    assert resolved == f"http://{TEST_DISCOVERED_LAN_IP}:8000"


def test_resolve_public_base_url_keeps_loopback_without_discovery() -> None:
    with patch("backend.api.cam_to_sim._discover_lan_ip", return_value=None), patch(
        "backend.api.cam_to_sim._collect_socket_candidate_ips",
        return_value=[],
    ):
        resolved = _resolve_public_base_url(TEST_BASE_LOOPBACK, None)
    assert resolved == TEST_BASE_LOOPBACK


def test_network_guess_prefers_request_host_when_reachable_ip() -> None:
    client = TestClient(app)
    headers = _simulator_headers()
    headers["host"] = TEST_HOST_HEADER
    with _patch_simulator_settings(), patch(
        "backend.api.cam_to_sim._discover_lan_ip",
        return_value=None,
    ), patch(
        "backend.api.cam_to_sim._collect_socket_candidate_ips",
        return_value=[],
    ):
        response = client.get("/cam-to-sim/network/guess", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["detected_ip"] == "192.168.1.44"
    assert payload["candidates"] == ["192.168.1.44"]


def test_network_guess_filters_wsl_bridge_addresses() -> None:
    client = TestClient(app)
    headers = _simulator_headers()
    headers["host"] = "127.0.0.1:8000"
    with _patch_simulator_settings(), patch(
        "backend.api.cam_to_sim._is_wsl_environment",
        return_value=True,
    ), patch(
        "backend.api.cam_to_sim._discover_lan_ip",
        return_value="172.31.213.1",
    ), patch(
        "backend.api.cam_to_sim._collect_socket_candidate_ips",
        return_value=["172.31.213.1", "192.168.1.44"],
    ):
        response = client.get("/cam-to-sim/network/guess", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["detected_ip"] == "192.168.1.44"
    assert payload["candidates"] == ["192.168.1.44"]


def test_network_guess_rejects_remote_requests_without_operator_token() -> None:
    client = TestClient(app)
    with _patch_simulator_settings(None):
        response = client.get("/cam-to-sim/network/guess")

    assert response.status_code == 403
    assert "Remote simulator access is disabled" in response.json()["detail"]


def test_static_world_test_run_endpoint_returns_payload() -> None:
    client = TestClient(app)
    mocked_payload = CamToSimStaticWorldTestRunResponse(
        run_id="run-123",
        created_at_iso="2026-02-20T12:00:00+00:00",
        world_layout_label="test-world.json",
        camera_count=1,
        camera_pose_defined=False,
        ready_for_static_world_checks=True,
        ready_for_full_runtime=False,
        notes=["Static world uploaded and staged for test checks."],
    )
    with _patch_simulator_settings(), patch(
        "backend.api.cam_to_sim.cam_to_sim_service.run_static_world_test",
        return_value=mocked_payload,
    ):
        response = client.post(
            "/cam-to-sim/static-world-tests/run",
            headers=_simulator_headers(),
            json={
                "world_layout_label": "test-world.json",
                "camera_count": 1,
                "camera_pose_defined": False,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["run_id"] == "run-123"
    assert payload["ready_for_static_world_checks"] is True
    assert payload["ready_for_full_runtime"] is False


def test_geometry_mesh_job_endpoint_returns_payload() -> None:
    client = TestClient(app)
    mocked_payload = CamToSimGeometryMeshRunResponse(
        job_id="geom-job-123",
        created_at_iso="2026-02-20T12:10:00+00:00",
        mode="static_world_test",
        status="staged_static_world",
        session_id=None,
        world_layout_label="test-world.json",
        geometry_job_dir="geometry_jobs/static-geom-job-123",
        report_path="geometry_jobs/static-geom-job-123/geometry-job-report.json",
        config_path="geometry_jobs/static-geom-job-123/geometry-config.json",
        ready_for_geometry_reconstruction=True,
        ready_for_r2r2r_parity=False,
        notes=["Static-world geometry staging created."],
        command_hints=["# load static world objects and fit primitive geometry proxies (cube/sphere/box/mug)"],
    )
    with _patch_simulator_settings(), patch(
        "backend.api.cam_to_sim.cam_to_sim_service.run_geometry_mesh_job",
        return_value=mocked_payload,
    ):
        response = client.post(
            "/cam-to-sim/geometry-mesh-jobs/run",
            headers=_simulator_headers(),
            json={
                "mode": "static_world_test",
                "world_layout_label": "test-world.json",
                "prioritize_primitives": True,
                "ignore_textures": True,
                "object_families": ["cube", "box"],
            },
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["job_id"] == "geom-job-123"
    assert payload["ready_for_geometry_reconstruction"] is True


def test_phone_frame_stats_endpoint_returns_payload() -> None:
    client = TestClient(app)
    mocked_payload = CamToSimPhoneFrameStatsResponse(
        session_id=TEST_SESSION_ID,
        frame_count=7,
        last_received_at_iso="2026-02-19T10:00:00+00:00",
        latest_source="phone-camera",
        latest_client_time_ms=123456789,
        has_orientation_data=True,
        has_motion_data=True,
        has_pose_data=True,
        has_depth_data=False,
        has_intrinsics_data=True,
        has_calibrated_intrinsics_data=False,
        has_imu_data=True,
        capture_profile="qr-web-lite",
    )
    with _patch_simulator_settings(), patch(
        "backend.api.cam_to_sim.cam_to_sim_service.get_phone_frame_stats",
        return_value=mocked_payload,
    ):
        response = client.get(
            f"/cam-to-sim/sessions/{TEST_SESSION_ID}/phone-frame-stats",
            headers=_simulator_headers(),
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == TEST_SESSION_ID
    assert payload["frame_count"] == 7
    assert payload["has_pose_data"] is True


def test_prepare_r2r2r_endpoint_returns_payload() -> None:
    client = TestClient(app)
    mocked_payload = CamToSimR2R2RPrepareResponse(
        session_id=TEST_SESSION_ID,
        frame_count=7,
        export_dir=f"runtime_sessions/{TEST_SESSION_ID}/r2r2r_export",
        frames_dir=f"runtime_sessions/{TEST_SESSION_ID}/r2r2r_export/frames",
        poses_path=f"runtime_sessions/{TEST_SESSION_ID}/r2r2r_export/poses.jsonl",
        manifest_path=f"runtime_sessions/{TEST_SESSION_ID}/r2r2r_export/manifest.json",
        reference_root="reference/real2render2real",
        ready_for_real_to_sim=True,
        has_pose_data=True,
        has_depth_data=False,
        has_intrinsics_data=True,
        has_calibrated_intrinsics_data=False,
        has_imu_data=True,
        ready_for_r2r2r_parity=False,
        command_hints=["python scripts/run.py"],
    )
    with _patch_simulator_settings(), patch(
        "backend.api.cam_to_sim.cam_to_sim_service.prepare_r2r2r_export",
        return_value=mocked_payload,
    ):
        response = client.post(
            f"/cam-to-sim/sessions/{TEST_SESSION_ID}/r2r2r/prepare",
            headers=_simulator_headers(),
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == TEST_SESSION_ID
    assert payload["ready_for_real_to_sim"] is True


def test_capture_readiness_endpoint_returns_payload() -> None:
    client = TestClient(app)
    mocked_payload = CamToSimCaptureReadinessResponse(
        session_id=TEST_SESSION_ID,
        frame_count=7,
        has_rgb_frames=True,
        has_pose_data=True,
        has_depth_data=False,
        has_intrinsics_data=True,
        has_calibrated_intrinsics_data=False,
        has_imu_data=True,
        capture_profiles=["qr-web-lite"],
        ready_for_real_to_sim=True,
        ready_for_r2r2r_parity=False,
        missing_requirements=["depth_data", "calibrated_intrinsics"],
        recommended_capture_notes=["Use LiDAR-capable capture (ARKit/native app) to stream depth for full parity."],
    )
    with _patch_simulator_settings(), patch(
        "backend.api.cam_to_sim.cam_to_sim_service.get_capture_readiness",
        return_value=mocked_payload,
    ):
        response = client.get(
            f"/cam-to-sim/sessions/{TEST_SESSION_ID}/capture-readiness",
            headers=_simulator_headers(),
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == TEST_SESSION_ID
    assert payload["ready_for_real_to_sim"] is True
    assert payload["ready_for_r2r2r_parity"] is False


def test_capture_coach_endpoint_returns_payload() -> None:
    client = TestClient(app)
    mocked_payload = CamToSimCaptureCoachResponse(
        session_id=TEST_SESSION_ID,
        frame_count=24,
        coverage_score=68,
        yaw_range_deg=95.0,
        pitch_range_deg=22.0,
        ready_for_processing=True,
        status_label="Ready to process",
        guidance=["Coverage looks good. You can run processing now."],
    )
    with _patch_simulator_settings(None), patch(
        "backend.api.cam_to_sim.cam_to_sim_service.get_session_access_token",
        return_value=TEST_SESSION_TOKEN,
    ), patch(
        "backend.api.cam_to_sim.cam_to_sim_service.get_capture_coach",
        return_value=mocked_payload,
    ):
        response = client.get(
            f"/cam-to-sim/sessions/{TEST_SESSION_ID}/capture-coach",
            headers=_session_headers(),
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == TEST_SESSION_ID
    assert payload["coverage_score"] == 68


def test_runtime_result_endpoint_returns_payload() -> None:
    client = TestClient(app)
    mocked_payload = CamToSimRuntimeResultResponse(
        session_id=TEST_SESSION_ID,
        frame_count=8,
        duration_seconds=4.2,
        has_pose_data=True,
        has_depth_data=False,
        yaw_range_deg=24.0,
        pitch_range_deg=10.0,
        roll_range_deg=5.0,
        preview_frames=[
            CamToSimRuntimePreviewFrame(
                filename="frame_000001.jpg",
                image_url=f"/cam-to-sim/sessions/{TEST_SESSION_ID}/frames/frame_000001.jpg",
            )
        ],
    )
    with _patch_simulator_settings(), patch(
        "backend.api.cam_to_sim.cam_to_sim_service.build_runtime_result",
        return_value=mocked_payload,
    ):
        response = client.post(
            f"/cam-to-sim/sessions/{TEST_SESSION_ID}/runtime-result",
            headers=_simulator_headers(),
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == TEST_SESSION_ID
    assert payload["frame_count"] == 8


def test_reset_frames_endpoint_returns_payload() -> None:
    client = TestClient(app)
    mocked_payload = CamToSimPhoneFrameStatsResponse(
        session_id=TEST_SESSION_ID,
        frame_count=0,
        last_received_at_iso=None,
        latest_source=None,
        latest_client_time_ms=None,
        has_orientation_data=False,
        has_motion_data=False,
        has_pose_data=False,
        has_depth_data=False,
        has_intrinsics_data=False,
        has_calibrated_intrinsics_data=False,
        has_imu_data=False,
        capture_profile=None,
    )
    with _patch_simulator_settings(), patch(
        "backend.api.cam_to_sim.cam_to_sim_service.reset_phone_frames",
        return_value=mocked_payload,
    ):
        response = client.post(
            f"/cam-to-sim/sessions/{TEST_SESSION_ID}/reset-frames",
            headers=_simulator_headers(),
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == TEST_SESSION_ID
    assert payload["frame_count"] == 0


def test_connect_page_allows_valid_session_token_without_operator_token() -> None:
    client = TestClient(app)
    snapshot = _session_snapshot()
    with _patch_simulator_settings(None), patch(
        "backend.api.cam_to_sim.cam_to_sim_service.get_session_access_token",
        return_value=TEST_SESSION_TOKEN,
    ), patch(
        "backend.api.cam_to_sim.cam_to_sim_service.get_session",
        return_value=snapshot,
    ):
        response = client.get(f"/cam-to-sim/connect/{TEST_SESSION_ID}?token={TEST_SESSION_TOKEN}")

    assert response.status_code == 200
    assert f"token={TEST_SESSION_TOKEN}" in response.text
    assert "source=phone-camera" in response.text


def test_stream_endpoint_accepts_valid_session_token() -> None:
    client = TestClient(app)
    mocked_payload = CamToSimStreamIngestResponse(
        session_id=TEST_SESSION_ID,
        accepted_count=1,
        last_stream=CamToSimStreamRecord(
            stream_id="stream-123",
            received_at_iso="2026-02-20T12:00:00+00:00",
            video_stream_url="https://example.com/stream.mp4",
            source="phone",
        ),
        workflow_command_preview="python reference/real2render2real/scripts/run.py",
    )
    with _patch_simulator_settings(None), patch(
        "backend.api.cam_to_sim.cam_to_sim_service.get_session_access_token",
        return_value=TEST_SESSION_TOKEN,
    ), patch(
        "backend.api.cam_to_sim.cam_to_sim_service.register_stream",
        return_value=mocked_payload,
    ):
        response = client.post(
            f"/cam-to-sim/sessions/{TEST_SESSION_ID}/stream",
            headers=_session_headers(),
            json={
                "video_stream_url": "https://example.com/stream.mp4",
                "source": "phone",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["accepted_count"] == 1


def test_connect_page_requires_session_token_when_request_is_proxied() -> None:
    client = TestClient(app)
    snapshot = _session_snapshot()
    with patch(
        "backend.core.simulator_security.settings",
        SimpleNamespace(simulator_api_token=None, cam_to_sim_proxy_token=TEST_PROXY_TOKEN),
    ), patch(
        "backend.api.cam_to_sim.cam_to_sim_service.get_session_access_token",
        return_value=TEST_SESSION_TOKEN,
    ):
        response = client.get(
            f"/cam-to-sim/connect/{TEST_SESSION_ID}",
            headers={CAM_TO_SIM_PROXY_TOKEN_HEADER: TEST_PROXY_TOKEN},
        )

    assert response.status_code == 401
    assert "session token required" in response.json()["detail"].lower()


def test_connect_page_accepts_valid_session_token_when_request_is_proxied() -> None:
    client = TestClient(app)
    snapshot = _session_snapshot()
    with patch(
        "backend.core.simulator_security.settings",
        SimpleNamespace(simulator_api_token=None, cam_to_sim_proxy_token=TEST_PROXY_TOKEN),
    ), patch(
        "backend.api.cam_to_sim.cam_to_sim_service.get_session_access_token",
        return_value=TEST_SESSION_TOKEN,
    ), patch(
        "backend.api.cam_to_sim.cam_to_sim_service.get_session",
        return_value=snapshot,
    ):
        response = client.get(
            f"/cam-to-sim/connect/{TEST_SESSION_ID}?token={TEST_SESSION_TOKEN}",
            headers={CAM_TO_SIM_PROXY_TOKEN_HEADER: TEST_PROXY_TOKEN},
        )

    assert response.status_code == 200
    assert f"token={TEST_SESSION_TOKEN}" in response.text
