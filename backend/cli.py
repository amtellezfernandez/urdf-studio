"""urdf-studio — unified CLI for the simulator-agnostic scenario platform.

Usage:
    urdf-studio scenario validate <scenario-dir>
    urdf-studio scenario run <scenario-dir> --sim mujoco --sim genesis --out <dir>
    urdf-studio scenario repro <run-dir> --out <dir>
    urdf-studio world usd-export <world-package.json> <out.usda>
    urdf-studio world usd-import <in.usd> <out.world-package.json>
    urdf-studio rollout --campaign <campaign.json> --out <dir>
    urdf-studio doctor
    urdf-studio demo [--out <dir>]

(`urdf-studio` is tools/urdf-studio; `python -m backend.cli` is equivalent.)
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEMO_SCENARIO = REPO_ROOT / "scenarios" / "carton_sorting_0001"


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = argparse.ArgumentParser(prog="urdf-studio", description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    scenario_parser = subparsers.add_parser("scenario", help="Validate/run/reproduce scenarios")
    scenario_sub = scenario_parser.add_subparsers(dest="scenario_command", required=True)
    scenario_sub.add_parser("validate", add_help=False)
    scenario_sub.add_parser("run", add_help=False)
    repro_parser = scenario_sub.add_parser("repro", help="Re-run a recorded scenario run")
    repro_parser.add_argument("run_dir")
    repro_parser.add_argument("--out", required=True)
    report_parser = scenario_sub.add_parser(
        "report", help="Build a self-contained HTML comparison report for a run"
    )
    report_parser.add_argument("run_dir")
    report_parser.add_argument("--out", default=None, help="Output .html (default: <run-dir>/report.html)")

    world_parser = subparsers.add_parser("world", help="World format conversions")
    world_sub = world_parser.add_subparsers(dest="world_command", required=True)
    world_sub.add_parser("usd-export", add_help=False)
    world_sub.add_parser("usd-import", add_help=False)

    subparsers.add_parser("rollout", add_help=False)
    subparsers.add_parser("doctor", help="Check simulator/interchange runtime health")
    demo_parser = subparsers.add_parser(
        "demo", help="Run the carton-sorting demo on every available simulator"
    )
    demo_parser.add_argument("--out", default=None)

    # Delegating subcommands parse their own tails; split argv manually.
    if argv[:2] == ["scenario", "validate"]:
        from backend.scripts.scenario_validate import main as delegate

        return delegate(argv[2:])
    if argv[:2] == ["scenario", "run"]:
        from backend.scripts.scenario_run import main as delegate

        return delegate(argv[2:])
    if argv[:2] == ["world", "usd-export"]:
        from backend.scripts.world_usd_convert import main as delegate

        return delegate(["export", *argv[2:]])
    if argv[:2] == ["world", "usd-import"]:
        from backend.scripts.world_usd_convert import main as delegate

        return delegate(["import", *argv[2:]])
    if argv[:1] == ["rollout"]:
        from backend.scripts.world_rollout_cli import main as delegate

        return delegate(argv[1:])

    args = parser.parse_args(argv)
    if args.command == "scenario" and args.scenario_command == "repro":
        return _repro(Path(args.run_dir), Path(args.out))
    if args.command == "scenario" and args.scenario_command == "report":
        return _report(Path(args.run_dir), Path(args.out) if args.out else None)
    if args.command == "doctor":
        return _doctor()
    if args.command == "demo":
        return _demo(Path(args.out) if args.out else None)
    parser.error(f"unhandled command: {args.command}")
    return 2


# --- doctor ---


def _probe(module: str) -> tuple[bool, str]:
    if importlib.util.find_spec(module) is None:
        return False, "not installed"
    try:
        from importlib import metadata

        distribution = {
            "mujoco": "mujoco",
            "genesis": "genesis-world",
            "pxr": "usd-core",
            "pybullet": "pybullet",
            "jax": "jax",
            "websockets": "websockets",
            "msgpack": "msgpack",
            "trimesh": "trimesh",
        }.get(module, module)
        return True, metadata.version(distribution)
    except Exception:  # noqa: BLE001 - version lookup is best-effort
        return True, "installed"


def _doctor() -> int:
    from backend.services.scenario_runtime.environment_fingerprint import (
        environment_fingerprint,
    )

    fingerprint = environment_fingerprint()
    print(f"python   {fingerprint['python']}  ({fingerprint['platform']})")
    print()
    rows = [
        ("mujoco", "MuJoCo episode backend"),
        ("genesis", "Genesis episode backend"),
        ("pybullet", "PyBullet workspace adapter"),
        ("jax", "MJX vectorized rollouts"),
        ("pxr", "OpenUSD interchange"),
        ("trimesh", "mesh asset conversion"),
        ("websockets", "VLA policy protocol"),
        ("msgpack", "VLA policy protocol"),
    ]
    missing_core = 0
    for module, purpose in rows:
        available, detail = _probe(module)
        marker = "ok " if available else "-- "
        print(f"  {marker} {module:<11} {detail:<14} {purpose}")
        if not available and module in ("mujoco",):
            missing_core += 1
    print()
    demo_ready = _probe("mujoco")[0]
    print(f"demo scenario: {DEMO_SCENARIO}")
    print("ready to run:  " + ("yes — try `urdf-studio demo`" if demo_ready else "no (install mujoco)"))
    return 0 if missing_core == 0 else 1


# --- demo ---


def _available_demo_sims() -> list[str]:
    sims = []
    if _probe("mujoco")[0]:
        sims.append("mujoco")
    if _probe("genesis")[0]:
        sims.append("genesis")
    return sims


def _demo(out_dir: Path | None) -> int:
    sims = _available_demo_sims()
    if not sims:
        print("demo needs at least MuJoCo installed (see `urdf-studio doctor`)", file=sys.stderr)
        return 1
    if out_dir is None:
        import tempfile

        out_dir = Path(tempfile.mkdtemp(prefix="urdf-studio-demo-"))
    print(f"running carton_sorting_0001 on: {', '.join(sims)}")
    from backend.scripts.scenario_run import main as scenario_run_main

    run_args = [str(DEMO_SCENARIO), "--out", str(out_dir)]
    for sim in sims:
        run_args.extend(["--sim", sim])
    return scenario_run_main(run_args)


# --- repro ---


def _repro(run_dir: Path, out_dir: Path) -> int:
    run_manifest_path = run_dir / "run.json"
    if not run_manifest_path.is_file():
        print(f"not a recorded scenario run (missing run.json): {run_dir}", file=sys.stderr)
        return 1
    run_manifest = json.loads(run_manifest_path.read_text(encoding="utf-8"))
    staged_scenario = run_dir / "scenario"
    if not staged_scenario.is_dir():
        print(f"recorded run has no staged scenario: {staged_scenario}", file=sys.stderr)
        return 1

    from backend.scripts.scenario_run import main as scenario_run_main

    run_args = [str(staged_scenario), "--out", str(out_dir)]
    for sim in run_manifest.get("sims", []):
        run_args.extend(["--sim", sim])
    exit_code = scenario_run_main(run_args)
    if exit_code != 0:
        return exit_code

    original = json.loads((run_dir / "comparison.json").read_text(encoding="utf-8"))
    repro = json.loads((Path(out_dir) / "comparison.json").read_text(encoding="utf-8"))
    print()
    mismatches = _compare_outcomes(original, repro)
    if mismatches:
        print("REPRODUCTION MISMATCH:")
        for line in mismatches:
            print(f"  {line}")
        return 1
    print("reproduction verified: per-episode success/stop outcomes match the original run")
    return 0


def _report(run_dir: Path, output_path: Path | None) -> int:
    from backend.services.scenario_report_html import ScenarioReportError, write_run_report_html

    try:
        output = write_run_report_html(run_dir, output_path)
    except ScenarioReportError as exc:
        print(f"scenario report failed: {exc}", file=sys.stderr)
        return 1
    print(f"report: {output}")
    return 0


def _compare_outcomes(original: dict, repro: dict) -> list[str]:
    mismatches: list[str] = []
    for backend in original.get("backends", []):
        original_summary = original["summary"].get(backend, {})
        repro_summary = repro.get("summary", {}).get(backend)
        if repro_summary is None:
            mismatches.append(f"{backend}: missing from reproduction")
            continue
        for key in ("completed", "success_count", "stop_reasons"):
            if original_summary.get(key) != repro_summary.get(key):
                mismatches.append(
                    f"{backend}.{key}: {original_summary.get(key)} != {repro_summary.get(key)}"
                )
    return mismatches


if __name__ == "__main__":
    raise SystemExit(main())
