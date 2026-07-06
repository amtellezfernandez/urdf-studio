from __future__ import annotations

import hashlib
import subprocess
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from backend.core.settings import settings
from backend.models.world_rollouts import (
    WorldRolloutArtifactRef,
    WorldRolloutCampaignManifest,
    WorldRolloutCheckerProfile,
    WorldRolloutDecisionRecord,
    WorldRolloutImportRequest,
    WorldRolloutImportResponse,
    WorldRolloutJobCreateRequest,
    WorldRolloutJobResponse,
    WorldRolloutJobStatus,
    WorldRolloutPackageRef,
    WorldRolloutTraceRecord,
)
from backend.models.world_scene_package import WorldScenePackageManifest
from backend.services.world_scene_package_digest import world_scene_package_digest
from backend.services.world_rollout_params import (
    WORLD_ROLLOUT_CHECKER_PROFILE_ARTIFACT_KIND,
    WORLD_ROLLOUT_DEFAULT_RUNNER_KIND,
    WORLD_ROLLOUT_DECISION_ESCALATE,
    WORLD_ROLLOUT_DECISIONS_ARTIFACT_KIND,
    WORLD_ROLLOUT_DECISION_REJECT,
    WORLD_ROLLOUT_DECISION_STOP,
    WORLD_ROLLOUT_DECISION_WARN,
    WORLD_ROLLOUT_INPUT_CHECKER_PROFILE_FILENAME,
    WORLD_ROLLOUT_INPUT_CAMPAIGN_FILENAME,
    WORLD_ROLLOUT_INPUT_WORLD_PACKAGE_FILENAME,
    WORLD_ROLLOUT_JOB_ID_PREFIX,
    WORLD_ROLLOUT_MAX_DECISION_RECORDS,
    WORLD_ROLLOUT_MAX_JSON_BYTES,
    WORLD_ROLLOUT_MAX_JOB_STDIO_CHARS,
    WORLD_ROLLOUT_MAX_JOBS,
    WORLD_ROLLOUT_MAX_NDJSON_BYTES,
    WORLD_ROLLOUT_MAX_TRACE_RECORDS,
    WORLD_ROLLOUT_OUTPUT_CAMPAIGN_FILENAME,
    WORLD_ROLLOUT_OUTPUT_DIRNAME,
    WORLD_ROLLOUT_TRACE_ARTIFACT_KIND,
    WORLD_ROLLOUT_WORLD_PACKAGE_ARTIFACT_KIND,
)


_WorldRolloutNdjsonRecord = TypeVar(
    "_WorldRolloutNdjsonRecord",
    WorldRolloutTraceRecord,
    WorldRolloutDecisionRecord,
)


class WorldRolloutError(RuntimeError):
    ...


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _job_id() -> str:
    return f"{WORLD_ROLLOUT_JOB_ID_PREFIX}-{uuid.uuid4().hex}"


@dataclass(frozen=True)
class WorldRolloutCliConfig:
    executable_path: str | None
    workspace_root: Path
    timeout_seconds: int
    max_output_chars: int
    max_workers: int = 1
    max_queued_jobs: int = 0


@dataclass(frozen=True)
class WorldRolloutJobInputs:
    world_package: WorldScenePackageManifest
    checker_profile: WorldRolloutCheckerProfile


class WorldRolloutService:
    def __init__(self, *, cli_config: WorldRolloutCliConfig, start_workers: bool = True) -> None:
        self._cli_config = cli_config
        self._start_workers = start_workers
        self._executor = (
            ThreadPoolExecutor(
                max_workers=max(1, self._cli_config.max_workers),
                thread_name_prefix="world-rollout",
            )
            if start_workers
            else None
        )
        self._jobs: dict[str, WorldRolloutJobResponse] = {}
        self._job_inputs: dict[str, WorldRolloutJobInputs] = {}
        self._queued_job_ids: set[str] = set()
        self._running_job_ids: set[str] = set()
        self._lock = threading.Lock()

    def create_job(self, request: WorldRolloutJobCreateRequest) -> WorldRolloutJobResponse:
        campaign = self._build_campaign(request)
        created_at = _utc_now()
        job = WorldRolloutJobResponse(
            job_id=_job_id(),
            status=WorldRolloutJobStatus.QUEUED,
            created_at=created_at,
            updated_at=created_at,
            campaign=campaign,
        )
        with self._lock:
            self._prune_jobs_locked()
            if self._executor is not None:
                self._reserve_job_slot_locked()
                self._queued_job_ids.add(job.job_id)
            self._jobs[job.job_id] = job
            self._job_inputs[job.job_id] = WorldRolloutJobInputs(
                world_package=request.world_package,
                checker_profile=request.checker_profile,
            )
        if self._executor is not None:
            submitted = False
            try:
                self._executor.submit(self._run_job, job.job_id)
                submitted = True
            except RuntimeError as exc:
                raise WorldRolloutError(f"World rollout worker submit failed: {exc}") from exc
            finally:
                if not submitted:
                    with self._lock:
                        self._queued_job_ids.discard(job.job_id)
                        self._jobs.pop(job.job_id, None)
                        self._job_inputs.pop(job.job_id, None)
        return job

    def get_job(self, job_id: str) -> WorldRolloutJobResponse:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            raise KeyError(f"World rollout job was not found: {job_id}")
        return job

    def import_results(self, request: WorldRolloutImportRequest) -> WorldRolloutImportResponse:
        self._verify_inline_artifact_digest(
            request.campaign,
            kind=WORLD_ROLLOUT_TRACE_ARTIFACT_KIND,
            raw=request.trace_ndjson,
        )
        self._verify_inline_artifact_digest(
            request.campaign,
            kind=WORLD_ROLLOUT_DECISIONS_ARTIFACT_KIND,
            raw=request.decisions_ndjson,
        )
        trace_records = self._parse_ndjson(
            request.trace_ndjson,
            model=WorldRolloutTraceRecord,
            max_records=WORLD_ROLLOUT_MAX_TRACE_RECORDS,
            label="trace_ndjson",
        )
        decisions = self._parse_ndjson(
            request.decisions_ndjson,
            model=WorldRolloutDecisionRecord,
            max_records=WORLD_ROLLOUT_MAX_DECISION_RECORDS,
            label="decisions_ndjson",
        )
        return self._build_import_response(
            campaign=request.campaign,
            trace_records=trace_records,
            decisions=decisions,
        )

    def _run_job(self, job_id: str) -> None:
        job = self._mark_job_running(job_id)
        try:
            self._replace_job(self._run_cli(job))
        except (
            OSError,
            UnicodeDecodeError,
            ValidationError,
            subprocess.SubprocessError,
            WorldRolloutError,
        ) as exc:
            failed = self.get_job(job_id).model_copy(
                update={
                    "status": WorldRolloutJobStatus.FAILED,
                    "updated_at": _utc_now(),
                    "error": str(exc),
                }
            )
            self._replace_job(failed)
        finally:
            with self._lock:
                self._running_job_ids.discard(job_id)

    def _run_cli(self, job: WorldRolloutJobResponse) -> WorldRolloutJobResponse:
        executable = (self._cli_config.executable_path or "").strip()
        if not executable:
            raise WorldRolloutError("URDF_WORLD_ROLLOUT_CLI is not configured.")
        executable_path = Path(executable)
        if not executable_path.exists():
            raise WorldRolloutError(f"World rollout CLI not found: {executable_path}")
        if not executable_path.is_file():
            raise WorldRolloutError(f"World rollout CLI is not a file: {executable_path}")

        job_dir = self._cli_config.workspace_root / job.job_id
        output_dir = job_dir / WORLD_ROLLOUT_OUTPUT_DIRNAME
        output_dir.mkdir(parents=True, exist_ok=True)
        inputs = self._get_job_inputs(job.job_id)
        world_package_path = job_dir / WORLD_ROLLOUT_INPUT_WORLD_PACKAGE_FILENAME
        checker_profile_path = job_dir / WORLD_ROLLOUT_INPUT_CHECKER_PROFILE_FILENAME
        campaign_path = job_dir / WORLD_ROLLOUT_INPUT_CAMPAIGN_FILENAME
        world_package_digest = self._write_model_json(world_package_path, inputs.world_package)
        checker_profile_digest = self._write_model_json(checker_profile_path, inputs.checker_profile)
        if job.campaign.world_package.digest_sha256 != world_package_digest:
            raise WorldRolloutError("World rollout campaign world package digest is stale.")
        checker_artifact = self._find_artifact(
            job.campaign,
            kind=WORLD_ROLLOUT_CHECKER_PROFILE_ARTIFACT_KIND,
        )
        if checker_artifact is None or checker_artifact.digest_sha256 != checker_profile_digest:
            raise WorldRolloutError("World rollout campaign checker profile digest is stale.")
        self._write_model_json(campaign_path, job.campaign)

        completed = subprocess.run(
            [
                str(executable_path),
                "--campaign",
                str(campaign_path),
                "--out",
                str(output_dir),
            ],
            capture_output=True,
            text=True,
            timeout=self._cli_config.timeout_seconds,
            check=False,
        )
        if completed.returncode != 0:
            raise WorldRolloutError(
                self._truncate_output(completed.stderr)
                or self._truncate_output(completed.stdout)
                or f"World rollout CLI failed with exit code {completed.returncode}"
            )

        output_manifest_path = output_dir / WORLD_ROLLOUT_OUTPUT_CAMPAIGN_FILENAME
        if not output_manifest_path.exists():
            raise WorldRolloutError(
                f"World rollout CLI did not write {WORLD_ROLLOUT_OUTPUT_CAMPAIGN_FILENAME}"
            )
        output_campaign = WorldRolloutCampaignManifest.model_validate_json(
            self._read_text_file(
                output_manifest_path,
                max_bytes=WORLD_ROLLOUT_MAX_JSON_BYTES,
                label=WORLD_ROLLOUT_OUTPUT_CAMPAIGN_FILENAME,
            )
        )
        imported = self._import_outputs_from_manifest(output_dir, output_campaign)
        return job.model_copy(
            update={
                "status": WorldRolloutJobStatus.COMPLETED,
                "updated_at": _utc_now(),
                "campaign": output_campaign,
                "output_manifest_path": str(output_manifest_path),
                "trace_record_count": imported.trace_record_count,
                "decision_count": imported.decision_count,
                "reject_count": imported.reject_count,
                "warn_count": imported.warn_count,
                "stop_count": imported.stop_count,
                "escalation_count": imported.escalation_count,
                "stdout": self._truncate_output(completed.stdout),
                "stderr": self._truncate_output(completed.stderr),
            }
        )

    def _import_outputs_from_manifest(
        self,
        output_dir: Path,
        campaign: WorldRolloutCampaignManifest,
    ) -> WorldRolloutImportResponse:
        return self.import_results(
            WorldRolloutImportRequest(
                campaign=campaign,
                trace_ndjson=self._read_artifact_text(
                    output_dir,
                    campaign,
                    kind=WORLD_ROLLOUT_TRACE_ARTIFACT_KIND,
                ),
                decisions_ndjson=self._read_artifact_text(
                    output_dir,
                    campaign,
                    kind=WORLD_ROLLOUT_DECISIONS_ARTIFACT_KIND,
                ),
            )
        )

    def _read_artifact_text(
        self,
        output_dir: Path,
        campaign: WorldRolloutCampaignManifest,
        *,
        kind: str,
    ) -> str:
        artifact = self._find_artifact(campaign, kind=kind)
        if artifact is None:
            return ""
        output_root = output_dir.resolve()
        artifact_path = (output_dir / artifact.uri).resolve()
        if not artifact_path.is_relative_to(output_root):
            raise WorldRolloutError(f"World rollout artifact escapes output directory: {artifact.uri}")
        raw = self._read_bytes_file(
            artifact_path,
            max_bytes=WORLD_ROLLOUT_MAX_NDJSON_BYTES,
            label=artifact.uri,
        )
        self._verify_artifact_digest(artifact, raw)
        return raw.decode("utf-8")

    def _build_campaign(self, request: WorldRolloutJobCreateRequest) -> WorldRolloutCampaignManifest:
        world_package = request.world_package
        campaign_id = request.campaign_id or f"{world_package.package_id}-{world_package.version}"
        world_package_digest = world_scene_package_digest(world_package)
        checker_profile_digest = _sha256_bytes(_model_json_bytes(request.checker_profile))
        return WorldRolloutCampaignManifest(
            campaign_id=campaign_id,
            world_package=WorldRolloutPackageRef(
                package_id=world_package.package_id,
                version=world_package.version,
                digest_sha256=world_package_digest,
            ),
            checker_profile=request.checker_profile,
            rollout_params=request.rollout_params,
            runner={"kind": WORLD_ROLLOUT_DEFAULT_RUNNER_KIND, "params": request.runner_params},
            artifacts=[
                WorldRolloutArtifactRef(
                    kind=WORLD_ROLLOUT_WORLD_PACKAGE_ARTIFACT_KIND,
                    uri=WORLD_ROLLOUT_INPUT_WORLD_PACKAGE_FILENAME,
                    digest_sha256=world_package_digest,
                ),
                WorldRolloutArtifactRef(
                    kind=WORLD_ROLLOUT_CHECKER_PROFILE_ARTIFACT_KIND,
                    uri=WORLD_ROLLOUT_INPUT_CHECKER_PROFILE_FILENAME,
                    digest_sha256=checker_profile_digest,
                ),
            ],
        )

    def _build_import_response(
        self,
        *,
        campaign: WorldRolloutCampaignManifest,
        trace_records: list[WorldRolloutTraceRecord],
        decisions: list[WorldRolloutDecisionRecord],
    ) -> WorldRolloutImportResponse:
        reject_count, warn_count, stop_count, escalation_count = _count_decisions(
            decisions
        )
        return WorldRolloutImportResponse(
            campaign=campaign,
            trace_records=trace_records,
            decisions=decisions,
            trace_record_count=len(trace_records),
            decision_count=len(decisions),
            reject_count=reject_count,
            warn_count=warn_count,
            stop_count=stop_count,
            escalation_count=escalation_count,
        )

    def _parse_ndjson(
        self,
        raw: str,
        *,
        model: type[_WorldRolloutNdjsonRecord],
        max_records: int,
        label: str,
    ) -> list[_WorldRolloutNdjsonRecord]:
        parsed: list[_WorldRolloutNdjsonRecord] = []
        for line_index, line in enumerate(raw.splitlines()):
            normalized = line.strip()
            if not normalized:
                continue
            if len(parsed) >= max_records:
                raise WorldRolloutError(f"{label} exceeds the record limit.")
            try:
                parsed.append(model.model_validate_json(normalized))
            except ValidationError as exc:
                raise WorldRolloutError(f"{label} line {line_index + 1} is invalid: {exc}") from exc
        return parsed

    def _mark_job_running(self, job_id: str) -> WorldRolloutJobResponse:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(f"World rollout job was not found: {job_id}")
            self._queued_job_ids.discard(job_id)
            self._running_job_ids.add(job_id)
            updated = job.model_copy(
                update={"status": WorldRolloutJobStatus.RUNNING, "updated_at": _utc_now()}
            )
            self._jobs[job_id] = updated
            return updated

    def _get_job_inputs(self, job_id: str) -> WorldRolloutJobInputs:
        with self._lock:
            inputs = self._job_inputs.get(job_id)
        if inputs is None:
            raise WorldRolloutError(f"World rollout job inputs were not found: {job_id}")
        return inputs

    def _replace_job(self, job: WorldRolloutJobResponse) -> None:
        with self._lock:
            self._jobs[job.job_id] = job

    def _truncate_output(self, value: str | None) -> str | None:
        if not value:
            return None
        max_chars = min(self._cli_config.max_output_chars, WORLD_ROLLOUT_MAX_JOB_STDIO_CHARS)
        if max_chars <= 0:
            return None
        return value[-max_chars:]

    def _prune_jobs_locked(self) -> None:
        while len(self._jobs) >= WORLD_ROLLOUT_MAX_JOBS:
            oldest_job_id = next(
                (
                    job_id
                    for job_id in self._jobs
                    if job_id not in self._queued_job_ids and job_id not in self._running_job_ids
                ),
                None,
            )
            if oldest_job_id is None:
                break
            self._jobs.pop(oldest_job_id, None)
            self._job_inputs.pop(oldest_job_id, None)

    def _reserve_job_slot_locked(self) -> None:
        capacity = max(1, self._cli_config.max_workers) + max(0, self._cli_config.max_queued_jobs)
        in_flight_count = len(self._queued_job_ids) + len(self._running_job_ids)
        if in_flight_count >= capacity:
            raise WorldRolloutError("World rollout job queue is full.")

    def _write_model_json(self, path: Path, payload: BaseModel) -> str:
        raw = _model_json_bytes(payload)
        path.write_bytes(raw)
        if isinstance(payload, WorldScenePackageManifest):
            return world_scene_package_digest(payload)
        return _sha256_bytes(raw)

    def _read_text_file(self, path: Path, *, max_bytes: int, label: str) -> str:
        return self._read_bytes_file(path, max_bytes=max_bytes, label=label).decode("utf-8")

    def _read_bytes_file(self, path: Path, *, max_bytes: int, label: str) -> bytes:
        if not path.exists():
            raise WorldRolloutError(f"World rollout artifact was not found: {label}")
        if path.stat().st_size > max_bytes:
            raise WorldRolloutError(f"World rollout artifact exceeds size limit: {label}")
        return path.read_bytes()

    def _verify_inline_artifact_digest(
        self,
        campaign: WorldRolloutCampaignManifest,
        *,
        kind: str,
        raw: str,
    ) -> None:
        artifact = self._find_artifact(campaign, kind=kind)
        if artifact is None:
            return
        self._verify_artifact_digest(artifact, raw.encode("utf-8"))

    def _verify_artifact_digest(self, artifact: WorldRolloutArtifactRef, raw: bytes) -> None:
        if artifact.digest_sha256 is None:
            return
        actual_digest = _sha256_bytes(raw)
        if actual_digest.lower() != artifact.digest_sha256.lower():
            raise WorldRolloutError(f"World rollout artifact digest mismatch: {artifact.uri}")

    def _find_artifact(
        self,
        campaign: WorldRolloutCampaignManifest,
        *,
        kind: str,
    ) -> WorldRolloutArtifactRef | None:
        return next((candidate for candidate in campaign.artifacts if candidate.kind == kind), None)


def _model_json_bytes(payload: BaseModel) -> bytes:
    return payload.model_dump_json(indent=2).encode("utf-8")


def _sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _count_decisions(
    decisions: Sequence[WorldRolloutDecisionRecord],
) -> tuple[int, int, int, int]:
    reject_count = 0
    warn_count = 0
    stop_count = 0
    escalation_count = 0
    for decision in decisions:
        if decision.decision == WORLD_ROLLOUT_DECISION_REJECT:
            reject_count += 1
        elif decision.decision == WORLD_ROLLOUT_DECISION_WARN:
            warn_count += 1
        elif decision.decision == WORLD_ROLLOUT_DECISION_STOP:
            stop_count += 1
        elif decision.decision == WORLD_ROLLOUT_DECISION_ESCALATE:
            escalation_count += 1
    return reject_count, warn_count, stop_count, escalation_count


world_rollout_service = WorldRolloutService(
    cli_config=WorldRolloutCliConfig(
        executable_path=settings.world_rollout_cli_path,
        workspace_root=Path(settings.world_rollout_workspace_root),
        timeout_seconds=settings.world_rollout_timeout_seconds,
        max_output_chars=settings.world_rollout_max_output_chars,
        max_workers=settings.world_rollout_max_workers,
        max_queued_jobs=settings.world_rollout_max_queued_jobs,
    )
)
