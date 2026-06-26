from __future__ import annotations

import json
from html import escape
from ipaddress import ip_address
from pathlib import Path
import socket
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, HTMLResponse

from backend.core.settings import settings
from backend.core.simulator_security import (
    require_simulator_operator_access_async,
    require_simulator_session_access_async,
)
from backend.models.cam_to_sim import (
    CamToSimCaptureCoachResponse,
    CamToSimCaptureReadinessResponse,
    CamToSimGeometryMeshExecuteRequest,
    CamToSimGeometryMeshRunRequest,
    CamToSimGeometryMeshRunResponse,
    CamToSimNetworkGuessResponse,
    CamToSimPhoneFrameResponse,
    CamToSimPhoneFrameStatsResponse,
    CamToSimR2R2RPrepareResponse,
    CamToSimRuntimeResultResponse,
    CamToSimSessionCreateRequest,
    CamToSimSessionSnapshot,
    CamToSimStaticWorldTestRunRequest,
    CamToSimStaticWorldTestRunResponse,
    CamToSimStreamIngestRequest,
    CamToSimStreamIngestResponse,
)
from backend.services.cam_to_sim import cam_to_sim_service
from backend.services.cam_to_sim_params import (
    CAM_TO_SIM_WEB_CAMERA_IDEAL_FPS,
    CAM_TO_SIM_WEB_CAMERA_IDEAL_HEIGHT_PX,
    CAM_TO_SIM_WEB_CAMERA_IDEAL_WIDTH_PX,
    CAM_TO_SIM_WEB_CAMERA_MAX_FPS,
    CAM_TO_SIM_WEB_CAMERA_MAX_HEIGHT_PX,
    CAM_TO_SIM_WEB_CAMERA_MAX_WIDTH_PX,
    CAM_TO_SIM_WEB_CAPTURE_COACH_POLL_INTERVAL_MS,
    CAM_TO_SIM_WEB_CAPTURE_ERROR_INTERVAL_SCALE,
    CAM_TO_SIM_WEB_CAPTURE_ERROR_QUALITY_STEP,
    CAM_TO_SIM_WEB_CAPTURE_ERROR_WIDTH_SCALE,
    CAM_TO_SIM_WEB_CAPTURE_FRAME_WIDTH_DEFAULT_PX,
    CAM_TO_SIM_WEB_CAPTURE_FRAME_WIDTH_MAX_PX,
    CAM_TO_SIM_WEB_CAPTURE_FRAME_WIDTH_MIN_PX,
    CAM_TO_SIM_WEB_CAPTURE_HIGH_RTT_INTERVAL_SCALE,
    CAM_TO_SIM_WEB_CAPTURE_HIGH_RTT_QUALITY_STEP,
    CAM_TO_SIM_WEB_CAPTURE_HIGH_RTT_THRESHOLD_MS,
    CAM_TO_SIM_WEB_CAPTURE_HIGH_RTT_WIDTH_SCALE,
    CAM_TO_SIM_WEB_CAPTURE_INTERVAL_DEFAULT_MS,
    CAM_TO_SIM_WEB_CAPTURE_INTERVAL_MAX_MS,
    CAM_TO_SIM_WEB_CAPTURE_INTERVAL_MIN_MS,
    CAM_TO_SIM_WEB_CAPTURE_JPEG_QUALITY_DEFAULT,
    CAM_TO_SIM_WEB_CAPTURE_JPEG_QUALITY_MAX,
    CAM_TO_SIM_WEB_CAPTURE_JPEG_QUALITY_MIN,
    CAM_TO_SIM_WEB_CAPTURE_LOW_RTT_THRESHOLD_MS,
    CAM_TO_SIM_WEB_CAPTURE_MAX_IN_FLIGHT_UPLOADS,
    CAM_TO_SIM_WEB_CAPTURE_STABLE_SUCCESS_THRESHOLD,
    CAM_TO_SIM_WEB_CAPTURE_SUCCESS_INTERVAL_SCALE,
    CAM_TO_SIM_WEB_CAPTURE_SUCCESS_QUALITY_STEP,
    CAM_TO_SIM_WEB_CAPTURE_SUCCESS_WIDTH_SCALE,
)

router = APIRouter(prefix="/cam-to-sim", tags=["cam-to-sim"])
LAN_DISCOVERY_TIMEOUT_SEC = 0.25
WSL_OSRELEASE_PATH = Path("/proc/sys/kernel/osrelease")
CAM_TO_SIM_FRAME_METADATA_HEADER = "x-cam-to-sim-meta"
CAM_TO_SIM_FRAME_METADATA_MAX_CHARS = 8_192


def _is_loopback_host(hostname: str) -> bool:
    normalized = hostname.strip().lower()
    if normalized == "localhost":
        return True
    try:
        parsed_ip = ip_address(normalized)
        return parsed_ip.is_loopback or parsed_ip.is_unspecified
    except ValueError:
        return False


def _is_valid_reachable_ip(hostname: str) -> bool:
    normalized = hostname.strip().lower()
    if not normalized:
        return False
    try:
        parsed_ip = ip_address(normalized)
        return not parsed_ip.is_loopback and not parsed_ip.is_unspecified
    except ValueError:
        return False


def _is_wsl_environment() -> bool:
    try:
        osrelease = WSL_OSRELEASE_PATH.read_text(encoding="utf-8").lower()
    except OSError:
        return False
    return "microsoft" in osrelease


def _is_probable_wsl_gateway_ip(hostname: str) -> bool:
    if not _is_wsl_environment():
        return False
    try:
        parsed_ip = ip_address(hostname.strip())
    except ValueError:
        return False
    # In WSL2, 172.16/12 addresses are commonly internal virtual bridge ranges.
    return parsed_ip.is_private and str(parsed_ip).startswith("172.")


def _discover_lan_ip() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.settimeout(LAN_DISCOVERY_TIMEOUT_SEC)
            sock.connect(("8.8.8.8", 80))
            local_ip = sock.getsockname()[0]
            return local_ip.strip() or None
    except OSError:
        return None


def _collect_socket_candidate_ips() -> list[str]:
    candidates: list[str] = []
    try:
        hostname = socket.gethostname()
        for candidate in socket.gethostbyname_ex(hostname)[2]:
            if _is_valid_reachable_ip(candidate):
                candidates.append(candidate)
    except OSError:
        return candidates
    return candidates


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped


def _resolve_public_base_url(base_url: str, configured_public_base_url: str | None) -> str:
    if configured_public_base_url:
        return configured_public_base_url.rstrip("/")

    parsed = urlsplit(base_url.rstrip("/"))
    hostname = parsed.hostname or ""
    if not _is_loopback_host(hostname):
        return base_url.rstrip("/")

    lan_ip = _discover_lan_ip()
    if lan_ip and _is_probable_wsl_gateway_ip(lan_ip):
        lan_ip = None
    if not lan_ip:
        socket_candidates = [
            candidate for candidate in _collect_socket_candidate_ips()
            if not _is_probable_wsl_gateway_ip(candidate)
        ]
        lan_ip = socket_candidates[0] if socket_candidates else None
    if not lan_ip:
        return base_url.rstrip("/")

    netloc = lan_ip
    if parsed.port:
        netloc = f"{lan_ip}:{parsed.port}"
    return urlunsplit((parsed.scheme, netloc, "", "", ""))


def _derive_session_endpoint_url(
    base_url: str,
    *,
    action: str,
    extra_query: dict[str, str] | None = None,
) -> str:
    parsed = urlsplit(base_url)
    query_pairs = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if extra_query is None or key not in extra_query
    ]
    if extra_query is not None:
        for key, value in extra_query.items():
            query_pairs.append((key, value))
    session_base_path = parsed.path.rsplit("/", 1)[0]
    return urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            f"{session_base_path}/{action}",
            urlencode(query_pairs),
            parsed.fragment,
        )
    )


async def require_cam_to_sim_session_access(request: Request, session_id: str) -> None:
    session_token = cam_to_sim_service.get_session_access_token(session_id)
    await require_simulator_session_access_async(
        request,
        session_token=session_token,
    )


@router.get("/network/guess", response_model=CamToSimNetworkGuessResponse)
async def guess_cam_to_sim_network(
    request: Request,
    _access: None = Depends(require_simulator_operator_access_async),
) -> CamToSimNetworkGuessResponse:
    base_host = (urlsplit(str(request.base_url)).hostname or "").strip()
    candidates: list[str] = []
    if _is_valid_reachable_ip(base_host):
        candidates.append(base_host)
    lan_ip = _discover_lan_ip()
    if lan_ip and _is_valid_reachable_ip(lan_ip):
        candidates.append(lan_ip)
    candidates.extend(_collect_socket_candidate_ips())
    deduped_candidates = [
        candidate for candidate in _dedupe(candidates)
        if not _is_probable_wsl_gateway_ip(candidate)
    ]
    detected_ip = deduped_candidates[0] if deduped_candidates else None
    return CamToSimNetworkGuessResponse(
        detected_ip=detected_ip,
        candidates=deduped_candidates,
    )


@router.get(
    "/sessions/{session_id}/capture-coach",
    response_model=CamToSimCaptureCoachResponse,
)
async def get_cam_to_sim_capture_coach(
    session_id: str,
    _access: None = Depends(require_cam_to_sim_session_access),
) -> CamToSimCaptureCoachResponse:
    return cam_to_sim_service.get_capture_coach(session_id)


@router.post(
    "/static-world-tests/run",
    response_model=CamToSimStaticWorldTestRunResponse,
)
async def run_cam_to_sim_static_world_test(
    req: CamToSimStaticWorldTestRunRequest,
    _access: None = Depends(require_simulator_operator_access_async),
) -> CamToSimStaticWorldTestRunResponse:
    return cam_to_sim_service.run_static_world_test(req)


@router.post(
    "/geometry-mesh-jobs/run",
    response_model=CamToSimGeometryMeshRunResponse,
)
async def run_cam_to_sim_geometry_mesh_job(
    req: CamToSimGeometryMeshRunRequest,
    _access: None = Depends(require_simulator_operator_access_async),
) -> CamToSimGeometryMeshRunResponse:
    return cam_to_sim_service.run_geometry_mesh_job(req)


@router.post(
    "/geometry-mesh-jobs/{job_id}/execute",
    response_model=CamToSimGeometryMeshRunResponse,
)
async def execute_cam_to_sim_geometry_mesh_job(
    job_id: str,
    req: CamToSimGeometryMeshExecuteRequest | None = None,
    _access: None = Depends(require_simulator_operator_access_async),
) -> CamToSimGeometryMeshRunResponse:
    payload = req or CamToSimGeometryMeshExecuteRequest()
    return cam_to_sim_service.execute_geometry_mesh_job(
        job_id=job_id,
        session_id=payload.session_id,
        force=payload.force,
    )


def _render_connect_page_html(
    *,
    session_id: str,
    ingest_url: str,
    frame_ingest_url: str,
    coach_url: str,
    status_message: str = "Ready.",
) -> str:
    escaped_session_id = escape(session_id)
    escaped_ingest_url = escape(ingest_url)
    escaped_frame_ingest_url = escape(frame_ingest_url)
    escaped_coach_url = escape(coach_url)
    escaped_status_message = escape(status_message)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>cam-to-sim connect</title>
  <style>
    body {{ margin: 0; background: #0c0d0f; color: #f5f6f8; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }}
    .hud {{ position: fixed; top: 0; left: 0; right: 0; z-index: 20; background: rgba(8, 10, 14, 0.92); border-bottom: 1px solid #2b313d; backdrop-filter: blur(6px); padding: calc(8px + env(safe-area-inset-top, 0px)) 10px 8px; }}
    .hud-inner {{ max-width: 430px; margin: 0 auto; display: grid; gap: 5px; }}
    .hud-row {{ display: flex; align-items: center; justify-content: space-between; gap: 8px; }}
    .hud-pill {{ border: 1px solid #324055; border-radius: 999px; padding: 2px 8px; font-size: 10px; color: #dbeafe; background: #0f172a; }}
    .hud-pill.live {{ border-color: #2d8a5d; color: #b9f7d9; background: #102b1f; }}
    .hud-target {{ font-size: 12px; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; text-align: center; }}
    .hud-mini-btn {{ margin-top: 0; width: auto; border: 1px solid #3f4c62; border-radius: 8px; background: #1e2534; color: #e8eaf0; padding: 6px 10px; font-size: 12px; }}
    .hud-sub {{ display: flex; align-items: center; gap: 8px; font-size: 10px; color: #b7c0cf; }}
    .hud-sub span:last-child {{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
    main {{ max-width: 430px; margin: 0 auto; padding: calc(74px + env(safe-area-inset-top, 0px)) 18px 18px; }}
    h1 {{ font-size: 18px; margin: 0; }}
    p {{ font-size: 13px; color: #b5b7bc; margin: 6px 0 0; }}
    .card {{ border: 1px solid #26292f; border-radius: 12px; padding: 14px; background: #121419; margin-top: 12px; }}
    video {{ width: 100%; border-radius: 10px; background: #000; margin-top: 10px; }}
    .status {{ margin-top: 10px; font-size: 12px; color: #d5d7dc; word-break: break-word; }}
    .stack {{ margin-top: 10px; border: 1px solid #2f3340; border-radius: 10px; padding: 10px; background: #10151e; }}
    .stack-head {{ display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #c8d0e3; }}
    .stack-id {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #9fb2cf; font-size: 10px; }}
    .stack-row {{ margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }}
    .stack-row button {{ margin-top: 0; width: auto; padding: 8px 10px; font-size: 12px; }}
    .stack-chip {{ border: 1px solid #344258; border-radius: 999px; background: #152036; color: #d8e6ff; padding: 2px 8px; font-size: 10px; }}
    .stack-chip.active {{ border-color: #38bdf8; background: #0f1d38; color: #e0f2fe; }}
    .targets {{ margin-top: 10px; border: 1px solid #2d3445; border-radius: 10px; padding: 10px; background: #111827; }}
    .targets-head {{ display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #c8d0e3; }}
    .targets-actions {{ margin-top: 8px; display: flex; gap: 6px; }}
    .targets-actions input {{ flex: 1; border: 1px solid #334155; border-radius: 8px; background: #0f172a; color: #dbeafe; padding: 8px; font-size: 12px; }}
    .targets-actions select {{ border: 1px solid #334155; border-radius: 8px; background: #0f172a; color: #dbeafe; padding: 8px; font-size: 12px; }}
    .targets-actions button {{ margin-top: 0; width: auto; padding: 8px 10px; font-size: 12px; }}
    .targets-list {{ margin-top: 8px; display: grid; gap: 6px; }}
    .target-btn {{ margin-top: 0; width: 100%; text-align: left; border: 1px solid #334155; border-radius: 8px; background: #0b1324; color: #dbeafe; padding: 8px 10px; font-size: 12px; }}
    .target-btn.active {{ border-color: #38bdf8; background: #0f1d38; color: #e0f2fe; }}
    .coach {{ margin-top: 10px; border: 1px solid #2d3445; border-radius: 10px; padding: 10px; background: #121a2a; }}
    .coach-head {{ display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #c8d0e3; }}
    .coach-bar-wrap {{ margin-top: 6px; height: 6px; border-radius: 999px; background: #2a3346; overflow: hidden; }}
    .coach-bar {{ height: 100%; width: 0%; background: linear-gradient(90deg, #52c1ff, #56f0a5); transition: width 0.25s ease; }}
    .coach-list {{ margin: 8px 0 0; padding-left: 16px; color: #aeb9d0; font-size: 11px; }}
    .coach-list li {{ margin: 2px 0; }}
    button {{ margin-top: 10px; width: 100%; border: 1px solid #424859; border-radius: 8px; background: #1e2534; color: #e8eaf0; padding: 10px; font-size: 14px; }}
    button:disabled {{ opacity: 0.5; }}
    code {{ font-size: 11px; color: #98a2b3; }}
  </style>
</head>
<body>
  <div class="hud">
    <div class="hud-inner">
      <div class="hud-row">
        <span id="hudConnection" class="hud-pill">Idle</span>
        <span id="hudTarget" class="hud-target">Object 1</span>
        <button id="hudNextTargetBtn" class="hud-mini-btn" type="button">Next</button>
      </div>
      <div class="hud-sub">
        <span id="hudFrames">0f</span>
        <span id="hudCoverage">0%</span>
        <span id="hudStatus">Ready.</span>
      </div>
    </div>
  </div>
  <main>
    <h1>Connected to cam-to-sim</h1>
    <p>Allow camera access. Frames will stream automatically.</p>
    <div class="card">
      <video id="video" autoplay playsinline muted></video>
      <button id="startBtn" type="button">Start Camera</button>
      <button id="stopBtn" type="button" disabled>Stop Camera</button>
      <div id="status" class="status">{escaped_status_message}</div>
      <div class="stack">
        <div class="stack-head">
          <span>Capture Strategy</span>
          <span id="stackGroupId" class="stack-id">no stack</span>
        </div>
        <div class="stack-row">
          <button id="scenarioSingleBtn" type="button">Single Object</button>
          <button id="scenarioMultiBtn" type="button">Multi Objects</button>
          <button id="scenarioStackBtn" type="button">Stacked Objects</button>
        </div>
        <div class="stack-row">
          <button id="startStackBtn" type="button">Start Stack</button>
          <button id="endStackBtn" type="button">End Stack</button>
        </div>
        <div class="stack-row">
          <button id="stackScenePassBtn" type="button">Scene Pass</button>
          <button id="stackObjectPassBtn" type="button">Object Pass</button>
        </div>
        <div class="stack-row">
          <button id="levelBottomBtn" type="button">Bottom</button>
          <button id="levelMiddleBtn" type="button">Middle</button>
          <button id="levelTopBtn" type="button">Top</button>
        </div>
      </div>
      <div class="targets">
        <div class="targets-head">
          <span>Object Capture Plan</span>
          <span id="activeTargetLabel">Object 1</span>
        </div>
        <div class="targets-actions">
          <input id="targetNameInput" type="text" placeholder="Object name (optional)" />
          <select id="targetFamilySelect" aria-label="Target shape family">
            <option value="box">Box</option>
            <option value="mug">Mug</option>
            <option value="sphere">Sphere</option>
            <option value="cylinder">Cylinder</option>
          </select>
          <button id="addTargetBtn" type="button">Add Object</button>
          <button id="nextTargetBtn" type="button">Next Object</button>
        </div>
        <div id="targetsList" class="targets-list"></div>
      </div>
      <div class="coach">
        <div class="coach-head">
          <span id="coachStatus">Waiting for guidance...</span>
          <span id="coachCoverage">0%</span>
        </div>
        <div class="coach-bar-wrap">
          <div id="coachBar" class="coach-bar"></div>
        </div>
        <ul id="coachGuidance" class="coach-list">
          <li>Start camera to receive capture guidance.</li>
        </ul>
      </div>
      <code>session {escaped_session_id}</code>
    </div>
  </main>
  <script>
    const streamEndpoint = {escaped_ingest_url!r};
    const frameEndpoint = {escaped_frame_ingest_url!r};
    const coachEndpoint = {escaped_coach_url!r};
    const statusEl = document.getElementById("status");
    const videoEl = document.getElementById("video");
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    const activeTargetLabelEl = document.getElementById("activeTargetLabel");
    const targetNameInputEl = document.getElementById("targetNameInput");
    const targetFamilySelectEl = document.getElementById("targetFamilySelect");
    const addTargetBtn = document.getElementById("addTargetBtn");
    const nextTargetBtn = document.getElementById("nextTargetBtn");
    const targetsListEl = document.getElementById("targetsList");
    const scenarioSingleBtn = document.getElementById("scenarioSingleBtn");
    const scenarioMultiBtn = document.getElementById("scenarioMultiBtn");
    const scenarioStackBtn = document.getElementById("scenarioStackBtn");
    const stackGroupIdEl = document.getElementById("stackGroupId");
    const startStackBtn = document.getElementById("startStackBtn");
    const endStackBtn = document.getElementById("endStackBtn");
    const stackScenePassBtn = document.getElementById("stackScenePassBtn");
    const stackObjectPassBtn = document.getElementById("stackObjectPassBtn");
    const levelBottomBtn = document.getElementById("levelBottomBtn");
    const levelMiddleBtn = document.getElementById("levelMiddleBtn");
    const levelTopBtn = document.getElementById("levelTopBtn");
    const coachStatusEl = document.getElementById("coachStatus");
    const coachCoverageEl = document.getElementById("coachCoverage");
    const coachBarEl = document.getElementById("coachBar");
    const coachGuidanceEl = document.getElementById("coachGuidance");
    const hudConnectionEl = document.getElementById("hudConnection");
    const hudTargetEl = document.getElementById("hudTarget");
    const hudFramesEl = document.getElementById("hudFrames");
    const hudCoverageEl = document.getElementById("hudCoverage");
    const hudStatusEl = document.getElementById("hudStatus");
    const hudNextTargetBtnEl = document.getElementById("hudNextTargetBtn");
    const canvas = document.createElement("canvas");
    const CAPTURE_INTERVAL_MIN_MS = {CAM_TO_SIM_WEB_CAPTURE_INTERVAL_MIN_MS};
    const CAPTURE_INTERVAL_MAX_MS = {CAM_TO_SIM_WEB_CAPTURE_INTERVAL_MAX_MS};
    const DEFAULT_CAPTURE_INTERVAL_MS = {CAM_TO_SIM_WEB_CAPTURE_INTERVAL_DEFAULT_MS};
    const MAX_IN_FLIGHT_UPLOADS = {CAM_TO_SIM_WEB_CAPTURE_MAX_IN_FLIGHT_UPLOADS};
    const MIN_FRAME_WIDTH = {CAM_TO_SIM_WEB_CAPTURE_FRAME_WIDTH_MIN_PX};
    const MAX_FRAME_WIDTH = {CAM_TO_SIM_WEB_CAPTURE_FRAME_WIDTH_MAX_PX};
    const DEFAULT_FRAME_WIDTH = {CAM_TO_SIM_WEB_CAPTURE_FRAME_WIDTH_DEFAULT_PX};
    const MIN_JPEG_QUALITY = {CAM_TO_SIM_WEB_CAPTURE_JPEG_QUALITY_MIN};
    const MAX_JPEG_QUALITY = {CAM_TO_SIM_WEB_CAPTURE_JPEG_QUALITY_MAX};
    const DEFAULT_JPEG_QUALITY = {CAM_TO_SIM_WEB_CAPTURE_JPEG_QUALITY_DEFAULT};
    const LOW_RTT_THRESHOLD_MS = {CAM_TO_SIM_WEB_CAPTURE_LOW_RTT_THRESHOLD_MS};
    const HIGH_RTT_THRESHOLD_MS = {CAM_TO_SIM_WEB_CAPTURE_HIGH_RTT_THRESHOLD_MS};
    const STABLE_SUCCESS_THRESHOLD = {CAM_TO_SIM_WEB_CAPTURE_STABLE_SUCCESS_THRESHOLD};
    const ERROR_INTERVAL_SCALE = {CAM_TO_SIM_WEB_CAPTURE_ERROR_INTERVAL_SCALE};
    const ERROR_QUALITY_STEP = {CAM_TO_SIM_WEB_CAPTURE_ERROR_QUALITY_STEP};
    const ERROR_WIDTH_SCALE = {CAM_TO_SIM_WEB_CAPTURE_ERROR_WIDTH_SCALE};
    const HIGH_RTT_INTERVAL_SCALE = {CAM_TO_SIM_WEB_CAPTURE_HIGH_RTT_INTERVAL_SCALE};
    const HIGH_RTT_QUALITY_STEP = {CAM_TO_SIM_WEB_CAPTURE_HIGH_RTT_QUALITY_STEP};
    const HIGH_RTT_WIDTH_SCALE = {CAM_TO_SIM_WEB_CAPTURE_HIGH_RTT_WIDTH_SCALE};
    const SUCCESS_INTERVAL_SCALE = {CAM_TO_SIM_WEB_CAPTURE_SUCCESS_INTERVAL_SCALE};
    const SUCCESS_QUALITY_STEP = {CAM_TO_SIM_WEB_CAPTURE_SUCCESS_QUALITY_STEP};
    const SUCCESS_WIDTH_SCALE = {CAM_TO_SIM_WEB_CAPTURE_SUCCESS_WIDTH_SCALE};
    const COACH_POLL_INTERVAL_MS = {CAM_TO_SIM_WEB_CAPTURE_COACH_POLL_INTERVAL_MS};
    const CAMERA_CONSTRAINTS = {{
      facingMode: {{ ideal: "environment" }},
      width: {{ ideal: {CAM_TO_SIM_WEB_CAMERA_IDEAL_WIDTH_PX}, max: {CAM_TO_SIM_WEB_CAMERA_MAX_WIDTH_PX} }},
      height: {{ ideal: {CAM_TO_SIM_WEB_CAMERA_IDEAL_HEIGHT_PX}, max: {CAM_TO_SIM_WEB_CAMERA_MAX_HEIGHT_PX} }},
      frameRate: {{ ideal: {CAM_TO_SIM_WEB_CAMERA_IDEAL_FPS}, max: {CAM_TO_SIM_WEB_CAMERA_MAX_FPS} }},
    }};
    let captureLoopRunning = false;
    let captureLoopTimer = null;
    let uploadInFlight = 0;
    let uploadErrorCount = 0;
    let lastUploadRttMs = null;
    let currentCaptureIntervalMs = DEFAULT_CAPTURE_INTERVAL_MS;
    let currentMaxWidth = DEFAULT_FRAME_WIDTH;
    let currentJpegQuality = DEFAULT_JPEG_QUALITY;
    let stableSuccessCount = 0;
    let cameraRunning = false;
    let sentFrames = 0;
    let frameSequence = 0;
    let streamRegistered = false;
    let mediaStream = null;
    let latestOrientation = null;
    let latestMotion = null;
    let sensorListenersAttached = false;
    let motionPermissionState = "unknown";
    let orientationPermissionState = "unknown";
    let arSupportKnown = false;
    let arSupported = false;
    let coachPollTimer = null;
    let captureTargets = [{{ id: "object_1", label: "Object 1", family: "box", level: "bottom", order: 1 }}];
    let activeTargetId = "object_1";
    let nextTargetIndex = 2;
    let targetFrameCounts = {{ object_1: 0 }};
    let captureScenario = "multi_objects";
    let stackModeEnabled = false;
    let activeStackGroupId = null;
    let stackPassPhase = "scene_pass";

    function blobFromCanvas(canvasEl, quality) {{
      return new Promise((resolve) => {{
        canvasEl.toBlob((blob) => resolve(blob), "image/jpeg", quality);
      }});
    }}

    function setStatus(message) {{
      statusEl.textContent = message;
      if (hudStatusEl) {{
        const normalized = String(message || "");
        hudStatusEl.textContent = normalized.length > 72 ? `${{normalized.slice(0, 72)}}…` : normalized;
      }}
      updateHudConnectionState(message);
      updateHudCounters();
    }}

    function setHudConnectionState(label, isLive) {{
      if (!hudConnectionEl) return;
      hudConnectionEl.textContent = label;
      hudConnectionEl.classList.toggle("live", Boolean(isLive));
    }}

    function updateHudConnectionState(message) {{
      const normalized = String(message || "").toLowerCase();
      if (!cameraRunning) {{
        setHudConnectionState("Idle", false);
        return;
      }}
      if (normalized.includes("streaming")) {{
        setHudConnectionState("Live", true);
        return;
      }}
      if (normalized.includes("retry") || normalized.includes("failed")) {{
        setHudConnectionState("Unstable", false);
        return;
      }}
      setHudConnectionState("Connecting", false);
    }}

    function updateHudCounters(coverageValue) {{
      const activeTarget = getActiveTarget();
      const activeId = activeTarget ? activeTarget.id : "object_1";
      const activeLabel = activeTarget ? activeTarget.label : "Object 1";
      const activeLevel = activeTarget && typeof activeTarget.level === "string" ? activeTarget.level : "n/a";
      const activeFrames = targetFrameCounts[activeId] || 0;
      if (hudTargetEl) {{
        const passLabel = stackPassPhase === "scene_pass" ? "scene" : "object";
        const scenarioLabel = captureScenario === "single_object"
          ? "single"
          : (captureScenario === "stacked_objects" ? "stack" : "multi");
        hudTargetEl.textContent = `${{activeLabel}} (${{activeLevel}}) • ${{activeFrames}}f • ${{scenarioLabel}}/${{passLabel}}`;
      }}
      if (hudFramesEl) {{
        hudFramesEl.textContent = `${{sentFrames}}f`;
      }}
      if (hudCoverageEl && typeof coverageValue === "number") {{
        const clamped = Math.max(0, Math.min(100, Math.round(coverageValue)));
        hudCoverageEl.textContent = `${{clamped}}%`;
      }}
    }}

    function createStackGroupId() {{
      const nowMs = Date.now().toString(36).slice(-6);
      return `stack_${{nowMs}}`;
    }}

    function setStackPassPhase(phase) {{
      stackPassPhase = phase === "object_pass" ? "object_pass" : "scene_pass";
      renderStackMode();
      updateHudCounters();
    }}

    function setCaptureScenario(scenario) {{
      const allowed = ["single_object", "multi_objects", "stacked_objects"];
      if (!allowed.includes(scenario)) {{
        return;
      }}
      captureScenario = scenario;
      if (scenario !== "stacked_objects") {{
        stackModeEnabled = false;
        activeStackGroupId = null;
        stackPassPhase = "scene_pass";
      }}
      renderStackMode();
      updateHudCounters();
      setStatus(
        scenario === "single_object"
          ? "Capture strategy: single object."
          : (scenario === "stacked_objects" ? "Capture strategy: stacked objects." : "Capture strategy: multi objects.")
      );
    }}

    function setActiveTargetLevel(level) {{
      const allowed = ["bottom", "middle", "top"];
      if (!allowed.includes(level)) return;
      const target = getActiveTarget();
      if (!target) return;
      target.level = level;
      renderTargets();
      renderStackMode();
    }}

    function startStackMode() {{
      if (captureScenario !== "stacked_objects") {{
        setStatus("Switch strategy to Stacked Objects first.");
        return;
      }}
      stackModeEnabled = true;
      activeStackGroupId = createStackGroupId();
      setStackPassPhase("scene_pass");
      renderStackMode();
      setStatus(`Stack mode enabled: ${{activeStackGroupId}}`);
    }}

    function endStackMode() {{
      stackModeEnabled = false;
      activeStackGroupId = null;
      setStackPassPhase("scene_pass");
      renderStackMode();
      setStatus("Stack mode disabled.");
    }}

    function renderStackMode() {{
      if (stackGroupIdEl) {{
        stackGroupIdEl.textContent = stackModeEnabled && activeStackGroupId ? activeStackGroupId : "no stack";
      }}
      if (stackScenePassBtn) {{
        stackScenePassBtn.classList.toggle("stack-chip", true);
        stackScenePassBtn.classList.toggle("active", stackPassPhase === "scene_pass");
        stackScenePassBtn.disabled = captureScenario !== "stacked_objects";
      }}
      if (stackObjectPassBtn) {{
        stackObjectPassBtn.classList.toggle("stack-chip", true);
        stackObjectPassBtn.classList.toggle("active", stackPassPhase === "object_pass");
        stackObjectPassBtn.disabled = captureScenario !== "stacked_objects";
      }}
      if (startStackBtn) {{
        startStackBtn.disabled = captureScenario !== "stacked_objects";
      }}
      if (endStackBtn) {{
        endStackBtn.disabled = captureScenario !== "stacked_objects";
      }}
      const target = getActiveTarget();
      const level = target && typeof target.level === "string" ? target.level : "middle";
      if (levelBottomBtn) {{
        levelBottomBtn.classList.toggle("stack-chip", true);
        levelBottomBtn.classList.toggle("active", level === "bottom");
        levelBottomBtn.disabled = captureScenario !== "stacked_objects";
      }}
      if (levelMiddleBtn) {{
        levelMiddleBtn.classList.toggle("stack-chip", true);
        levelMiddleBtn.classList.toggle("active", level === "middle");
        levelMiddleBtn.disabled = captureScenario !== "stacked_objects";
      }}
      if (levelTopBtn) {{
        levelTopBtn.classList.toggle("stack-chip", true);
        levelTopBtn.classList.toggle("active", level === "top");
        levelTopBtn.disabled = captureScenario !== "stacked_objects";
      }}
      if (scenarioSingleBtn) {{
        scenarioSingleBtn.classList.toggle("stack-chip", true);
        scenarioSingleBtn.classList.toggle("active", captureScenario === "single_object");
      }}
      if (scenarioMultiBtn) {{
        scenarioMultiBtn.classList.toggle("stack-chip", true);
        scenarioMultiBtn.classList.toggle("active", captureScenario === "multi_objects");
      }}
      if (scenarioStackBtn) {{
        scenarioStackBtn.classList.toggle("stack-chip", true);
        scenarioStackBtn.classList.toggle("active", captureScenario === "stacked_objects");
      }}
    }}

    function clamp(value, minValue, maxValue) {{
      return Math.max(minValue, Math.min(maxValue, value));
    }}

    function resetAdaptiveTuning() {{
      currentCaptureIntervalMs = DEFAULT_CAPTURE_INTERVAL_MS;
      currentMaxWidth = DEFAULT_FRAME_WIDTH;
      currentJpegQuality = DEFAULT_JPEG_QUALITY;
      stableSuccessCount = 0;
    }}

    function applyAdaptiveTune(result) {{
      if (!result || !result.ok) {{
        stableSuccessCount = 0;
        currentCaptureIntervalMs = clamp(Math.round(currentCaptureIntervalMs * ERROR_INTERVAL_SCALE), CAPTURE_INTERVAL_MIN_MS, CAPTURE_INTERVAL_MAX_MS);
        currentJpegQuality = clamp(Number((currentJpegQuality - ERROR_QUALITY_STEP).toFixed(3)), MIN_JPEG_QUALITY, MAX_JPEG_QUALITY);
        currentMaxWidth = clamp(Math.round(currentMaxWidth * ERROR_WIDTH_SCALE), MIN_FRAME_WIDTH, MAX_FRAME_WIDTH);
        return;
      }}

      const rttMs = typeof result.rttMs === "number" ? result.rttMs : null;
      if (rttMs !== null && rttMs >= HIGH_RTT_THRESHOLD_MS) {{
        stableSuccessCount = 0;
        currentCaptureIntervalMs = clamp(Math.round(currentCaptureIntervalMs * HIGH_RTT_INTERVAL_SCALE), CAPTURE_INTERVAL_MIN_MS, CAPTURE_INTERVAL_MAX_MS);
        currentJpegQuality = clamp(Number((currentJpegQuality - HIGH_RTT_QUALITY_STEP).toFixed(3)), MIN_JPEG_QUALITY, MAX_JPEG_QUALITY);
        currentMaxWidth = clamp(Math.round(currentMaxWidth * HIGH_RTT_WIDTH_SCALE), MIN_FRAME_WIDTH, MAX_FRAME_WIDTH);
        return;
      }}

      if (rttMs !== null && rttMs <= LOW_RTT_THRESHOLD_MS && uploadInFlight <= 1) {{
        stableSuccessCount += 1;
      }} else {{
        stableSuccessCount = Math.max(0, stableSuccessCount - 1);
      }}

      if (stableSuccessCount >= STABLE_SUCCESS_THRESHOLD) {{
        stableSuccessCount = 0;
        currentCaptureIntervalMs = clamp(Math.round(currentCaptureIntervalMs * SUCCESS_INTERVAL_SCALE), CAPTURE_INTERVAL_MIN_MS, CAPTURE_INTERVAL_MAX_MS);
        currentJpegQuality = clamp(Number((currentJpegQuality + SUCCESS_QUALITY_STEP).toFixed(3)), MIN_JPEG_QUALITY, MAX_JPEG_QUALITY);
        currentMaxWidth = clamp(Math.round(currentMaxWidth * SUCCESS_WIDTH_SCALE), MIN_FRAME_WIDTH, MAX_FRAME_WIDTH);
      }}
    }}

    function getActiveTarget() {{
      return captureTargets.find((target) => target.id === activeTargetId) || captureTargets[0];
    }}

    function setActiveTarget(targetId) {{
      const exists = captureTargets.some((target) => target.id === targetId);
      if (!exists) return;
      activeTargetId = targetId;
      renderTargets();
    }}

    function normalizeTargetFamily(value, fallback = "box") {{
      const normalized = String(value || "").trim().toLowerCase();
      if (normalized === "sphere" || normalized === "ball") return "sphere";
      if (normalized === "mug" || normalized === "cup") return "mug";
      if (normalized === "cylinder") return "cylinder";
      if (normalized === "box" || normalized === "cube") return "box";
      return fallback;
    }}

    function addTarget(labelCandidate, familyCandidate) {{
      const normalized = String(labelCandidate || "").trim();
      const defaultPrefix = captureScenario === "stacked_objects" ? "Box" : "Object";
      const label = normalized.length > 0 ? normalized : `${{defaultPrefix}} ${{nextTargetIndex}}`;
      const targetId = `object_${{nextTargetIndex}}`;
      const order = captureTargets.length + 1;
      const defaultLevel = order === 1 ? "bottom" : "middle";
      const family = normalizeTargetFamily(familyCandidate, "box");
      nextTargetIndex += 1;
      captureTargets.push({{ id: targetId, label, family, level: defaultLevel, order }});
      if (!targetFrameCounts[targetId]) {{
        targetFrameCounts[targetId] = 0;
      }}
      setActiveTarget(targetId);
      return targetId;
    }}

    function selectNextTarget() {{
      const activeIndex = captureTargets.findIndex((target) => target.id === activeTargetId);
      if (activeIndex >= 0 && activeIndex < captureTargets.length - 1) {{
        setActiveTarget(captureTargets[activeIndex + 1].id);
        return;
      }}
      const selectedFamily = targetFamilySelectEl ? targetFamilySelectEl.value : "box";
      addTarget("", selectedFamily);
    }}

    function renderTargets() {{
      const activeTarget = getActiveTarget();
      activeTargetLabelEl.textContent = activeTarget ? activeTarget.label : "Object 1";
      targetsListEl.innerHTML = "";
      captureTargets.forEach((target) => {{
        const button = document.createElement("button");
        button.type = "button";
        button.className = `target-btn${{target.id === activeTargetId ? " active" : ""}}`;
        const frames = targetFrameCounts[target.id] || 0;
        const family = typeof target.family === "string" ? target.family : "box";
        const level = typeof target.level === "string" ? target.level : "middle";
        const order = typeof target.order === "number" ? target.order : 0;
        button.textContent = `${{target.label}} • ${{family}} • ${{frames}} frames • ${{level}} • #${{order}}`;
        button.addEventListener("click", () => {{
          setActiveTarget(target.id);
        }});
        targetsListEl.appendChild(button);
      }});
      renderStackMode();
      updateHudCounters();
    }}

    function setCoachFallback(message) {{
      coachStatusEl.textContent = message;
      coachCoverageEl.textContent = "--";
      coachBarEl.style.width = "0%";
      if (hudCoverageEl) {{
        hudCoverageEl.textContent = "--";
      }}
      coachGuidanceEl.innerHTML = "";
      const li = document.createElement("li");
      li.textContent = "Keep camera steady and move around the object.";
      coachGuidanceEl.appendChild(li);
    }}

    function renderCoach(payload) {{
      const coverage = typeof payload.coverage_score === "number"
        ? Math.max(0, Math.min(100, Math.round(payload.coverage_score)))
        : 0;
      const coachStatus = typeof payload.status_label === "string" ? payload.status_label : "Keep scanning";
      const completedTargets = typeof payload.completed_targets === "number" ? payload.completed_targets : 0;
      coachStatusEl.textContent = `${{coachStatus}} • completed: ${{completedTargets}}`;
      coachCoverageEl.textContent = `${{coverage}}%`;
      coachBarEl.style.width = `${{coverage}}%`;
      const targetSummaries = Array.isArray(payload.targets) ? payload.targets : [];
      if (targetSummaries.length > 0) {{
        const previousTargetsById = new Map(captureTargets.map((target) => [target.id, target]));
        const nextTargets = [];
        const nextCounts = {{}};
        targetSummaries.forEach((item, index) => {{
          const fallbackId = `object_${{index + 1}}`;
          const targetId = typeof item.target_id === "string" && item.target_id.trim().length > 0
            ? item.target_id.trim()
            : fallbackId;
          const targetLabel = typeof item.target_label === "string" && item.target_label.trim().length > 0
            ? item.target_label.trim()
            : `Object ${{index + 1}}`;
          const targetFamily = normalizeTargetFamily(item.primitive_family, null);
          const frameCount = typeof item.frame_count === "number" ? Math.max(0, Math.round(item.frame_count)) : 0;
          const previousTarget = previousTargetsById.get(targetId);
          nextTargets.push({{
            id: targetId,
            label: targetLabel,
            family: targetFamily || (previousTarget && typeof previousTarget.family === "string" ? previousTarget.family : "box"),
            level: previousTarget && typeof previousTarget.level === "string" ? previousTarget.level : "middle",
            order: previousTarget && typeof previousTarget.order === "number" ? previousTarget.order : index + 1,
          }});
          nextCounts[targetId] = frameCount;
        }});
        captureTargets = nextTargets;
        targetFrameCounts = nextCounts;
      }}
      if (typeof payload.active_target_id === "string" && payload.active_target_id.trim().length > 0) {{
        const activeId = payload.active_target_id.trim();
        const existsById = captureTargets.some((target) => target.id === activeId);
        if (existsById) {{
          activeTargetId = activeId;
        }}
      }} else if (typeof payload.active_target_label === "string" && payload.active_target_label.trim().length > 0) {{
        const activeLabel = payload.active_target_label.trim();
        const existingTarget = captureTargets.find((target) => target.label === activeLabel);
        if (existingTarget) {{
          activeTargetId = existingTarget.id;
        }}
      }}
      if (!captureTargets.some((target) => target.id === activeTargetId) && captureTargets.length > 0) {{
        activeTargetId = captureTargets[0].id;
      }}
      coachGuidanceEl.innerHTML = "";
      const guidance = Array.isArray(payload.guidance) ? payload.guidance : [];
      const items = guidance.length > 0 ? guidance.slice(0, 4) : ["Move around object for better coverage."];
      items.forEach((text) => {{
        const li = document.createElement("li");
        li.textContent = String(text);
        coachGuidanceEl.appendChild(li);
      }});
      updateHudCounters(coverage);
      renderTargets();
    }}

    async function pollCoach() {{
      try {{
        const response = await fetch(coachEndpoint);
        if (!response.ok) {{
          throw new Error(`coach unavailable (${{response.status}})`);
        }}
        const payload = await response.json();
        renderCoach(payload);
      }} catch (_error) {{
        setCoachFallback("Coach unavailable");
      }}
    }}

    function startCoachPolling() {{
      if (coachPollTimer !== null) return;
      void pollCoach();
      coachPollTimer = window.setInterval(() => {{
        void pollCoach();
      }}, COACH_POLL_INTERVAL_MS);
    }}

    function stopCoachPolling() {{
      if (coachPollTimer === null) return;
      window.clearInterval(coachPollTimer);
      coachPollTimer = null;
    }}

    function setCameraRunning(isRunning) {{
      cameraRunning = isRunning;
      startBtn.disabled = isRunning;
      stopBtn.disabled = !isRunning;
      updateHudConnectionState(statusEl ? statusEl.textContent : "");
    }}

    function handleDeviceOrientation(event) {{
      latestOrientation = {{
        alpha: typeof event.alpha === "number" ? event.alpha : null,
        beta: typeof event.beta === "number" ? event.beta : null,
        gamma: typeof event.gamma === "number" ? event.gamma : null,
        absolute: Boolean(event.absolute),
      }};
    }}

    function handleDeviceMotion(event) {{
      latestMotion = {{
        interval_ms: typeof event.interval === "number" ? event.interval : null,
        acceleration: event.acceleration
          ? {{
              x: typeof event.acceleration.x === "number" ? event.acceleration.x : null,
              y: typeof event.acceleration.y === "number" ? event.acceleration.y : null,
              z: typeof event.acceleration.z === "number" ? event.acceleration.z : null,
            }}
          : null,
        acceleration_gravity: event.accelerationIncludingGravity
          ? {{
              x: typeof event.accelerationIncludingGravity.x === "number" ? event.accelerationIncludingGravity.x : null,
              y: typeof event.accelerationIncludingGravity.y === "number" ? event.accelerationIncludingGravity.y : null,
              z: typeof event.accelerationIncludingGravity.z === "number" ? event.accelerationIncludingGravity.z : null,
            }}
          : null,
        rotation_rate: event.rotationRate
          ? {{
              alpha: typeof event.rotationRate.alpha === "number" ? event.rotationRate.alpha : null,
              beta: typeof event.rotationRate.beta === "number" ? event.rotationRate.beta : null,
              gamma: typeof event.rotationRate.gamma === "number" ? event.rotationRate.gamma : null,
            }}
          : null,
      }};
    }}

    function attachSensorListeners() {{
      if (sensorListenersAttached) return;
      window.addEventListener("deviceorientation", handleDeviceOrientation, true);
      window.addEventListener("devicemotion", handleDeviceMotion, true);
      sensorListenersAttached = true;
    }}

    function detachSensorListeners() {{
      if (!sensorListenersAttached) return;
      window.removeEventListener("deviceorientation", handleDeviceOrientation, true);
      window.removeEventListener("devicemotion", handleDeviceMotion, true);
      sensorListenersAttached = false;
    }}

    async function detectArSupport() {{
      if (arSupportKnown) return;
      arSupportKnown = true;
      if (!navigator.xr || typeof navigator.xr.isSessionSupported !== "function") {{
        arSupported = false;
        return;
      }}
      try {{
        arSupported = Boolean(await navigator.xr.isSessionSupported("immersive-ar"));
      }} catch (_error) {{
        arSupported = false;
      }}
    }}

    async function requestSensorPermissions() {{
      if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {{
        try {{
          motionPermissionState = await DeviceMotionEvent.requestPermission();
        }} catch (_error) {{
          motionPermissionState = "denied";
        }}
      }} else {{
        motionPermissionState = "granted";
      }}

      if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {{
        try {{
          orientationPermissionState = await DeviceOrientationEvent.requestPermission();
        }} catch (_error) {{
          orientationPermissionState = "denied";
        }}
      }} else {{
        orientationPermissionState = "granted";
      }}
    }}

    async function initSensorCapture() {{
      await detectArSupport();
      await requestSensorPermissions();
      attachSensorListeners();
    }}

    function buildCameraIntrinsics(width, height) {{
      const cx = width / 2;
      const cy = height / 2;
      const fallbackFovDeg = 60;
      const fx = width / (2 * Math.tan((fallbackFovDeg * Math.PI) / 360));
      const fy = fx;
      const track = mediaStream && mediaStream.getVideoTracks ? mediaStream.getVideoTracks()[0] : null;
      const settings = track && typeof track.getSettings === "function" ? track.getSettings() : null;
      const fovDeg = settings && typeof settings.fov === "number" ? settings.fov : fallbackFovDeg;
      return {{
        fx_px: fx,
        fy_px: fy,
        cx_px: cx,
        cy_px: cy,
        width_px: width,
        height_px: height,
        model: "pinhole",
        estimated: true,
        source: "qr-browser-default",
        fov_deg: fovDeg,
      }};
    }}

    function buildFrameMetadata(width, height) {{
      const activeTarget = getActiveTarget();
      const activeTargetIndex = captureTargets.findIndex((target) => target.id === activeTargetId);
      const includeStaticMetadata = frameSequence === 1 || frameSequence % 15 === 0;
      const screenOrientation = window.screen && window.screen.orientation
        ? (window.screen.orientation.type || null)
        : (typeof window.orientation === "number" ? String(window.orientation) : null);
      const pose = latestOrientation
        ? {{
            yaw_deg: latestOrientation.alpha,
            pitch_deg: latestOrientation.beta,
            roll_deg: latestOrientation.gamma,
            absolute: latestOrientation.absolute,
            screen_orientation: screenOrientation,
          }}
        : null;
      return {{
        capture_profile: "qr-web-lite",
        frame_sequence: frameSequence,
        client_time_ms: Date.now(),
        video_width: width,
        video_height: height,
        capture_target: {{
          id: activeTarget ? activeTarget.id : "object_1",
          label: activeTarget ? activeTarget.label : "Object 1",
          family: activeTarget && typeof activeTarget.family === "string" ? normalizeTargetFamily(activeTarget.family) : "box",
          primitive_family: activeTarget && typeof activeTarget.family === "string" ? normalizeTargetFamily(activeTarget.family) : "box",
          index: activeTargetIndex >= 0 ? activeTargetIndex : 0,
          level: activeTarget && typeof activeTarget.level === "string" ? activeTarget.level : "middle",
          order: activeTarget && typeof activeTarget.order === "number" ? activeTarget.order : (activeTargetIndex >= 0 ? activeTargetIndex + 1 : 1),
        }},
        stack_capture: {{
          enabled: stackModeEnabled && captureScenario === "stacked_objects",
          stack_group_id: stackModeEnabled && activeStackGroupId ? activeStackGroupId : null,
          phase: stackPassPhase,
          expected_total_objects: captureTargets.length,
        }},
        capture_scenario: captureScenario,
        stream_tuning: {{
          capture_interval_ms: currentCaptureIntervalMs,
          jpeg_quality: currentJpegQuality,
          max_width_px: currentMaxWidth,
          max_in_flight_uploads: MAX_IN_FLIGHT_UPLOADS,
        }},
        camera_intrinsics: includeStaticMetadata ? buildCameraIntrinsics(width, height) : null,
        orientation: latestOrientation,
        motion: latestMotion,
        imu: {{
          orientation: latestOrientation,
          motion: latestMotion,
        }},
        pose,
        depth: {{
          available: false,
          source: null,
          reason: "web-depth-not-enabled",
        }},
        capabilities: includeStaticMetadata ? {{
          webxr_ar_supported: arSupportKnown ? arSupported : null,
          motion_permission: motionPermissionState,
          orientation_permission: orientationPermissionState,
        }} : null,
      }};
    }}

    async function registerStream() {{
      if (streamRegistered) return;
      try {{
        const response = await fetch(streamEndpoint, {{
          method: "POST",
          headers: {{ "Content-Type": "application/json" }},
          body: JSON.stringify({{
            video_stream_url: "camera://phone-live",
            source: "phone-camera",
            note: navigator.userAgent.slice(0, 200)
          }})
        }});
        if (!response.ok) {{
          throw new Error(`stream registration failed (${{response.status}})`);
        }}
        streamRegistered = true;
      }} catch (error) {{
        const message = error && error.message ? error.message : "stream registration failed";
        setStatus(`Camera ready. ${{message}}`);
      }}
    }}

    async function captureAndSendFrame() {{
      if (!cameraRunning) return;
      if (uploadInFlight >= MAX_IN_FLIGHT_UPLOADS) return;
      if (!videoEl.videoWidth || !videoEl.videoHeight) return;
      frameSequence += 1;
      const scale = Math.min(1, currentMaxWidth / videoEl.videoWidth);
      const width = Math.max(2, Math.round(videoEl.videoWidth * scale));
      const height = Math.max(2, Math.round(videoEl.videoHeight * scale));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(videoEl, 0, 0, width, height);
      const blob = await blobFromCanvas(canvas, currentJpegQuality);
      if (!blob) return;
      uploadInFlight += 1;
      const uploadStartedAtMs = Date.now();
      try {{
        const metadata = buildFrameMetadata(width, height);
        const response = await fetch(frameEndpoint, {{
          method: "POST",
          headers: {{
            "Content-Type": "image/jpeg",
            "X-Cam-To-Sim-Meta": JSON.stringify(metadata)
          }},
          body: blob
        }});
        if (!response.ok) {{
          throw new Error(`frame upload failed (${{response.status}})`);
        }}
        const payload = await response.json();
        if (!cameraRunning) {{
          return;
        }}
        sentFrames = Number(payload.frame_count || sentFrames + 1);
        lastUploadRttMs = Math.max(0, Date.now() - uploadStartedAtMs);
        uploadErrorCount = 0;
        applyAdaptiveTune({{ ok: true, rttMs: lastUploadRttMs }});
        const activeTarget = getActiveTarget();
        const activeId = activeTarget ? activeTarget.id : "object_1";
        targetFrameCounts[activeId] = (targetFrameCounts[activeId] || 0) + 1;
        renderTargets();
        const activeLabel = activeTarget ? activeTarget.label : "Object 1";
        const rttLabel = typeof lastUploadRttMs === "number" ? `${{lastUploadRttMs}}ms` : "--";
        const qualityLabel = Number(currentJpegQuality).toFixed(2);
        setStatus(
          `Streaming • frames ${{sentFrames}} • active ${{activeLabel}} ${{targetFrameCounts[activeId]}} • in-flight ${{uploadInFlight}} • rtt ${{rttLabel}} • ${{currentMaxWidth}}px q${{qualityLabel}} @${{currentCaptureIntervalMs}}ms`
        );
      }} catch (error) {{
        uploadErrorCount += 1;
        applyAdaptiveTune({{ ok: false }});
        const message = error && error.message ? error.message : "retrying frame upload";
        setStatus(`Camera connected • retries ${{uploadErrorCount}} • ${{message}}`);
      }} finally {{
        uploadInFlight = Math.max(0, uploadInFlight - 1);
      }}
    }}

    function scheduleCaptureTick() {{
      if (!captureLoopRunning) return;
      captureLoopTimer = window.setTimeout(() => {{
        void captureAndSendFrame();
        scheduleCaptureTick();
      }}, currentCaptureIntervalMs);
    }}

    function startCaptureLoop() {{
      if (captureLoopRunning) return;
      captureLoopRunning = true;
      scheduleCaptureTick();
    }}

    function stopCaptureLoop() {{
      captureLoopRunning = false;
      if (captureLoopTimer !== null) {{
        window.clearTimeout(captureLoopTimer);
        captureLoopTimer = null;
      }}
    }}

    async function startCamera() {{
      if (cameraRunning) return;
      try {{
        setStatus("Requesting camera permission...");
        resetAdaptiveTuning();
        uploadInFlight = 0;
        uploadErrorCount = 0;
        lastUploadRttMs = null;
        await initSensorCapture();
        const stream = await navigator.mediaDevices.getUserMedia({{
          video: CAMERA_CONSTRAINTS,
          audio: false
        }});
        mediaStream = stream;
        videoEl.srcObject = stream;
        await videoEl.play();
        await registerStream();
        setCameraRunning(true);
        setStatus("Camera connected. Adaptive streaming enabled...");
        startCaptureLoop();
      }} catch (error) {{
        setCameraRunning(false);
        const message = error && error.message ? error.message : "Camera permission denied.";
        setStatus(`Failed to start camera: ${{message}}`);
      }}
    }}

    function stopCamera() {{
      stopCaptureLoop();
      if (mediaStream) {{
        mediaStream.getTracks().forEach((track) => track.stop());
      }}
      detachSensorListeners();
      mediaStream = null;
      videoEl.srcObject = null;
      setCameraRunning(false);
      resetAdaptiveTuning();
      setStatus(`Camera stopped. Frames sent: ${{sentFrames}}`);
    }}

    addTargetBtn.addEventListener("click", () => {{
      const selectedFamily = targetFamilySelectEl ? targetFamilySelectEl.value : "box";
      addTarget(targetNameInputEl.value, selectedFamily);
      targetNameInputEl.value = "";
    }});
    nextTargetBtn.addEventListener("click", () => {{
      selectNextTarget();
    }});
    if (hudNextTargetBtnEl) {{
      hudNextTargetBtnEl.addEventListener("click", () => {{
        selectNextTarget();
      }});
    }}
    if (scenarioSingleBtn) {{
      scenarioSingleBtn.addEventListener("click", () => {{
        setCaptureScenario("single_object");
      }});
    }}
    if (scenarioMultiBtn) {{
      scenarioMultiBtn.addEventListener("click", () => {{
        setCaptureScenario("multi_objects");
      }});
    }}
    if (scenarioStackBtn) {{
      scenarioStackBtn.addEventListener("click", () => {{
        setCaptureScenario("stacked_objects");
      }});
    }}
    if (startStackBtn) {{
      startStackBtn.addEventListener("click", () => {{
        startStackMode();
      }});
    }}
    if (endStackBtn) {{
      endStackBtn.addEventListener("click", () => {{
        endStackMode();
      }});
    }}
    if (stackScenePassBtn) {{
      stackScenePassBtn.addEventListener("click", () => {{
        setStackPassPhase("scene_pass");
      }});
    }}
    if (stackObjectPassBtn) {{
      stackObjectPassBtn.addEventListener("click", () => {{
        setStackPassPhase("object_pass");
      }});
    }}
    if (levelBottomBtn) {{
      levelBottomBtn.addEventListener("click", () => {{
        setActiveTargetLevel("bottom");
      }});
    }}
    if (levelMiddleBtn) {{
      levelMiddleBtn.addEventListener("click", () => {{
        setActiveTargetLevel("middle");
      }});
    }}
    if (levelTopBtn) {{
      levelTopBtn.addEventListener("click", () => {{
        setActiveTargetLevel("top");
      }});
    }}
    startBtn.addEventListener("click", startCamera);
    stopBtn.addEventListener("click", stopCamera);
    window.addEventListener("beforeunload", () => {{
      stopCamera();
      stopCoachPolling();
    }});
    window.addEventListener("load", () => {{
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {{
        setStatus("This browser does not support camera streaming.");
        startBtn.disabled = true;
        return;
      }}
      renderTargets();
      renderStackMode();
      setStatus("Ready. Tap Start Camera.");
      startCoachPolling();
    }});
  </script>
</body>
</html>
"""


@router.post("/sessions", response_model=CamToSimSessionSnapshot)
async def create_cam_to_sim_session(
    request: Request,
    req: CamToSimSessionCreateRequest | None = None,
    _access: None = Depends(require_simulator_operator_access_async),
) -> CamToSimSessionSnapshot:
    payload = req or CamToSimSessionCreateRequest()
    base_url = _resolve_public_base_url(
        str(request.base_url),
        settings.cam_to_sim_public_base_url or payload.public_base_url,
    )
    return cam_to_sim_service.create_session(payload, base_url=base_url)


@router.get("/sessions/{session_id}", response_model=CamToSimSessionSnapshot)
async def get_cam_to_sim_session(
    session_id: str,
    _access: None = Depends(require_simulator_operator_access_async),
) -> CamToSimSessionSnapshot:
    return cam_to_sim_service.get_session(session_id)


@router.post("/sessions/{session_id}/stream", response_model=CamToSimStreamIngestResponse)
async def ingest_cam_to_sim_stream(
    session_id: str,
    req: CamToSimStreamIngestRequest,
    _access: None = Depends(require_cam_to_sim_session_access),
) -> CamToSimStreamIngestResponse:
    return cam_to_sim_service.register_stream(session_id, req)


@router.get(
    "/sessions/{session_id}/phone-frame-stats",
    response_model=CamToSimPhoneFrameStatsResponse,
)
async def get_cam_to_sim_phone_frame_stats(
    session_id: str,
    _access: None = Depends(require_simulator_operator_access_async),
) -> CamToSimPhoneFrameStatsResponse:
    return cam_to_sim_service.get_phone_frame_stats(session_id)


@router.get(
    "/sessions/{session_id}/capture-readiness",
    response_model=CamToSimCaptureReadinessResponse,
)
async def get_cam_to_sim_capture_readiness(
    session_id: str,
    _access: None = Depends(require_simulator_operator_access_async),
) -> CamToSimCaptureReadinessResponse:
    return cam_to_sim_service.get_capture_readiness(session_id)


@router.post(
    "/sessions/{session_id}/reset-frames",
    response_model=CamToSimPhoneFrameStatsResponse,
)
async def reset_cam_to_sim_phone_frames(
    session_id: str,
    _access: None = Depends(require_simulator_operator_access_async),
) -> CamToSimPhoneFrameStatsResponse:
    return cam_to_sim_service.reset_phone_frames(session_id)


@router.post(
    "/sessions/{session_id}/r2r2r/prepare",
    response_model=CamToSimR2R2RPrepareResponse,
)
async def prepare_cam_to_sim_r2r2r_export(
    session_id: str,
    _access: None = Depends(require_simulator_operator_access_async),
) -> CamToSimR2R2RPrepareResponse:
    return cam_to_sim_service.prepare_r2r2r_export(session_id)


@router.post(
    "/sessions/{session_id}/runtime-result",
    response_model=CamToSimRuntimeResultResponse,
)
async def run_cam_to_sim_runtime_result(
    session_id: str,
    _access: None = Depends(require_simulator_operator_access_async),
) -> CamToSimRuntimeResultResponse:
    return cam_to_sim_service.build_runtime_result(session_id)


@router.get("/sessions/{session_id}/frames/{filename}")
async def get_cam_to_sim_session_frame(
    session_id: str,
    filename: str,
    _access: None = Depends(require_simulator_operator_access_async),
) -> FileResponse:
    frame_path = cam_to_sim_service.get_phone_frame_file_path(session_id, filename)
    return FileResponse(path=frame_path)


@router.get("/connect/{session_id}", response_class=HTMLResponse)
async def render_cam_to_sim_connect_page(
    session_id: str,
    _access: None = Depends(require_cam_to_sim_session_access),
) -> HTMLResponse:
    session = cam_to_sim_service.get_session(session_id)
    html = _render_connect_page_html(
        session_id=session.session_id,
        ingest_url=session.ingest_stream_url,
        frame_ingest_url=_derive_session_endpoint_url(
            session.ingest_stream_url,
            action="phone-frame",
            extra_query={"source": "phone-camera"},
        ),
        coach_url=_derive_session_endpoint_url(
            session.ingest_stream_url,
            action="capture-coach",
        ),
    )
    return HTMLResponse(content=html)


@router.post("/sessions/{session_id}/phone-frame", response_model=CamToSimPhoneFrameResponse)
async def ingest_cam_to_sim_phone_frame(
    session_id: str,
    request: Request,
    source: str = "phone-camera",
    _access: None = Depends(require_cam_to_sim_session_access),
) -> CamToSimPhoneFrameResponse:
    content_type = request.headers.get("content-type", "application/octet-stream")
    frame_metadata: dict[str, object] | None = None
    raw_metadata = request.headers.get(CAM_TO_SIM_FRAME_METADATA_HEADER)
    if isinstance(raw_metadata, str) and 0 < len(raw_metadata) <= CAM_TO_SIM_FRAME_METADATA_MAX_CHARS:
        try:
            parsed_metadata = json.loads(raw_metadata)
            if isinstance(parsed_metadata, dict):
                frame_metadata = parsed_metadata
        except json.JSONDecodeError:
            frame_metadata = None
    frame_bytes = await request.body()
    return cam_to_sim_service.register_phone_frame(
        session_id,
        frame_bytes=frame_bytes,
        content_type=content_type,
        source=source,
        frame_metadata=frame_metadata,
    )
