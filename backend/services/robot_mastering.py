from __future__ import annotations

import json
import subprocess
import threading
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from backend.models.robot_mastering import (
    BakeExportExecuteRequest,
    BakeExportExecuteResponse,
    CanonicalSynthesisRequest,
    CanonicalSynthesisResponse,
    FramePreflightRequest,
    FramePreflightResponse,
    GeneratePhysicsPreflightRequest,
    GeneratePhysicsPreflightResponse,
    GeneratePhysicsJobRequest,
    GeneratePhysicsJobResultResponse,
    RobotMasteringJobCreatedResponse,
    RobotMasteringJobStatusResponse,
    RobotMasteringJobStatus,
    RobotMasteringJobType,
    RobotMasteringPayload,
)
from backend.services.robot_mastering_params import (
    ROBOT_MASTERING_ARTIFACT_DRAFT_URDF,
    ROBOT_MASTERING_JOB_TIMEOUT_SEC,
    ROBOT_MASTERING_NODE_BINARY,
    ROBOT_MASTERING_RUNNER_SCRIPT_PATH,
)

@dataclass(frozen=True)
class RobotMasteringError(RuntimeError):
    status_code: int
    detail: str


@dataclass(frozen=True)
class RobotMasteringJobRecord:
    job_id: str
    job_type: RobotMasteringJobType
    status: RobotMasteringJobStatus
    created_at: str
    updated_at: str
    error: str | None = None
    result: RobotMasteringPayload | None = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_script_exists(script_path: Path) -> Path:
    if not script_path.exists():
        raise RobotMasteringError(
            status_code=500,
            detail=f"Robot mastering runner not found at {script_path}",
        )
    return script_path


def _run_robot_mastering_command(payload: RobotMasteringPayload) -> RobotMasteringPayload:
    script_path = _ensure_script_exists(ROBOT_MASTERING_RUNNER_SCRIPT_PATH)
    command = [
        ROBOT_MASTERING_NODE_BINARY,
        str(script_path),
    ]

    try:
        completed = subprocess.run(
            command,
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=ROBOT_MASTERING_JOB_TIMEOUT_SEC,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RobotMasteringError(
            status_code=504,
            detail="Robot mastering job timed out.",
        ) from exc
    except OSError as exc:
        raise RobotMasteringError(
            status_code=500,
            detail=f"Failed to launch robot mastering runner: {exc}",
        ) from exc

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "Robot mastering job failed.").strip()
        raise RobotMasteringError(status_code=500, detail=detail)

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise RobotMasteringError(
            status_code=500,
            detail="Robot mastering runner returned invalid JSON.",
        ) from exc

    if not isinstance(payload, dict):
        raise RobotMasteringError(
            status_code=500,
            detail="Robot mastering runner returned an invalid result payload.",
        )
    return payload


def _run_generate_physics_command(request: GeneratePhysicsJobRequest) -> RobotMasteringPayload:
    return _run_robot_mastering_command(
        {
            "operation": "generate-physics",
            **request.model_dump(mode="json", by_alias=True),
        }
    )


def _run_generate_physics_preflight_command(
    request: GeneratePhysicsPreflightRequest,
) -> RobotMasteringPayload:
    return _run_robot_mastering_command(
        {
            "operation": "generate-physics-preflight",
            **request.model_dump(mode="json", by_alias=True),
        }
    )


def _run_frame_preflight_command(
    request: FramePreflightRequest,
) -> RobotMasteringPayload:
    return _run_robot_mastering_command(
        {
            "operation": "frame-preflight",
            **request.model_dump(mode="json", by_alias=True),
        }
    )


def _run_bake_export_execute_command(
    request: BakeExportExecuteRequest,
) -> RobotMasteringPayload:
    return _run_robot_mastering_command(
        {
            "operation": "bake-export-execute",
            **request.model_dump(mode="json", by_alias=True),
        }
    )


def _run_canonical_synthesis_command(
    request: CanonicalSynthesisRequest,
) -> RobotMasteringPayload:
    return _run_robot_mastering_command(
        {
            "operation": "canonical-synthesis",
            **request.model_dump(mode="json", by_alias=True),
        }
    )


class RobotMasteringService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, RobotMasteringJobRecord] = {}

    def create_generate_physics_job(
        self, request: GeneratePhysicsJobRequest
    ) -> RobotMasteringJobCreatedResponse:
        created_at = _now_iso()
        job_id = f"rm-{uuid4().hex}"
        record = RobotMasteringJobRecord(
            job_id=job_id,
            job_type="generate-physics",
            status="queued",
            created_at=created_at,
            updated_at=created_at,
        )
        with self._lock:
            self._jobs[job_id] = record

        worker = threading.Thread(
            target=self._run_generate_physics_job,
            args=(job_id, request),
            daemon=True,
            name=f"robot-mastering-{job_id}",
        )
        worker.start()

        return RobotMasteringJobCreatedResponse(
            jobId=job_id,
            jobType="generate-physics",
            status="queued",
        )

    def run_generate_physics_preflight(
        self, request: GeneratePhysicsPreflightRequest
    ) -> GeneratePhysicsPreflightResponse:
        result = _run_generate_physics_preflight_command(request)
        return GeneratePhysicsPreflightResponse(
            auditSummary=result.get("auditSummary"),
            plausibilitySummary=result.get("plausibilitySummary"),
        )

    def run_frame_preflight(
        self, request: FramePreflightRequest
    ) -> FramePreflightResponse:
        result = _run_frame_preflight_command(request)
        return FramePreflightResponse(
            orientationCard=result.get("orientationCard"),
            frameLint=result.get("frameLint"),
        )

    def run_bake_export_execute(
        self, request: BakeExportExecuteRequest
    ) -> BakeExportExecuteResponse:
        result = _run_bake_export_execute_command(request)
        return BakeExportExecuteResponse(
            overrides=result.get("overrides") or [],
            unsupported=result.get("unsupported") or [],
        )

    def run_canonical_synthesis(
        self, request: CanonicalSynthesisRequest
    ) -> CanonicalSynthesisResponse:
        result = _run_canonical_synthesis_command(request)
        return CanonicalSynthesisResponse(
            preview=result.get("preview") or {},
            draftContent=str(result.get("draftContent") or ""),
        )

    def _run_generate_physics_job(self, job_id: str, request: GeneratePhysicsJobRequest) -> None:
        self._update_job(job_id, status="running", error=None, result=None)
        try:
            result = _run_generate_physics_command(request)
        except RobotMasteringError as exc:
            self._update_job(job_id, status="failed", error=exc.detail, result=None)
            return
        self._update_job(job_id, status="succeeded", error=None, result=result)

    def _update_job(
        self,
        job_id: str,
        *,
        status: RobotMasteringJobStatus,
        error: str | None,
        result: RobotMasteringPayload | None,
    ) -> None:
        with self._lock:
            current = self._jobs.get(job_id)
            if current is None:
                return
            self._jobs[job_id] = replace(
                current,
                status=status,
                error=error,
                result=result,
                updated_at=_now_iso(),
            )

    def get_job_status(self, job_id: str) -> RobotMasteringJobStatusResponse:
        job = self._require_job(job_id)
        return RobotMasteringJobStatusResponse(
            jobId=job.job_id,
            jobType=job.job_type,
            status=job.status,
            createdAt=job.created_at,
            updatedAt=job.updated_at,
            error=job.error,
        )

    def get_generate_physics_result(self, job_id: str) -> GeneratePhysicsJobResultResponse:
        job = self._require_job(job_id)
        if job.status != "succeeded" or job.result is None:
            raise RobotMasteringError(
                status_code=409,
                detail="Robot mastering job is not complete.",
            )
        return GeneratePhysicsJobResultResponse(
            jobId=job.job_id,
            jobType=job.job_type,
            draftUrdfContent=str(job.result.get("draftUrdfContent") or ""),
            auditSummary=job.result.get("auditSummary"),
            synthesisResult=dict(job.result.get("synthesisResult") or {}),
            plausibilitySummary=job.result.get("plausibilitySummary"),
        )

    def get_job_artifact(self, job_id: str, artifact_name: str) -> tuple[str, str]:
        job = self._require_job(job_id)
        if job.status != "succeeded" or job.result is None:
            raise RobotMasteringError(
                status_code=409,
                detail="Robot mastering job is not complete.",
            )
        if artifact_name != ROBOT_MASTERING_ARTIFACT_DRAFT_URDF:
            raise RobotMasteringError(
                status_code=404,
                detail=f"Unknown robot mastering artifact: {artifact_name}",
            )
        draft = job.result.get("draftUrdfContent")
        if not isinstance(draft, str) or not draft:
            raise RobotMasteringError(
                status_code=404,
                detail="Robot mastering draft artifact is unavailable.",
            )
        return draft, "application/xml"

    def _require_job(self, job_id: str) -> RobotMasteringJobRecord:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            raise RobotMasteringError(
                status_code=404,
                detail=f"Robot mastering job not found: {job_id}",
            )
        return job


robot_mastering_service = RobotMasteringService()
