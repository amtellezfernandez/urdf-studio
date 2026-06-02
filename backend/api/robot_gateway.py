from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from backend.models.robot_gateway import (
    RobotGatewayControlAck,
    RobotGatewayEnvConfigFile,
    RobotGatewayEnvConfigOpenResult,
    RobotGatewayEnvConfigUpdate,
    RobotGatewayJointJogRequest,
    RobotGatewayLeaseRequest,
    RobotGatewayLeaseResponse,
    RobotGatewayLeRobotCalibrationStartResult,
    RobotGatewayManifest,
    RobotGatewayOpenArmCalibrationJogRequest,
    RobotGatewayOpenArmCanDryRunPlan,
    RobotGatewayPointCloudFrame,
    RobotGatewaySessionSnapshot,
    RobotGatewayStateFrame,
    RobotGatewayStatsSnapshot,
    RobotGatewayTwistRequest,
)
from backend.robot_gateway.lerobot_calibration_catalog import (
    RobotGatewayLeRobotCalibrationCatalog,
    RobotGatewayLeRobotCalibrationFileSyncRequest,
    RobotGatewayLeRobotCalibrationFileSyncResult,
    RobotGatewayLeRobotCalibrationSource,
    RobotGatewayLeRobotCalibrationStartRequest,
    list_lerobot_calibration_catalog,
)
from backend.robot_gateway.lerobot_calibration_file_open import (
    open_lerobot_calibration_file,
    resolve_lerobot_calibration_path,
    stat_lerobot_calibration_file,
)
from backend.robot_gateway.openarm_leader_detection import (
    OpenArmLeaderDetectionResult,
    detect_openarm_leaders,
)
from backend.robot_gateway.openarm_leader_state import (
    OpenArmLeaderReleaseRequest,
    OpenArmLeaderReleaseResult,
    OpenArmLeaderStateResult,
    OpenArmLeaderStateSide,
    openarm_leader_state_service,
)
from backend.robot_gateway.lerobot_calibration import (
    start_lerobot_calibration,
    start_lerobot_leader_calibration,
)
from backend.robot_gateway.config_file import (
    open_robot_gateway_env_config_file,
    read_robot_gateway_env_config_file,
    write_robot_gateway_env_config_file,
)
from backend.robot_gateway.params import (
    ROBOT_GATEWAY_LEROBOT_ADAPTER_ID,
    ROBOT_GATEWAY_LEROBOT_CALIBRATION_ROOT_DEFAULT,
    ROBOT_GATEWAY_LEROBOT_ROBOT_CALIBRATION_RELATIVE_DIR,
)
from backend.robot_gateway.rest_authorization import (
    require_robot_gateway_control_access,
    require_robot_gateway_local_workstation_access,
)
from backend.robot_gateway.runtime import build_robot_gateway_runtime_from_env

router = APIRouter(prefix="/robot-gateway", tags=["robot-gateway"])
runtime = build_robot_gateway_runtime_from_env()


@router.get(
    "/.well-known/urdf-studio-teleop.json",
    response_model=RobotGatewayManifest,
    response_model_by_alias=False,
)
def get_robot_gateway_manifest() -> RobotGatewayManifest:
    manifest = runtime.get_manifest()
    return manifest.model_copy(
        update={
            "live_transport": None,
            "control_transport": None,
        }
    )


@router.get(
    "/manifest",
    response_model=RobotGatewayManifest,
    response_model_by_alias=False,
)
def get_authorized_robot_gateway_manifest(
    _access: None = Depends(require_robot_gateway_control_access),
) -> RobotGatewayManifest:
    return runtime.get_manifest()


@router.get("/session", response_model=RobotGatewaySessionSnapshot)
def get_robot_gateway_session() -> RobotGatewaySessionSnapshot:
    return runtime.get_session()


@router.get("/stats", response_model=RobotGatewayStatsSnapshot)
def get_robot_gateway_stats() -> RobotGatewayStatsSnapshot:
    return runtime.get_stats()


@router.get("/telemetry/state", response_model=RobotGatewayStateFrame)
def get_robot_gateway_state() -> RobotGatewayStateFrame:
    return runtime.read_state()


@router.get(
    "/config/env",
    response_model=RobotGatewayEnvConfigFile,
    response_model_by_alias=False,
)
def get_robot_gateway_env_config(
    _access: None = Depends(require_robot_gateway_local_workstation_access),
) -> RobotGatewayEnvConfigFile:
    return read_robot_gateway_env_config_file()


@router.put(
    "/config/env",
    response_model=RobotGatewayEnvConfigFile,
    response_model_by_alias=False,
)
def update_robot_gateway_env_config(
    req: RobotGatewayEnvConfigUpdate,
    _access: None = Depends(require_robot_gateway_local_workstation_access),
) -> RobotGatewayEnvConfigFile:
    return write_robot_gateway_env_config_file(req.content)


@router.post(
    "/config/env/open",
    response_model=RobotGatewayEnvConfigOpenResult,
    response_model_by_alias=False,
)
def open_robot_gateway_env_config(
    _access: None = Depends(require_robot_gateway_local_workstation_access),
) -> RobotGatewayEnvConfigOpenResult:
    return open_robot_gateway_env_config_file()


@router.get(
    "/hardware/leaders",
    response_model=OpenArmLeaderDetectionResult,
    response_model_by_alias=False,
)
def detect_robot_gateway_hardware_leaders() -> OpenArmLeaderDetectionResult:
    return detect_openarm_leaders()


@router.get(
    "/hardware/openarm/leaders",
    response_model=OpenArmLeaderDetectionResult,
    response_model_by_alias=False,
    include_in_schema=False,
)
def detect_robot_gateway_openarm_leaders() -> OpenArmLeaderDetectionResult:
    return detect_robot_gateway_hardware_leaders()


@router.get(
    "/hardware/lerobot/calibrations",
    response_model=RobotGatewayLeRobotCalibrationCatalog,
    response_model_by_alias=False,
)
def list_robot_gateway_lerobot_calibrations(
    _access: None = Depends(require_robot_gateway_local_workstation_access),
) -> RobotGatewayLeRobotCalibrationCatalog:
    adapter_config = runtime.config.adapter_config
    active_source = _build_active_lerobot_calibration_source()
    extra_dirs = (
        [adapter_config.lerobot_calibration_dir]
        if adapter_config.lerobot_calibration_dir is not None
        else []
    )
    return list_lerobot_calibration_catalog(
        extra_calibration_dirs=extra_dirs,
        active_source=active_source,
    )


def _build_active_lerobot_calibration_source(
) -> RobotGatewayLeRobotCalibrationSource | None:
    adapter_config = runtime.config.adapter_config
    if adapter_config.adapter_kind != ROBOT_GATEWAY_LEROBOT_ADAPTER_ID:
        return None
    calibration_id = (adapter_config.lerobot_id or adapter_config.robot_id).strip()
    robot_type = adapter_config.lerobot_robot_type.strip()
    if not calibration_id:
        return None
    if adapter_config.lerobot_calibration_dir is not None:
        calibration_dir = adapter_config.lerobot_calibration_dir.expanduser()
    elif robot_type:
        calibration_dir = (
            Path(ROBOT_GATEWAY_LEROBOT_CALIBRATION_ROOT_DEFAULT).expanduser()
            / ROBOT_GATEWAY_LEROBOT_ROBOT_CALIBRATION_RELATIVE_DIR
            / robot_type
        )
    else:
        return None
    return RobotGatewayLeRobotCalibrationSource(
        category=ROBOT_GATEWAY_LEROBOT_ROBOT_CALIBRATION_RELATIVE_DIR,
        profileId=calibration_dir.name,
        calibrationId=calibration_id,
        calibrationDir=str(calibration_dir),
        groupId="all",
    )


@router.post(
    "/hardware/lerobot/calibrations/open",
    response_model=RobotGatewayEnvConfigOpenResult,
    response_model_by_alias=False,
)
def open_robot_gateway_lerobot_calibration(
    req: RobotGatewayLeRobotCalibrationStartRequest,
    _access: None = Depends(require_robot_gateway_local_workstation_access),
) -> RobotGatewayEnvConfigOpenResult:
    if req.calibration_source is None:
        raise HTTPException(status_code=400, detail="Calibration source is required.")
    try:
        return open_lerobot_calibration_file(req.calibration_source)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/hardware/lerobot/calibrations/sync",
    response_model=RobotGatewayLeRobotCalibrationFileSyncResult,
    response_model_by_alias=False,
)
def sync_robot_gateway_lerobot_calibration_file(
    req: RobotGatewayLeRobotCalibrationFileSyncRequest,
    _access: None = Depends(require_robot_gateway_local_workstation_access),
) -> RobotGatewayLeRobotCalibrationFileSyncResult:
    if req.calibration_source is None:
        raise HTTPException(status_code=400, detail="Calibration source is required.")
    try:
        initial = stat_lerobot_calibration_file(
            req.calibration_source,
            last_mtime_ns=req.last_mtime_ns,
        )
        if not initial.changed:
            return initial
        return _reload_robot_gateway_lerobot_calibration_file(
            req,
            leader_released_message="Reloaded selected leader calibration.",
            leader_deferred_message=(
                "Selected leader calibration will reload on the next read."
            ),
            follower_fallback_message="Reloaded follower calibration.",
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _reload_robot_gateway_lerobot_calibration_file(
    req: RobotGatewayLeRobotCalibrationFileSyncRequest,
    *,
    leader_released_message: str,
    leader_deferred_message: str,
    follower_fallback_message: str,
) -> RobotGatewayLeRobotCalibrationFileSyncResult:
    if req.calibration_source is None:
        raise ValueError("Calibration source is required.")
    calibration_path = resolve_lerobot_calibration_path(req.calibration_source)
    if req.role == "leader":
        released = openarm_leader_state_service.release(
            port=req.leader_port,
            motor_ids=req.leader_motor_ids,
            motor_model=req.leader_motor_model,
            calibration_category=req.calibration_source.category,
            calibration_profile=req.calibration_source.profile_id,
            calibration_id=req.calibration_source.calibration_id,
            calibration_group=req.calibration_source.group_id,
        ).released
        return stat_lerobot_calibration_file(
            req.calibration_source,
            last_mtime_ns=req.last_mtime_ns,
            applied=True,
            message=(
                leader_released_message
                if released
                else leader_deferred_message
            ),
        )
    reload_result = runtime.reload_lerobot_calibration_file(calibration_path)
    return stat_lerobot_calibration_file(
        req.calibration_source,
        last_mtime_ns=req.last_mtime_ns,
        applied=reload_result.applied,
        message=(
            reload_result.message
            or follower_fallback_message
        ),
    )


@router.get(
    "/hardware/leader-state",
    response_model=OpenArmLeaderStateResult,
    response_model_by_alias=False,
)
def read_robot_gateway_hardware_leader_state(
    port: str,
    side: OpenArmLeaderStateSide = "both",
    motor_ids: str | None = None,
    motor_model: str | None = None,
    calibration_category: str | None = None,
    calibration_profile: str | None = None,
    calibration_id: str | None = None,
    calibration_group: str | None = None,
) -> OpenArmLeaderStateResult:
    return openarm_leader_state_service.read_state(
        port=port,
        side=side,
        motor_ids=_parse_motor_ids_query(motor_ids),
        motor_model=motor_model,
        calibration_category=calibration_category,
        calibration_profile=calibration_profile,
        calibration_id=calibration_id,
        calibration_group=calibration_group,
    )


@router.post(
    "/hardware/leaders/release",
    response_model=OpenArmLeaderReleaseResult,
    response_model_by_alias=False,
)
def release_robot_gateway_hardware_leaders(
    req: OpenArmLeaderReleaseRequest | None = None,
) -> OpenArmLeaderReleaseResult:
    if req is None:
        return openarm_leader_state_service.release_all()
    return openarm_leader_state_service.release(
        port=req.port,
        motor_ids=req.motor_ids,
        motor_model=req.motor_model,
        calibration_category=req.calibration_category,
        calibration_profile=req.calibration_profile,
        calibration_id=req.calibration_id,
        calibration_group=req.calibration_group,
    )


@router.post(
    "/hardware/leaders/calibration/start",
    response_model=RobotGatewayLeRobotCalibrationStartResult,
    response_model_by_alias=False,
)
def start_robot_gateway_leader_calibration(
    req: OpenArmLeaderReleaseRequest,
    _access: None = Depends(require_robot_gateway_local_workstation_access),
) -> RobotGatewayLeRobotCalibrationStartResult:
    openarm_leader_state_service.release(
        port=req.port,
        motor_ids=req.motor_ids,
        motor_model=req.motor_model,
        calibration_category=req.calibration_category,
        calibration_profile=req.calibration_profile,
        calibration_id=req.calibration_id,
        calibration_group=req.calibration_group,
    )
    return start_lerobot_leader_calibration(
        port=req.port,
        motor_ids=req.motor_ids,
        motor_model=req.motor_model,
        calibration_profile=req.calibration_profile,
        calibration_id=req.calibration_id,
    )


@router.post(
    "/hardware/follower/release",
    response_model=OpenArmLeaderReleaseResult,
    response_model_by_alias=False,
)
def release_robot_gateway_hardware_follower(
    _access: None = Depends(require_robot_gateway_control_access),
) -> OpenArmLeaderReleaseResult:
    return OpenArmLeaderReleaseResult(released=runtime.release_hardware())


@router.post(
    "/hardware/follower/calibration/start",
    response_model=RobotGatewayLeRobotCalibrationStartResult,
    response_model_by_alias=False,
)
def start_robot_gateway_follower_calibration(
    req: RobotGatewayLeRobotCalibrationStartRequest | None = None,
    _access: None = Depends(require_robot_gateway_local_workstation_access),
) -> RobotGatewayLeRobotCalibrationStartResult:
    runtime.release_hardware()
    return start_lerobot_calibration(
        runtime.config.adapter_config,
        calibration_source=req.calibration_source if req is not None else None,
    )


@router.get(
    "/hardware/openarm/leader-state",
    response_model=OpenArmLeaderStateResult,
    response_model_by_alias=False,
    include_in_schema=False,
)
def read_robot_gateway_openarm_leader_state(
    port: str,
    side: OpenArmLeaderStateSide = "both",
    motor_ids: str | None = None,
    motor_model: str | None = None,
    calibration_category: str | None = None,
    calibration_profile: str | None = None,
    calibration_id: str | None = None,
    calibration_group: str | None = None,
) -> OpenArmLeaderStateResult:
    return read_robot_gateway_hardware_leader_state(
        port=port,
        side=side,
        motor_ids=motor_ids,
        motor_model=motor_model,
        calibration_category=calibration_category,
        calibration_profile=calibration_profile,
        calibration_id=calibration_id,
        calibration_group=calibration_group,
    )


@router.post(
    "/hardware/openarm/leaders/release",
    response_model=OpenArmLeaderReleaseResult,
    response_model_by_alias=False,
    include_in_schema=False,
)
def release_robot_gateway_openarm_leaders(
    req: OpenArmLeaderReleaseRequest | None = None,
) -> OpenArmLeaderReleaseResult:
    return release_robot_gateway_hardware_leaders(req)


def _parse_motor_ids_query(value: str | None) -> tuple[int, ...] | None:
    if value is None or not value.strip():
        return None
    motor_ids: list[int] = []
    for raw_token in value.split(","):
        token = raw_token.strip()
        if not token:
            continue
        try:
            motor_id = int(token)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail="motor_ids must be a comma-separated list of positive integers.",
            ) from exc
        if motor_id <= 0:
            raise HTTPException(
                status_code=400,
                detail="motor_ids must contain positive integers.",
            )
        motor_ids.append(motor_id)
    if len(set(motor_ids)) != len(motor_ids):
        raise HTTPException(
            status_code=400,
            detail="motor_ids must not contain duplicates.",
        )
    return tuple(motor_ids) or None


@router.get(
    "/perception/cameras/{camera_id}/point-cloud",
    response_model=RobotGatewayPointCloudFrame,
    response_model_by_alias=False,
)
def get_robot_gateway_point_cloud(camera_id: str) -> RobotGatewayPointCloudFrame:
    return runtime.read_point_cloud(camera_id)


@router.post("/lease/request", response_model=RobotGatewayLeaseResponse)
def request_robot_gateway_lease(
    req: RobotGatewayLeaseRequest,
    _access: None = Depends(require_robot_gateway_control_access),
) -> RobotGatewayLeaseResponse:
    return runtime.request_lease(req)


@router.post("/lease/release", response_model=RobotGatewayLeaseResponse)
def release_robot_gateway_lease(
    req: RobotGatewayLeaseRequest,
    _access: None = Depends(require_robot_gateway_control_access),
) -> RobotGatewayLeaseResponse:
    return runtime.release_lease(req)


@router.post("/control/joint-jog", response_model=RobotGatewayControlAck)
def apply_robot_gateway_joint_jog(
    req: RobotGatewayJointJogRequest,
    _access: None = Depends(require_robot_gateway_control_access),
) -> RobotGatewayControlAck:
    return runtime.apply_joint_jog(req)


@router.post("/hardware/openarm/calibration/joint-jog", response_model=RobotGatewayControlAck)
def apply_robot_gateway_openarm_calibration_jog(
    req: RobotGatewayOpenArmCalibrationJogRequest,
    _access: None = Depends(require_robot_gateway_control_access),
) -> RobotGatewayControlAck:
    return runtime.apply_openarm_calibration_jog(req)


@router.post(
    "/control/joint-jog/can-dry-run",
    response_model=RobotGatewayOpenArmCanDryRunPlan,
    response_model_by_alias=False,
)
def prepare_robot_gateway_joint_jog_can_dry_run(
    req: RobotGatewayJointJogRequest,
    _access: None = Depends(require_robot_gateway_control_access),
) -> RobotGatewayOpenArmCanDryRunPlan:
    return runtime.prepare_joint_jog_can_dry_run(req)


@router.post("/control/twist", response_model=RobotGatewayControlAck)
def apply_robot_gateway_twist(
    req: RobotGatewayTwistRequest,
    _access: None = Depends(require_robot_gateway_control_access),
) -> RobotGatewayControlAck:
    return runtime.apply_twist(req)


@router.post("/control/stop", response_model=RobotGatewayControlAck)
def stop_robot_gateway(
    _access: None = Depends(require_robot_gateway_control_access),
) -> RobotGatewayControlAck:
    return runtime.stop()


@router.post("/control/estop", response_model=RobotGatewayControlAck)
def estop_robot_gateway(
    _access: None = Depends(require_robot_gateway_control_access),
) -> RobotGatewayControlAck:
    return runtime.estop()
