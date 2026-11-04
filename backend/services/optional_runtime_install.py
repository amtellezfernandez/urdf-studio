"""User-approved installation of optional project-local simulator runtimes."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from subprocess import DEVNULL, PIPE, STDOUT, Popen
from threading import Lock, Thread
from uuid import uuid4


_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_MAX_OUTPUT_CHARS = 12_000
_RUNTIME_FLAGS = {
    "mjx": "--with-mjx",
    "mjlab": "--with-mjlab",
    "genesis": "--with-genesis",
}


@dataclass
class _InstallJob:
    runtime_id: str
    command: tuple[str, ...]
    process: Popen[str]
    output: str = ""


class OptionalRuntimeInstallService:
    def __init__(self) -> None:
        self._jobs: dict[str, _InstallJob] = {}
        self._lock = Lock()

    def start(self, runtime_id: str) -> dict[str, object]:
        flag = _RUNTIME_FLAGS.get(runtime_id)
        if flag is None:
            raise ValueError(f"{runtime_id!r} is not an installable optional runtime.")
        with self._lock:
            active = next((job for job in self._jobs.values() if job.process.poll() is None), None)
            if active is not None:
                raise RuntimeError(f"An optional runtime install is already running for {active.runtime_id}.")
            command = ("npm", "run", "setup", "--", flag)
            process = Popen(
                command,
                cwd=_PROJECT_ROOT,
                stdin=DEVNULL,
                stdout=PIPE,
                stderr=STDOUT,
                text=True,
            )
            job_id = uuid4().hex
            job = _InstallJob(runtime_id=runtime_id, command=command, process=process)
            self._jobs[job_id] = job
            Thread(target=self._capture, args=(job,), daemon=True).start()
        return self.status(job_id)

    def status(self, job_id: str) -> dict[str, object]:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            return {
                "job_id": job_id,
                "runtime_id": job.runtime_id,
                "command": list(job.command),
                "running": job.process.poll() is None,
                "exit_code": job.process.poll(),
                "output": job.output,
            }

    def _capture(self, job: _InstallJob) -> None:
        assert job.process.stdout is not None
        for line in job.process.stdout:
            with self._lock:
                job.output = (job.output + line)[-_MAX_OUTPUT_CHARS:]
        job.process.wait()


optional_runtime_install_service = OptionalRuntimeInstallService()
