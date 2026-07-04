from __future__ import annotations

from dataclasses import dataclass
import os
import signal
import subprocess
import threading
import time


WORKSPACE_LAUNCH_RECORD_TTL_SEC = 15 * 60
WORKSPACE_LAUNCH_TERMINATE_GRACE_SEC = 1.0


@dataclass(frozen=True)
class WorkspaceLaunchCancelResult:
    launch_id: str
    cancelled: bool
    process_stopped: bool = False
    pid: int | None = None


@dataclass
class _WorkspaceLaunchRecord:
    launch_id: str
    target_id: str
    created_at: float
    cancelled: bool = False
    process: subprocess.Popen | None = None
    completed_at: float | None = None


_launches: dict[str, _WorkspaceLaunchRecord] = {}
_launches_lock = threading.Lock()


def _is_process_alive(process: subprocess.Popen | None) -> bool:
    return process is not None and process.poll() is None


def _record_matches_target(record: _WorkspaceLaunchRecord, target_id: str) -> bool:
    return record.target_id in {"", target_id}


def _prune_locked(now: float) -> None:
    stale_launch_ids = [
        launch_id
        for launch_id, record in _launches.items()
        if not _is_process_alive(record.process)
        and now - (record.completed_at or record.created_at) > WORKSPACE_LAUNCH_RECORD_TTL_SEC
    ]
    for launch_id in stale_launch_ids:
        _launches.pop(launch_id, None)


def begin_workspace_launch(launch_id: str, target_id: str) -> bool:
    now = time.monotonic()
    with _launches_lock:
        _prune_locked(now)
        record = _launches.get(launch_id)
        if record is not None:
            return False
        _launches[launch_id] = _WorkspaceLaunchRecord(
            launch_id=launch_id,
            target_id=target_id,
            created_at=now,
        )
    return True


def attach_workspace_launch_process(launch_id: str, process: subprocess.Popen) -> bool:
    process_to_stop: subprocess.Popen | None = None
    with _launches_lock:
        record = _launches.get(launch_id)
        if record is None:
            record = _WorkspaceLaunchRecord(
                launch_id=launch_id,
                target_id="",
                created_at=time.monotonic(),
            )
            _launches[launch_id] = record
        record.process = process
        if record.cancelled:
            process_to_stop = process
    if process_to_stop is not None:
        terminate_workspace_process(process_to_stop)
        return False
    return True


def complete_workspace_launch(launch_id: str) -> None:
    with _launches_lock:
        record = _launches.get(launch_id)
        if record is not None:
            record.completed_at = time.monotonic()


def is_workspace_launch_cancelled(launch_id: str) -> bool:
    with _launches_lock:
        record = _launches.get(launch_id)
        return bool(record is not None and record.cancelled)


def cancel_workspace_launch(
    launch_id: str,
    *,
    target_id: str,
) -> WorkspaceLaunchCancelResult:
    process_to_stop: subprocess.Popen | None = None
    target_mismatch = False
    with _launches_lock:
        now = time.monotonic()
        _prune_locked(now)
        record = _launches.get(launch_id)
        if record is None:
            record = _WorkspaceLaunchRecord(
                launch_id=launch_id,
                target_id=target_id,
                created_at=now,
                cancelled=True,
            )
            _launches[launch_id] = record
        else:
            if not _record_matches_target(record, target_id):
                target_mismatch = True
            else:
                record.cancelled = True
                record.target_id = target_id
                process_to_stop = record.process

    if target_mismatch:
        return WorkspaceLaunchCancelResult(
            launch_id=launch_id,
            cancelled=False,
        )

    process_stopped = False
    pid = process_to_stop.pid if process_to_stop is not None else None
    if process_to_stop is not None:
        process_stopped = terminate_workspace_process(process_to_stop)
    return WorkspaceLaunchCancelResult(
        launch_id=launch_id,
        cancelled=True,
        process_stopped=process_stopped,
        pid=pid,
    )


def terminate_workspace_process(process: subprocess.Popen) -> bool:
    if process.poll() is not None:
        return False

    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
    except ProcessLookupError:
        return False
    except OSError:
        try:
            process.terminate()
        except OSError:
            return False

    try:
        process.wait(timeout=WORKSPACE_LAUNCH_TERMINATE_GRACE_SEC)
        return True
    except subprocess.TimeoutExpired:
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        except OSError:
            return True
        try:
            process.wait(timeout=WORKSPACE_LAUNCH_TERMINATE_GRACE_SEC)
        except subprocess.TimeoutExpired:
            pass
        return True
