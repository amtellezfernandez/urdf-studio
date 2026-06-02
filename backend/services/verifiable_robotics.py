from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from backend.core.settings import settings
from backend.models.verifiable_robotics import (
    VerifiableRoboticsPositionSample,
    VerifiableRoboticsProofRequest,
    VerifiableRoboticsProofResponse,
)


class VerifiableRoboticsError(RuntimeError):
    pass


@dataclass(frozen=True)
class _QuantizedTrace:
    positions: list[dict[str, int]]
    trace_length: int


def _quantize(value: float, *, scale: int) -> int:
    return int(round(value * scale))


def _quantize_trace(
    samples: list[VerifiableRoboticsPositionSample], *, scale: int
) -> _QuantizedTrace:
    quantized_positions: list[dict[str, int]] = []
    last_position: tuple[int, int] | None = None
    for sample in samples:
        position = (_quantize(sample.x, scale=scale), _quantize(sample.y, scale=scale))
        if position == last_position:
            continue
        quantized_positions.append({"x": position[0], "y": position[1]})
        last_position = position
    if not quantized_positions:
        raise VerifiableRoboticsError("No execution trace positions were captured.")
    return _QuantizedTrace(positions=quantized_positions, trace_length=len(quantized_positions))


def _serialize_policy_toml(request: VerifiableRoboticsProofRequest) -> str:
    scale = request.quantization_scale
    lines = [
        (
            "workspace = { min_x = "
            f"{_quantize(request.workspace.min_x, scale=scale)}, "
            f"max_x = {_quantize(request.workspace.max_x, scale=scale)}, "
            f"min_y = {_quantize(request.workspace.min_y, scale=scale)}, "
            f"max_y = {_quantize(request.workspace.max_y, scale=scale)} "
            "}"
        ),
        f"max_step_l1_distance = {_quantize(request.max_step_l1_distance, scale=scale)}",
    ]
    if request.max_step_delta_l1_distance is not None:
        lines.append(
            "max_step_delta_l1_distance = "
            f"{_quantize(request.max_step_delta_l1_distance, scale=scale)}"
        )
    for region in request.forbidden_regions:
        lines.extend(
            [
                "",
                "[[forbidden_regions]]",
                f"xmin = {_quantize(region.xmin, scale=scale)}",
                f"xmax = {_quantize(region.xmax, scale=scale)}",
                f"ymin = {_quantize(region.ymin, scale=scale)}",
                f"ymax = {_quantize(region.ymax, scale=scale)}",
            ]
        )
    return "\n".join(lines) + "\n"


class VerifiableRoboticsService:
    def __init__(self, *, repo_path: str, cargo_bin: str, timeout_seconds: int) -> None:
        self._repo_path = Path(repo_path)
        self._cargo_bin = cargo_bin
        self._timeout_seconds = timeout_seconds

    def prove(self, request: VerifiableRoboticsProofRequest) -> VerifiableRoboticsProofResponse:
        if not self._repo_path.exists():
            raise VerifiableRoboticsError(
                f"Verifiable robotics repo not found: {self._repo_path}"
            )

        quantized_trace = _quantize_trace(request.samples, scale=request.quantization_scale)

        with tempfile.TemporaryDirectory(prefix="vrp-", dir="/tmp") as temp_dir:
            temp_path = Path(temp_dir)
            trace_path = temp_path / "trace.json"
            policy_path = temp_path / "policy.toml"
            report_path = temp_path / "report.json"

            trace_path.write_text(
                json.dumps({"positions": quantized_trace.positions}, indent=2),
                encoding="utf-8",
            )
            policy_path.write_text(_serialize_policy_toml(request), encoding="utf-8")

            command = [
                self._cargo_bin,
                "run",
                "--release",
                "-p",
                "proof-orchestrator",
                "--",
                f"--{request.mode}",
                "--trace",
                str(trace_path),
                "--policy",
                str(policy_path),
                "--report-out",
                str(report_path),
            ]
            env = os.environ.copy()
            env.setdefault("PROTOC", self._ensure_protoc_wrapper())

            completed = subprocess.run(
                command,
                cwd=self._repo_path,
                env=env,
                capture_output=True,
                text=True,
                timeout=self._timeout_seconds,
                check=False,
            )
            if completed.returncode != 0:
                detail = (completed.stderr or completed.stdout or "").strip()
                raise VerifiableRoboticsError(
                    detail
                    or f"verifiable robotics command failed with exit code {completed.returncode}"
                )

            report_payload = json.loads(report_path.read_text(encoding="utf-8"))
            messages = [
                f"Trace length: {quantized_trace.trace_length}",
                f"Mode: {request.mode}",
            ]
            if report_payload.get("policy_satisfied") is not None:
                messages.append(
                    "Safety policy satisfied."
                    if report_payload["policy_satisfied"]
                    else "Safety policy violated."
                )
            return VerifiableRoboticsProofResponse(
                accepted=True,
                mode=request.mode,
                trace_length=quantized_trace.trace_length,
                policy_satisfied=report_payload.get("policy_satisfied"),
                trace_digest_hex=report_payload.get("trace_digest_hex"),
                execution_millis=report_payload.get("execution_millis"),
                proving_millis=report_payload.get("proving_millis"),
                trace_path=None,
                policy_path=None,
                report_path=None,
                messages=messages,
            )

    def _ensure_protoc_wrapper(self) -> str:
        wrapper_path = Path("/tmp/urdf-studio-grpc-tools-protoc")
        wrapper_path.write_text(
            "#!/usr/bin/env bash\n"
            f"exec {sys.executable} -m grpc_tools.protoc \"$@\"\n",
            encoding="utf-8",
        )
        wrapper_path.chmod(0o755)
        return str(wrapper_path)


verifiable_robotics_service = VerifiableRoboticsService(
    repo_path=settings.verifiable_robotics_repo_path,
    cargo_bin=settings.verifiable_robotics_cargo_bin,
    timeout_seconds=settings.verifiable_robotics_timeout_seconds,
)
