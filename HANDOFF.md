# Handoff — in-UI cross-sim scenario runs (Genesis headless fix)

Date: 2026-07-12. Branch: `main`.

## TL;DR

Drove the **live app in a real browser** to prove the simulator-agnostic scenario
loop end-to-end. Found, root-caused, and fixed a genuine break: in-UI cross-sim
runs failed on **Genesis** (MuJoCo always passed). Loop now works from the real
UI with the 3D viewport open: **mujoco 1.0 / genesis 1.0 / agreement 1.0, no errors**.

## The break

- **Symptom**: A cross-sim run launched from the Scenarios panel completed with
  MuJoCo `success_rate=1.0` but Genesis `success_rate=0.0`,
  `errors.genesis = ["genesis worker exited 1: "]` (empty message).
- **Root cause**: Genesis's `scene.build()` *always* builds a `pyrender`
  offscreen renderer — even for a physics-only rollout (`show_viewer=False`, no
  camera). On Linux that renderer defaults to the **EGL** platform, needing a GPU
  EGL context. When the browser's WebGL 3D viewport holds the WSL GPU, EGL init
  fails: `EGLError: No EGL context could be initialized`. MuJoCo survives (CPU
  fallback); Genesis did not. Deterministic: browser closed → Genesis passes;
  browser open → Genesis dies at init.
- **Why it was invisible**: `_run_worker` only tailed the worker's **stderr**,
  but Genesis/taichi logs to **stdout**, so the failure surfaced as the useless
  `"genesis worker exited 1: "`.

## Fixes (all committed to the working tree, not yet committed to git)

1. `backend/scripts/scenario_run.py` — `_run_worker` now includes **stdout** in
   the error tail (sim backends log there) and persists a full `worker.log`
   beside the episode artifacts. *This is what surfaced the real error.*
2. `backend/scripts/scenario_episode_worker.py` — new
   `_select_headless_gl_platform()` sets `PYOPENGL_PLATFORM=osmesa` (CPU software
   GL, GPU-contention-proof) **at the top of the worker entrypoint**, before any
   `import OpenGL` (PyOpenGL freezes its platform on first import). Guards:
   only for the `genesis` worker, only when `libOSMesa` is loadable, and never
   overrides an explicit `PYOPENGL_PLATFORM`. Project imports below it carry
   `# noqa: E402` intentionally.
3. `README.md` — `libosmesa6` documented as a Linux/WSL dependency with rationale.

### Scope note (important)

The osmesa selection lives in the **worker subprocess only**, NOT in
`genesis_backend.py` at module import. An earlier attempt set it at
`genesis_backend` import time and regressed 4 in-process
`test_sim_backend_conformance.py[genesis]` tests: in the shared pytest process,
other genesis paths import OpenGL as EGL first, so forcing osmesa too late throws
`'EGLPlatform' object has no attribute 'OSMesa'`. All scenario runs go through the
worker (`scenario_run._run_worker` spawns it), and in-process tests have a real
display where EGL works — so scoping to the worker fixes production with zero test
impact.

## Prerequisite added

```bash
sudo apt-get install -y --no-install-recommends libosmesa6
```

Already installed on this machine; also present in `docker/demo/Dockerfile`.

## Validation performed

- Backend regression selection `-k "genesis or scenario_run or scenario_compare
  or episode or scenario_backend"`: **106 passed, 4 skipped, 0 errors** (matches
  baseline with changes stashed).
- Live API run (same path the UI POSTs to):
  `POST /scenarios/carton_sorting_0001/runs {"sims":["mujoco","genesis"]}` →
  completed, both `success_rate=1.0`, agreement `1.0`, `errors: {}`.
- Browser-driven (Playwright, viewport open): Scene menu → *Scenarios
  (Cross-Sim)* → *Run across 2 simulators* → RUNS panel shows `completed`;
  the run's comparison confirms genesis `1.0` / agreement `1.0`.
- Visually confirmed (bonus): landing screen shows the merged **dashed
  drop-square + "Browse"** control and no *optional URDF path* field.

## How to re-run the end-to-end check

App: `npm run start` (frontend :5173, backend :8000). Then either:

- **API** (fastest): `curl -X POST http://127.0.0.1:8000/scenarios/carton_sorting_0001/runs
  -H 'content-type: application/json' -d '{"sims":["mujoco","genesis"]}'`, poll
  `GET /scenarios/runs/<id>` until `status=completed`, check
  `comparison.summary` + `comparison.divergence`.
- **UI**: open http://127.0.0.1:5173 → *Play Sample Motion* → top-nav *Scene* →
  *Scenarios (Cross-Sim)* → select the carton scenario → *Run across 2 simulators*.
- On any failure, read `~/.urdf-studio/scenario-runs/<run_id>/<sim>/episode-*/worker.log`
  (or `<run_id>/<sim>/worker.log`) for the full worker stdout+stderr.

## Follow-ons (unchanged from before, still open)

- Replace the `grasp_attach: weld` kinematic cheat with a real gripper+contact grasp.
- Real closed-loop policy (external VLA over WebSocket; protocol at
  `docs/specs/SCENARIO_POLICY_PROTOCOL.md`).
- CI: wire `generate_contract_schemas --check`.
- The Playwright driver used here was ad hoc; consider capturing it as a project
  run skill via `/run-skill-generator` so "drive the app in a browser" is repeatable.
