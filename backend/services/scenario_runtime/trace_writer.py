from __future__ import annotations

import hashlib
from pathlib import Path
from typing import IO

from backend.models.world_rollouts import WorldRolloutDecisionRecord, WorldRolloutTraceRecord

TRACE_STREAM_ROBOT_JOINTS = "robot_joints"
TRACE_STREAM_OBJECTS = "objects"
TRACE_STREAM_POLICY_ACTION = "policy_action"

SCENARIO_CHECKER_MODULE_ID = "scenario-checker"
SCENARIO_GUARD_MODULE_ID = "scenario-guard"
SCENARIO_RUNNER_MODULE_ID = "scenario-runner"


class NdjsonRecordWriter:
    """Streams pydantic records to an NDJSON file and tracks its sha256 digest."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._digest = hashlib.sha256()
        self._record_count = 0
        path.parent.mkdir(parents=True, exist_ok=True)
        self._handle: IO[bytes] = path.open("wb")

    def write(self, record: WorldRolloutTraceRecord | WorldRolloutDecisionRecord) -> None:
        line = record.model_dump_json(exclude_none=True).encode("utf-8") + b"\n"
        self._handle.write(line)
        self._digest.update(line)
        self._record_count += 1

    def close(self) -> tuple[str, int]:
        self._handle.close()
        return self._digest.hexdigest(), self._record_count

    @property
    def path(self) -> Path:
        return self._path


class EpisodeTraceWriter:
    def __init__(self, output_dir: Path, *, record_trace: bool, record_decisions: bool) -> None:
        self.trace = (
            NdjsonRecordWriter(output_dir / "trace.ndjson") if record_trace else None
        )
        self.decisions = (
            NdjsonRecordWriter(output_dir / "decisions.ndjson") if record_decisions else None
        )

    def write_state(self, *, t_ms: int, stream: str, state: dict) -> None:
        if self.trace is None:
            return
        self.trace.write(WorldRolloutTraceRecord(t_ms=t_ms, stream=stream, state=state))

    def write_decision(self, record: WorldRolloutDecisionRecord) -> None:
        if self.decisions is None:
            return
        self.decisions.write(record)

    def close(self) -> dict[str, dict[str, object]]:
        artifacts: dict[str, dict[str, object]] = {}
        if self.trace is not None:
            digest, count = self.trace.close()
            artifacts["trace_ndjson"] = {
                "uri": self.trace.path.name,
                "digest_sha256": digest,
                "record_count": count,
            }
        if self.decisions is not None:
            digest, count = self.decisions.close()
            artifacts["decisions_ndjson"] = {
                "uri": self.decisions.path.name,
                "digest_sha256": digest,
                "record_count": count,
            }
        return artifacts
