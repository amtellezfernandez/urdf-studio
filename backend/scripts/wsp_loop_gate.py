from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from backend.services.wsp_demo_pipeline import (
    DEFAULT_WSP_DEMO_BRANCH_ID,
    DEFAULT_WSP_DEMO_OBSERVED_LOG_PATH,
    DEFAULT_WSP_DEMO_SCENE_PATH,
    build_default_wsp_demo_action,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run repeated real CLI WSP loops and fail if any artifact or gate is not executable/trainable."
    )
    parser.add_argument("--iterations", type=int, default=2, help="Number of end-to-end CLI loops to run.")
    parser.add_argument("--out-dir", default="", help="Directory for loop artifacts. Defaults to a temp directory.")
    parser.add_argument("--scene", default=str(DEFAULT_WSP_DEMO_SCENE_PATH), help="World package/layout input path.")
    parser.add_argument(
        "--observed-log",
        default=str(DEFAULT_WSP_DEMO_OBSERVED_LOG_PATH),
        help="Observed robot-state/action log to include. Use an empty value to skip.",
    )
    parser.add_argument("--branch", default=DEFAULT_WSP_DEMO_BRANCH_ID, help="Repair branch id to export.")
    parser.add_argument("--steps", type=int, default=2)
    parser.add_argument("--step-ms", type=int, default=500)
    return parser.parse_args()


def _run_module(
    module_name: str,
    *args: str,
    cwd: Path,
    expected_return_codes: set[int] | None = None,
) -> subprocess.CompletedProcess[str]:
    expected = expected_return_codes or {0}
    command = [sys.executable, "-m", module_name, *args]
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, check=False)
    if result.returncode not in expected:
        raise RuntimeError(
            json.dumps(
                {
                    "command": command,
                    "returncode": result.returncode,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                },
                indent=2,
            )
        )
    return result


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _parse_stdout_json(result: subprocess.CompletedProcess[str], *, command_name: str) -> dict[str, Any]:
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{command_name} did not print JSON stdout: {result.stdout}") from exc


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _finite_number(value: Any) -> bool:
    return isinstance(value, int | float) and math.isfinite(float(value))


def _combine_jsonl(paths: list[Path], output_path: Path) -> None:
    rows: list[str] = []
    for path in paths:
        rows.extend(line for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
    output_path.write_text("\n".join(rows) + "\n", encoding="utf-8")


def _validate_iteration(
    *,
    iteration_dir: Path,
    observed_trace_id: str | None,
    expected_branch_id: str,
) -> dict[str, Any]:
    compiled = _read_json(iteration_dir / "compiled_tokens.json")
    observed_trace = _read_json(iteration_dir / "observed_trace.json") if observed_trace_id is not None else None
    audit = _read_json(iteration_dir / "executability_report.json")
    repair = _read_json(iteration_dir / "correction_branches.json")
    mujoco_status = _read_json(iteration_dir / "export_status.mujoco.json")
    genesis_status = _read_json(iteration_dir / "export_status.genesis.json")
    readiness = _read_json(iteration_dir / "dataset_readiness.json")
    baseline_report = _read_json(iteration_dir / "baseline_report.json")
    samples = _read_jsonl(iteration_dir / "world_model_samples.jsonl")

    _assert("frame" in compiled and "tokens" in compiled, "compile did not write frame+tokens.")
    _assert(len(compiled["frame"]["entities"]) >= 4, "compiled scene has too few entities.")
    _assert(audit["success"] is False, "audit should reject the unsafe rollout.")
    _assert(audit["reject_count"] > 0, "audit has no reject checks.")
    _assert(any(branch["branch_id"] == expected_branch_id for branch in repair["branches"]), "repair branch missing.")
    _assert(mujoco_status["success"] is True, "MuJoCo export did not succeed.")
    _assert(genesis_status["success"] is True, "Genesis export did not succeed.")
    _assert(mujoco_status["metrics"]["mujoco_max_position_error_m"] <= 1e-6, "MuJoCo position error above gate.")
    if genesis_status["smoke_passed"]:
        _assert(
            genesis_status["metrics"]["genesis_max_position_error_m"] <= 1e-6,
            "Genesis position error above gate.",
        )
    _assert(readiness["ready"] is True, "dataset readiness failed.")
    _assert(readiness["errors"] == [], "dataset readiness returned errors.")
    _assert(readiness["sample_count"] == len(samples), "readiness sample count does not match JSONL.")
    _assert(any(sample["executable"] is True for sample in samples), "JSONL has no executable sample.")
    _assert(any(sample["executable"] is False for sample in samples), "JSONL has no rejected sample.")
    _assert(baseline_report["success"] is True, "baseline training failed.")
    _assert(baseline_report["sample_count"] == len(samples), "baseline sample count does not match JSONL.")
    _assert(_finite_number(baseline_report["mean_absolute_error"]), "baseline MAE is not finite.")
    _assert(_finite_number(baseline_report["position_mean_absolute_error_m"]), "baseline position MAE is not finite.")
    if observed_trace_id is not None:
        _assert(observed_trace is not None, "observed trace artifact missing.")
        _assert(observed_trace["trace_id"] == observed_trace_id, "observed trace id mismatch.")
        _assert(
            any(sample["trace_id"] == observed_trace_id for sample in samples),
            "combined JSONL does not include observed robot-log samples.",
        )

    return {
        "sample_count": len(samples),
        "executable_count": sum(1 for sample in samples if sample["executable"] is True),
        "rejected_count": sum(1 for sample in samples if sample["executable"] is False),
        "baseline_mean_absolute_error": baseline_report["mean_absolute_error"],
        "baseline_position_mean_absolute_error_m": baseline_report["position_mean_absolute_error_m"],
        "mujoco_max_position_error_m": mujoco_status["metrics"]["mujoco_max_position_error_m"],
        "genesis_max_position_error_m": genesis_status["metrics"].get("genesis_max_position_error_m"),
        "observed_trace_id": observed_trace_id,
    }


def _run_iteration(
    *,
    repo_root: Path,
    output_root: Path,
    iteration_index: int,
    scene_path: Path,
    observed_log_path: Path | None,
    branch_id: str,
    steps: int,
    step_ms: int,
) -> dict[str, Any]:
    iteration_dir = output_root / f"iteration-{iteration_index:02d}"
    iteration_dir.mkdir(parents=True, exist_ok=True)
    action_json = build_default_wsp_demo_action().model_dump_json()
    compiled_path = iteration_dir / "compiled_tokens.json"
    observed_trace_path = iteration_dir / "observed_trace.json"
    rollout_path = iteration_dir / "predicted_trace.json"
    audit_path = iteration_dir / "executability_report.json"
    repair_path = iteration_dir / "correction_branches.json"
    mujoco_path = iteration_dir / "corrected_state.mjcf.xml"
    genesis_path = iteration_dir / "corrected_state.genesis-scene.json"
    rollout_samples_path = iteration_dir / "rollout_samples.jsonl"
    observed_samples_path = iteration_dir / "observed_samples.jsonl"
    combined_samples_path = iteration_dir / "world_model_samples.jsonl"
    readiness_path = iteration_dir / "dataset_readiness.json"
    baseline_report_path = iteration_dir / "baseline_report.json"
    baseline_model_path = iteration_dir / "baseline_model.json"
    mujoco_status_path = iteration_dir / "export_status.mujoco.json"
    genesis_status_path = iteration_dir / "export_status.genesis.json"

    _run_module("backend.scripts.wsp_compile", str(scene_path), "--out", str(compiled_path), cwd=repo_root)
    if observed_log_path is not None:
        _run_module(
            "backend.scripts.wsp_ingest_log",
            str(observed_log_path),
            "--out",
            str(observed_trace_path),
            cwd=repo_root,
        )
    _run_module(
        "backend.scripts.wsp_rollout",
        str(compiled_path),
        "--action-json",
        action_json,
        "--steps",
        str(steps),
        "--step-ms",
        str(step_ms),
        "--out",
        str(rollout_path),
        cwd=repo_root,
    )
    _run_module(
        "backend.scripts.wsp_audit",
        str(rollout_path),
        "--out",
        str(audit_path),
        cwd=repo_root,
        expected_return_codes={1},
    )
    _run_module("backend.scripts.wsp_repair", str(rollout_path), "--out", str(repair_path), cwd=repo_root)
    mujoco_result = _run_module(
        "backend.scripts.wsp_export",
        str(rollout_path),
        "--repair-plan",
        str(repair_path),
        "--branch",
        branch_id,
        "--target",
        "mujoco",
        "--out",
        str(mujoco_path),
        cwd=repo_root,
    )
    mujoco_status = _parse_stdout_json(mujoco_result, command_name="wsp_export mujoco")
    mujoco_status_path.write_text(json.dumps(mujoco_status, indent=2) + "\n", encoding="utf-8")
    genesis_result = _run_module(
        "backend.scripts.wsp_export",
        str(rollout_path),
        "--repair-plan",
        str(repair_path),
        "--branch",
        branch_id,
        "--target",
        "genesis",
        "--out",
        str(genesis_path),
        cwd=repo_root,
    )
    genesis_status = _parse_stdout_json(genesis_result, command_name="wsp_export genesis")
    genesis_status_path.write_text(json.dumps(genesis_status, indent=2) + "\n", encoding="utf-8")
    _run_module(
        "backend.scripts.wsp_dataset",
        str(rollout_path),
        "--repair-plan",
        str(repair_path),
        "--branch",
        branch_id,
        "--out",
        str(rollout_samples_path),
        "--manifest-out",
        str(iteration_dir / "rollout_dataset_manifest.json"),
        cwd=repo_root,
    )
    sample_paths = [rollout_samples_path]
    observed_trace_id: str | None = None
    if observed_log_path is not None:
        observed_trace = _read_json(observed_trace_path)
        observed_trace_id = observed_trace["trace_id"]
        _run_module(
            "backend.scripts.wsp_dataset",
            str(observed_trace_path),
            "--out",
            str(observed_samples_path),
            "--manifest-out",
            str(iteration_dir / "observed_dataset_manifest.json"),
            cwd=repo_root,
        )
        sample_paths.append(observed_samples_path)
    _combine_jsonl(sample_paths, combined_samples_path)
    _run_module(
        "backend.scripts.wsp_dataset_check",
        str(combined_samples_path),
        "--require-balanced-labels",
        "--out",
        str(readiness_path),
        cwd=repo_root,
    )
    _run_module(
        "backend.scripts.wsp_train_baseline",
        str(combined_samples_path),
        "--require-balanced-labels",
        "--min-samples",
        "2",
        "--out",
        str(baseline_report_path),
        "--model-out",
        str(baseline_model_path),
        cwd=repo_root,
    )
    metrics = _validate_iteration(
        iteration_dir=iteration_dir,
        observed_trace_id=observed_trace_id,
        expected_branch_id=branch_id,
    )
    return {
        "iteration": iteration_index,
        "output_dir": str(iteration_dir),
        "metrics": metrics,
    }


def run_wsp_loop_gate(
    *,
    repo_root: Path,
    output_root: Path,
    iterations: int,
    scene_path: Path,
    observed_log_path: Path | None,
    branch_id: str,
    steps: int,
    step_ms: int,
) -> dict[str, Any]:
    if iterations < 1:
        raise ValueError("iterations must be >= 1.")
    output_root.mkdir(parents=True, exist_ok=True)
    iteration_results = [
        _run_iteration(
            repo_root=repo_root,
            output_root=output_root,
            iteration_index=iteration_index,
            scene_path=scene_path,
            observed_log_path=observed_log_path,
            branch_id=branch_id,
            steps=steps,
            step_ms=step_ms,
        )
        for iteration_index in range(iterations)
    ]
    return {
        "ok": True,
        "iterations": iterations,
        "output_root": str(output_root),
        "scene_path": str(scene_path),
        "observed_log_path": str(observed_log_path) if observed_log_path is not None else None,
        "branch_id": branch_id,
        "iteration_results": iteration_results,
    }


def main() -> int:
    args = _parse_args()
    repo_root = Path.cwd()
    output_root = Path(args.out_dir) if args.out_dir else Path(tempfile.mkdtemp(prefix="wsp-loop-gate-"))
    summary = run_wsp_loop_gate(
        repo_root=repo_root,
        output_root=output_root,
        iterations=args.iterations,
        scene_path=Path(args.scene),
        observed_log_path=Path(args.observed_log) if args.observed_log else None,
        branch_id=args.branch,
        steps=args.steps,
        step_ms=args.step_ms,
    )
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
