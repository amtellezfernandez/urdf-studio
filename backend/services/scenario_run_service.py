from __future__ import annotations

import json
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from backend.models.scenario_service import (
    ScenarioRunDetail,
    ScenarioRunSummary,
)
from backend.services.scenario_library import scenario_directory
from backend.services.scenario_loader import ScenarioLoadError

_REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIO_RUN_WORKSPACE_ENV_VAR = "URDF_SCENARIO_RUN_WORKSPACE_ROOT"
_SUPPORTED_SIMS = ("mujoco", "genesis")
_MAX_RUNS_RETAINED = 128


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_workspace_root() -> Path:
    override = os.environ.get(SCENARIO_RUN_WORKSPACE_ENV_VAR, "").strip()
    if override:
        return Path(override)
    return Path.home() / ".urdf-studio" / "scenario-runs"


class ScenarioRunError(ValueError):
    ...


class _RunRecord:
    def __init__(self, run_id: str, scenario_id: str, sims: list[str]) -> None:
        self.run_id = run_id
        self.scenario_id = scenario_id
        self.sims = sims
        self.status = "queued"
        self.created_at = _utc_now()
        self.updated_at = self.created_at
        self.error: str | None = None
        self.out_dir: Path | None = None


class ScenarioRunService:
    """Runs scenarios in the background and tracks their status in memory."""

    def __init__(self, *, workspace_root: Path | None = None, max_workers: int = 2) -> None:
        self._workspace_root = workspace_root or _default_workspace_root()
        self._lock = threading.Lock()
        self._runs: dict[str, _RunRecord] = {}
        self._order: list[str] = []
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="scenario-run")

    def create_run(self, scenario_id: str, sims: list[str], episodes: int | None) -> ScenarioRunSummary:
        unsupported = [sim for sim in sims if sim not in _SUPPORTED_SIMS]
        if unsupported:
            raise ScenarioRunError(
                f"Unsupported simulator(s): {', '.join(unsupported)}. "
                f"Supported: {', '.join(_SUPPORTED_SIMS)}."
            )
        try:
            scenario_dir = scenario_directory(scenario_id)
        except ScenarioLoadError as exc:
            raise ScenarioRunError(str(exc)) from exc

        run_id = uuid.uuid4().hex[:16]
        record = _RunRecord(run_id, scenario_id, list(dict.fromkeys(sims)))
        record.out_dir = self._workspace_root / run_id
        with self._lock:
            self._runs[run_id] = record
            self._order.append(run_id)
            self._evict_locked()
        self._executor.submit(self._execute, record, scenario_dir, episodes)
        return self._to_summary(record)

    def _execute(self, record: _RunRecord, scenario_dir: Path, episodes: int | None) -> None:
        with self._lock:
            record.status = "running"
            record.updated_at = _utc_now()
        try:
            from backend.scripts.scenario_run import main as scenario_run_main

            assert record.out_dir is not None
            args = [str(scenario_dir), "--out", str(record.out_dir)]
            for sim in record.sims:
                args.extend(["--sim", sim])
            if episodes is not None:
                args.extend(["--episodes", str(episodes)])
            exit_code = scenario_run_main(args)
        except Exception as exc:  # noqa: BLE001 — surface any failure as a failed run
            with self._lock:
                record.status = "failed"
                record.error = str(exc)
                record.updated_at = _utc_now()
            return
        with self._lock:
            if exit_code == 0:
                record.status = "completed"
            else:
                record.status = "failed"
                record.error = f"scenario run exited with code {exit_code}"
            record.updated_at = _utc_now()

    def get_run(self, run_id: str) -> ScenarioRunDetail:
        record = self._require(run_id)
        comparison = None
        has_report = False
        if record.out_dir is not None:
            comparison_path = record.out_dir / "comparison.json"
            if comparison_path.is_file():
                comparison = json.loads(comparison_path.read_text(encoding="utf-8"))
            has_report = (record.out_dir / "report.html").is_file()
        summary = self._to_summary(record)
        return ScenarioRunDetail(
            **summary.model_dump(),
            comparison=comparison,
            has_report=has_report,
        )

    def list_runs(self) -> list[ScenarioRunSummary]:
        with self._lock:
            records = [self._runs[run_id] for run_id in reversed(self._order)]
        return [self._to_summary(record) for record in records]

    def report_path(self, run_id: str) -> Path:
        record = self._require(run_id)
        if record.out_dir is None:
            raise ScenarioRunError(f"Run has no output directory: {run_id}")
        path = record.out_dir / "report.html"
        if not path.is_file():
            raise ScenarioRunError(f"Run has no report yet: {run_id}")
        return path

    def _require(self, run_id: str) -> _RunRecord:
        with self._lock:
            record = self._runs.get(run_id)
        if record is None:
            raise ScenarioRunError(f"Run was not found: {run_id}")
        return record

    def _evict_locked(self) -> None:
        while len(self._order) > _MAX_RUNS_RETAINED:
            oldest = self._order.pop(0)
            self._runs.pop(oldest, None)

    @staticmethod
    def _to_summary(record: _RunRecord) -> ScenarioRunSummary:
        return ScenarioRunSummary(
            run_id=record.run_id,
            scenario_id=record.scenario_id,
            sims=record.sims,
            status=record.status,
            created_at=record.created_at,
            updated_at=record.updated_at,
            error=record.error,
        )


scenario_run_service = ScenarioRunService()
