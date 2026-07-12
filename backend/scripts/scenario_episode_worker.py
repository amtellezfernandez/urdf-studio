"""Run one scenario episode on one simulator backend and write rollout artifacts.

Usage:
    python -m backend.scripts.scenario_episode_worker \
        --scenario scenarios/carton_sorting_0001 --sim mujoco \
        --episode-manifest manifest.json --out out/episodes/0

Artifacts written to --out: trace.ndjson, decisions.ndjson (world-rollout
record formats, sha256 digests in the report), report.json.
"""

from __future__ import annotations

import argparse
import ctypes.util
import json
import os
import sys
from pathlib import Path


def _select_headless_gl_platform() -> None:
    """Route the headless Genesis worker to CPU software OpenGL (OSMesa).

    Genesis builds a ``pyrender`` offscreen renderer during ``scene.build()``
    even for a physics-only rollout (``show_viewer=False``, no camera). On Linux
    that defaults to the ``egl`` platform, which needs a GPU EGL context — and
    that context fails to initialize when another process already holds the
    GPU's EGL resources (e.g. the browser's WebGL 3D viewport under WSLg),
    surfacing as ``EGLError: No EGL context could be initialized``. OSMesa
    renders in software, never touches the GPU, and so is immune to that
    contention. This must run before any ``import OpenGL`` (which
    ``import genesis`` triggers) because PyOpenGL freezes its platform on first
    import — hence a module-level call in this worker entrypoint, ahead of the
    project imports below. Scoped to the worker process (not the shared
    genesis_backend module) so in-process callers with a real display keep their
    working egl path. Respect an explicit override; only switch when libOSMesa
    is actually loadable.
    """
    if "genesis" not in sys.argv:
        return
    if os.environ.get("PYOPENGL_PLATFORM", "").strip():
        return
    if ctypes.util.find_library("OSMesa"):
        os.environ["PYOPENGL_PLATFORM"] = "osmesa"


_select_headless_gl_platform()

# Imports intentionally follow the platform selection above: they transitively
# reach genesis/OpenGL, and PyOpenGL freezes its platform on first import.
from backend.models.scenario import EpisodeManifest  # noqa: E402
from backend.services.scenario_loader import ScenarioLoadError, load_scenario  # noqa: E402
from backend.services.scenario_runtime.episode_runner import run_episode  # noqa: E402

SCENARIO_WORKER_BACKENDS = ("mujoco", "genesis", "isaac")


def _build_backend(sim: str, scenario, scenario_path: str):
    if sim == "mujoco":
        from backend.services.sim_backends.mujoco_backend import build_mujoco_backend

        return build_mujoco_backend(scenario, scenario_path)
    if sim == "genesis":
        from backend.services.sim_backends.genesis_backend import build_genesis_backend

        return build_genesis_backend(scenario, scenario_path)
    if sim == "isaac":
        raise ValueError(
            "The Isaac Sim episode backend is planned but not implemented yet "
            "(mirrors backend/services/simulator_adapters/planned_simulators.py)."
        )
    raise ValueError(f"Unsupported simulator backend: {sim}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", required=True)
    parser.add_argument("--sim", required=True, choices=SCENARIO_WORKER_BACKENDS)
    parser.add_argument("--episode-manifest", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    output_dir = Path(args.out)
    try:
        scenario = load_scenario(args.scenario)
        manifest = EpisodeManifest.model_validate_json(
            Path(args.episode_manifest).read_text(encoding="utf-8")
        )
        backend = _build_backend(args.sim, scenario, args.scenario)
        from backend.services.scenario_policies import build_scenario_policy

        policy = build_scenario_policy(scenario, args.scenario)
        result = run_episode(
            scenario=scenario,
            manifest=manifest,
            backend=backend,
            output_dir=output_dir,
            policy=policy,
        )
    except (ScenarioLoadError, ValueError) as exc:
        print(f"scenario episode worker failed: {exc}", file=sys.stderr)
        return 1

    report_path = output_dir / "report.json"
    report_path.write_text(json.dumps(result.to_report(), indent=2), encoding="utf-8")
    if scenario.evaluation.record_video:
        _render_episode_video(scenario, args.scenario, output_dir)
    print(
        f"episode {result.episode_index} [{result.backend_id}] "
        f"success={result.success} stop_reason={result.stop_reason} "
        f"steps={result.steps} sim_time_s={result.sim_time_s:.2f}"
    )
    return 0


def _render_episode_video(scenario, scenario_path: str, output_dir: Path) -> None:
    import json as _json

    from backend.services.scenario_loader import resolve_scenario_asset_path
    from backend.services.scenario_video import ScenarioVideoError, render_episode_video

    trace_path = output_dir / "trace.ndjson"
    if not trace_path.is_file():
        return
    try:
        world_path = resolve_scenario_asset_path(scenario_path, scenario.world.package)
        render_episode_video(
            trace_path=trace_path,
            world_payload=_json.loads(world_path.read_text(encoding="utf-8")),
            output_path=output_dir / "episode.mp4",
        )
    except (ScenarioVideoError, OSError) as exc:  # never fail a run over video
        print(f"episode video skipped: {exc}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
