from __future__ import annotations

from dataclasses import dataclass
import os
import signal
import subprocess
import threading
import time


WORKSPACE_LAUNCH_RECORD_TTL_SEC = 15 * 60
WORKSPACE_LAUNCH_TERMINATE_GRACE_SEC = 1.0
POSIX_TERMINATE_SIGNAL = signal.SIGTERM
POSIX_KILL_SIGNAL = signal.SIGKILL


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


def _create_workspace_launch_record(
    *,
    launch_id: str,
    target_id: str,
    created_at: float,
    cancelled: bool = False,
) -> _WorkspaceLaunchRecord:
    return _WorkspaceLaunchRecord(
        launch_id=launch_id,
        target_id=target_id,
        created_at=created_at,
        cancelled=cancelled,
    )


def _get_or_create_workspace_launch_record(
    *,
    launch_id: str,
    target_id: str,
    now: float,
) -> _WorkspaceLaunchRecord:
    record = _launches.get(launch_id)
    if record is None:
        record = _create_workspace_launch_record(
            launch_id=launch_id,
            target_id=target_id,
            created_at=now,
        )
        _launches[launch_id] = record
    return record


def _store_workspace_launch_record(record: _WorkspaceLaunchRecord) -> _WorkspaceLaunchRecord:
    _launches[record.launch_id] = record
    return record


def _register_workspace_launch_record(
    *,
    launch_id: str,
    target_id: str,
    created_at: float,
    cancelled: bool = False,
) -> _WorkspaceLaunchRecord:
    return _store_workspace_launch_record(
        _create_workspace_launch_record(
            launch_id=launch_id,
            target_id=target_id,
            created_at=created_at,
            cancelled=cancelled,
        )
    )


def _cancel_workspace_launch_locked(
    *,
    launch_id: str,
    target_id: str,
    now: float,
) -> tuple[_WorkspaceLaunchRecord, bool, subprocess.Popen | None]:
    record = _launches.get(launch_id)
    if record is None:
        record = _register_workspace_launch_record(
            launch_id=launch_id,
            target_id=target_id,
            created_at=now,
            cancelled=True,
        )
        return record, False, None
    if not _record_matches_target(record, target_id):
        return record, True, None
    record.cancelled = True
    record.target_id = target_id
    return record, False, record.process


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
        if launch_id in _launches:
            return False
        _register_workspace_launch_record(
            launch_id=launch_id,
            target_id=target_id,
            created_at=now,
        )
    return True


def attach_workspace_launch_process(launch_id: str, process: subprocess.Popen) -> bool:
    process_to_stop: subprocess.Popen | None = None
    with _launches_lock:
        record = _get_or_create_workspace_launch_record(
            launch_id=launch_id,
            target_id="",
            now=time.monotonic(),
        )
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


def _workspace_launch_cancel_result(
    *,
    launch_id: str,
    cancelled: bool,
    process: subprocess.Popen | None = None,
    process_stopped: bool = False,
) -> WorkspaceLaunchCancelResult:
    return WorkspaceLaunchCancelResult(
        launch_id=launch_id,
        cancelled=cancelled,
        process_stopped=process_stopped,
        pid=process.pid if process is not None else None,
    )


def cancel_workspace_launch(
    launch_id: str,
    *,
    target_id: str,
) -> WorkspaceLaunchCancelResult:
    with _launches_lock:
        now = time.monotonic()
        _prune_locked(now)
        record, target_mismatch, process_to_stop = _cancel_workspace_launch_locked(
            launch_id=launch_id,
            target_id=target_id,
            now=now,
        )

    if target_mismatch:
        return _workspace_launch_cancel_result(
            launch_id=launch_id,
            cancelled=False,
        )

    process_stopped = False
    if process_to_stop is not None:
        process_stopped = terminate_workspace_process(process_to_stop)
    return _workspace_launch_cancel_result(
        launch_id=launch_id,
        cancelled=True,
        process=process_to_stop,
        process_stopped=process_stopped,
    )


def _terminate_process_group(process: subprocess.Popen, sig: signal.Signals) -> None:
    os.killpg(process.pid, sig)


def _terminate_running_process(process: subprocess.Popen) -> None:
    if os.name == "posix":
        _terminate_process_group(process, POSIX_TERMINATE_SIGNAL)
        return
    process.terminate()


def _kill_running_process(process: subprocess.Popen) -> None:
    if os.name == "posix":
        _terminate_process_group(process, POSIX_KILL_SIGNAL)
        return
    process.kill()


def terminate_workspace_process(process: subprocess.Popen) -> bool:
    if process.poll() is not None:
        return False

    try:
        _terminate_running_process(process)
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
            _kill_running_process(process)
        except OSError:
            return True
        try:
            process.wait(timeout=WORKSPACE_LAUNCH_TERMINATE_GRACE_SEC)
        except subprocess.TimeoutExpired:
            pass
        return True
