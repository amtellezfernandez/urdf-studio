# The Scenario Format (scenario-v1)

## What this document is

A **Scenario** is the simulator-agnostic description of a task: which world to load, which
robot, what the robot should accomplish, how episodes are randomized, what counts as
success, and how runs are evaluated. It is the layer above the World format
(`docs/specs/WORLD_FORMAT.md`): a scenario **references** a world package and never
replaces it.

Scenarios power the cross-simulator benchmark pipeline: the same scenario runs on any
simulator backend (MuJoCo, Genesis, more later) and produces the same evaluation artifacts,
enabling apples-to-apples comparison.

- Schema/models: `backend/models/scenario.py`
- Loader/compiler: `backend/services/scenario_loader.py`
- Validation CLI: `python -m backend.scripts.scenario_validate <scenario-dir>`
- Example: `scenarios/carton_sorting_0001/scenario.yaml`

## Relationship to Genie Sim

The success-condition engine is AgiBot's Genie Sim "Ader" checker engine, vendored verbatim
under `backend/vendor/geniesim/` (MPL-2.0; see `backend/vendor/geniesim/VENDORED.md`).
The scenario loader compiles the structured `success` block into Genie Sim's checker DSL
(`{"CheckerName": "arg1|arg2|..."}`), which the vendored `parse_action` turns into a live
action tree. Simulator backends implement the Genie `APICore` accessor surface
(`backend/vendor/geniesim/geniesim_benchmark/app/controllers/api_core.py`), so the vendored
checkers run unmodified against any engine.

## Document layout

```yaml
schema_version: scenario-v1        # required, exact
scenario_id: carton_sorting_0001   # required, [A-Za-z0-9][A-Za-z0-9_-]*
title: Sort the red carton         # optional

world:
  package: ./carton-sorting.world-package.json   # path relative to scenario.yaml,
                                                 # or a registry ref (package_id@version)
  frame_map: identity              # auto | identity | studio-y-up-to-z-up
  include_hidden: false

robot:
  urdf: ./robot.urdf               # optional; world.urdf_xml snapshot used if omitted
  base_pose: {xyz: [0,0,0], rpy: [0,0,0]}
  init_joint_positions: {}         # defaults to world.joint_positions
  init_noise_joint_regex:          # per-episode uniform noise by joint-name regex
    "^shoulder_.*": 0.02
  end_effector_link: gripper_link  # required for EEF-space policies

task:
  family: pick_place               # free-form task family tag
  instruction: "Pick up the {object:carton} and place it into {object:bin}"
  objects:                         # role bindings: name -> world object
    carton: {role: target, world_object_id: carton_1}
    bin:    {role: container, world_object_id: bin_a}
  randomization:
    seed: 0
    object_pose:
      carton_1:
        position_jitter_m: [0.05, 0.05, 0.0]
        yaw_jitter_rad: 0.4
        region: table_top          # optional clamp region
    regions:
      table_top: {aabb_min: [0.25,-0.3,0.775], aabb_max: [0.6,0.1,0.775]}

success:
  all_of:                          # every condition must hold (ActionSetWaitAll)
    - inside: {object: carton_1, container: bin_a, ratio: 1.2}
  guards:                          # hard-failure checks (decision: reject)
    - no_collision: {pairs: [[robot, bin_b]]}
    - above_plane: {object: carton_1, z_min: 0.0}
  timeout_sim_seconds: 30          # sim-time timeout (decision: stop)
  # acts: {...}                    # raw Genie checker-DSL passthrough (overrides all_of/timeout)

runtime:
  physics_timestep_s: 0.002
  control_hz: 50                   # identical control timeline across simulators
  checker_interval_steps: 5        # checkers tick every N control steps
  max_episode_steps: 1500
  observation: {modalities: [joint_positions, object_poses]}   # + camera_rgb later
  grasp_attach: weld               # none | weld (kinematic attach cheat, reported in artifacts)
  attach_link: magnet_link         # robot link objects weld to

policy:
  kind: waypoint                   # waypoint | replay | vla_ws | none
  params:
    waypoints_file: ./waypoints.json

metrics: [success_rate, time_to_success_s, final_object_pose_error_m]

evaluation:
  episodes: 1
  seeds: [0]
  record_trace: true
  record_decisions: true
  record_video: false
```

## Success conditions

Structured conditions compile 1:1 to vendored Genie Sim checkers:

| Condition | Params | Compiles to |
|---|---|---|
| `inside` | `object`, `container`, `ratio` (AABB scale, default 1.0) | `{"Inside": "obj\|container\|ratio"}` |
| `inbbox` | `object`, `center` [x,y,z], `size` [x,y,z] (world frame) | `{"InBBox": "obj\|cx,cy,cz\|lx,ly,lz"}` |
| `ontop` | `object`, `base` | `{"Ontop": "obj\|base"}` |
| `onfloor` | `object`, `height_m` (default 0.05) | `{"Onfloor": "obj\|h"}` |
| `liftup` | `object`, `height_m` | `{"LiftUp": "obj\|h"}` |
| `upright` | `object`, `tilt_threshold_deg` (default 10), `allow_flipped` | `{"Upright": "obj\|deg\|bool"}` |
| `stack` | `objects` [ids...], `xy_threshold_m` [x,y] | `{"Stack": "[ids]\|[x,y]"}` |

`all_of` becomes `ActionSetWaitAll`; with `timeout_sim_seconds` set the tree is
`ActionSetWaitAny([WaitAll([...]), Timeout])`. Object references are **bare world-object
ids**; the vendored engine maps them to `/World/Objects/<id>` and backends resolve that
against the loaded world.

Caveats:
- `upright` follows Genie Sim's **local-Y-up mesh convention** (an object is upright when
  its local +Y axis points along world +Z). It suits Genie-authored assets; it is
  generally wrong for Z-up primitive objects.
- `inside`/`ontop` and friends require several consecutive passing checker ticks before
  reporting success (vendored anti-flicker behavior).

Guards are evaluated by the episode runner itself, outside the vendored tree:

- `no_collision: {pairs: [[a, b], ...]}` — any contact between a listed pair (world-object
  ids or `robot`) emits a `reject` decision and ends the episode (`guard_reject`).
- `above_plane: {object, z_min}` — the object's center dropping below `z_min` rejects.
- `stable_for: {object, seconds, max_drift_m}` — post-success stabilization: after the
  success conditions fire, the runner keeps simulating for `seconds`, then the object must
  not move more than `max_drift_m` over a trailing 0.2 s window; otherwise success is
  revoked (`unstable`).

## Policies

- `waypoint` — scripted joint-space waypoints with linear interpolation
  (`params.waypoints_file`). Waypoint entries: `{"time_s": float, "joints": {name: rad},
  "attach": "object_id"?, "detach": true?}`. Attach/detach events fire once and require
  `runtime.grasp_attach: weld` (a kinematic pin to `runtime.attach_link` — a deterministic
  demo mechanism, flagged as `grasp_attach_used` in the episode report).
- `replay` — replays the `robot_joints` stream of a recorded episode trace
  (`params.trace_file`), one record per control step.
- `vla_ws` — Genie Sim's WebSocket/msgpack VLA inference protocol (Phase 6).

Policies subclass `ScenarioPolicy` (backend/services/scenario_policies/base.py), which
wraps the vendored Genie Sim `BasePolicy` action-chunk buffering: `act(...)` returns a
chunk of `PolicyAction`s replayed one per control step without re-inferring.

## Decisions and artifacts

Episode runs emit the existing world-rollout artifact contract
(`backend/models/world_rollouts.py`): `trace.ndjson` (`WorldRolloutTraceRecord`) and
`decisions.ndjson` (`WorldRolloutDecisionRecord`) with sha256 digests. Success-condition
outcomes map onto the shared decision vocabulary: satisfied → `allow`, soft violation →
`warn`, guard breach → `reject`, timeout/step-out → `stop`, deferred review → `escalate`.

## Running

- One episode, one simulator:
  `python -m backend.scripts.scenario_episode_worker --scenario <dir> --sim mujoco
   --episode-manifest <manifest.json> --out <dir>`
- Cross-simulator comparison (the headline command):
  `python -m backend.scripts.scenario_run <scenario-dir> --sim mujoco --sim genesis --out <dir>`
  Episode initial conditions are sampled once and shared across simulators; each
  (sim, episode) runs in its own subprocess (`STUDIO_<SIM>_PYTHON` overrides honored);
  the run emits `comparison.json` with per-sim success rates and divergence metrics
  (final-object pose deltas, joint RMSE, success agreement).
- As the world-rollouts runner: set `URDF_WORLD_ROLLOUT_CLI=tools/world_rollout_cli.sh`.
  Rollout jobs created through `WorldRolloutService` (and the frontend rollout UI) then
  execute scenario episodes; the campaign's `rollout_params` selects the scenario:
  `{"scenario": "scenarios/carton_sorting_0001", "sim": "mujoco", "episodes": 1}`.
  The campaign's world package overrides the scenario's `world.package`, and merged
  trace/decision artifacts are digest-signed per the service contract.

## Authoring in the browser

You don't have to hand-write `waypoints.json`. The web app's **Scene → Record Motion** panel
turns posing the robot into a runnable scenario:

1. Pose the robot with the viewer's IK targets or joint controls.
2. **Add keyframe** captures the current joint positions at a timestamp (editable afterward).
   Repeat pose → keyframe for each waypoint; optionally set an `attach`/`detach` object on a
   keyframe (requires choosing an attach link, which turns on `runtime.grasp_attach: weld`).
3. **Replay** previews the interpolated motion in the viewer — the in-browser interpolation
   mirrors the backend `WaypointPolicy` exactly, so preview equals backend playback.
4. **Save as scenario** (name + target/container objects) writes a full scenario — the current
   world (as its world package), the recorded `waypoints.json`, the posed robot's URDF, and a
   generated `scenario.yaml` (an `inside` success on target→container) — into the **writable
   user scenario library** (`~/.urdf-studio/scenarios`, override
   `URDF_USER_SCENARIO_LIBRARY_ROOT`). The save is validated with the runtime loader before it
   is accepted, so an authored scenario is always runnable.

Authored scenarios then appear in the Scenarios panel alongside shipped ones (the library is
the union of the read-only repo `scenarios/` and the user library, user shadowing repo on id
clash) and run across simulators with no extra steps. `POST /scenarios/authored` is the
underlying API; `scenariosApi.saveAuthoredScenario` the client.

## Determinism

Randomization is sampled once per (episode, seed) by the orchestrator into an
`EpisodeManifest` (resolved object poses + initial joints), and the **same manifest** is fed
to every simulator. Checker ticks advance on simulation time, not wall-clock time
(`backend/services/scenario_runtime/ader_evaluation.py::tick_ader_checkers`).
