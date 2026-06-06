# WSP Handoff

## Current State

Branch: `hkhack`

Latest pushed commit:

```text
46ac16b Frame WSP lab demo as deterministic verification
```

The repo now has a working WSP vertical slice for robotics data/eval infrastructure:

```text
failure corpus -> replay labels -> audit benchmark -> raw baseline
-> learned WSP baseline -> model-lift report -> policy regression eval
-> CI PASS/WARN/BLOCK report -> one-command lab demo
```

The honest claim is:

> WSP is an operational robotics data/eval compiler: it standardizes robot rollouts, runs deterministic executability checks against simulator-labeled transitions, trains baseline models, and blocks unsafe policy regressions in CI.

Do not claim this is a complete world model or production-proven real-world physics evaluator.

## Why The Perfect Metrics Are Framed Carefully

The current default demo produces perfect audit metrics on the deterministic synthetic corpus. That is intentional for Phase 1 verification, but it is not real-world robustness evidence.

Safe framing:

> We built a deterministic verification slice to prove the compiler, adapters, schemas, replay labels, model training, and CI gate work end to end without data loss.

Unsafe framing:

```text
WSP has production-grade 1.000 precision/recall.
WSP solved physical executability in the real world.
WSP is a complete world model.
```

The generated lab summary now includes:

- `validation_mode: phase_1_deterministic_verification`
- `evidence_scope`
- `limitations`
- `next_milestone`
- `stage_script.do_not_claim`
- optional synthetic ambiguity stress test output

## Main Demo Commands

Run the default deterministic verification demo:

```bash
npm run wsp:lab-demo -- --out-dir /tmp/wsp_lab_demo_full
```

Run the safer stage/demo version with synthetic ambiguity stress:

```bash
npm run wsp:lab-demo -- \
  --out-dir /tmp/wsp_lab_demo_guardrail \
  --stress-noise-rate 0.08
```

Expected guardrail output includes non-perfect stress metrics similar to:

```text
stress audit precision: 0.925
stress audit recall: 0.967
unsafe false negative rate: 0.033
```

The stress mode deliberately perturbs replay labels. It is not simulator truth; it is a presentation guardrail showing that we understand perfect deterministic metrics are not real-world performance.

## Key NPM Commands

Generate a failure corpus:

```bash
npm run wsp:generate-corpus -- \
  --count 1000 \
  --failure-modes collision,contact,joint,battery,reachability \
  --out /tmp/wsp_failure_corpus.jsonl
```

Attach MuJoCo/Genesis replay labels:

```bash
npm run wsp:replay-label -- /tmp/wsp_failure_corpus.jsonl \
  --sim mujoco,genesis \
  --out /tmp/wsp_failure_corpus_labeled.jsonl
```

Benchmark WSP audit labels against replay labels:

```bash
npm run wsp:benchmark-audit -- /tmp/wsp_failure_corpus_labeled.jsonl \
  --out /tmp/wsp_audit_benchmark.json \
  --min-precision 0.9 \
  --min-recall 0.8 \
  --max-false-reject-rate 0.15 \
  --max-runtime-ms 100
```

Train raw-log baseline:

```bash
npm run wsp:train-raw-baseline -- /tmp/wsp_failure_corpus_labeled.jsonl \
  --dataset-id wsp-failure-corpus-1000 \
  --out /tmp/wsp_raw_baseline_report.json \
  --model-out /tmp/wsp_raw_baseline_model.json
```

Train learned WSP graph baseline:

```bash
npm run wsp:train-wsp-model -- /tmp/wsp_failure_corpus_labeled.jsonl \
  --dataset-id wsp-failure-corpus-1000 \
  --out /tmp/wsp_graph_baseline_report.json \
  --model-out /tmp/wsp_graph_baseline_model.json
```

Compare model lift:

```bash
npm run wsp:compare-model-lift -- \
  --raw-report /tmp/wsp_raw_baseline_report.json \
  --wsp-report /tmp/wsp_graph_baseline_report.json \
  --out /tmp/wsp_model_lift_report.json \
  --min-auroc-lift 0.1 \
  --min-unsafe-fn-reduction 0.2 \
  --require-wsp-position-mae-not-worse
```

Evaluate a policy regression:

```bash
npm run wsp:policy-eval -- \
  --baseline /tmp/policy_v16.jsonl \
  --candidate /tmp/policy_v17.jsonl \
  --out /tmp/policy_regression_eval.json \
  --max-invalid-rate-increase 0.02
```

Convert policy eval to CI status:

```bash
npm run wsp:ci-report -- \
  --policy-report /tmp/policy_regression_eval.json \
  --out /tmp/wsp_ci_report.json
```

## Implemented Pieces

Core WSP eval pipeline:

- `backend/services/wsp_failure_corpus.py`
- `backend/services/wsp_replay_label.py`
- `backend/services/wsp_audit_benchmark.py`
- `backend/services/wsp_raw_baseline.py`
- `backend/services/wsp_graph_baseline.py`
- `backend/services/wsp_model_lift.py`
- `backend/services/wsp_policy_eval.py`
- `backend/services/wsp_ci_report.py`
- `backend/services/wsp_lab_demo.py`

## Paper-Grade Evaluation Framework

**Architecture:** corruption suite → eval corpus → 5 baselines → metrics table

### Corruption Suite (`wsp_corruption_suite.py`)

Ten named corruptions, each returning a labeled `CorruptedTrace`:

| Code | Name | Detectable by |
|---|---|---|
| C1 | `degree_radian_mismatch` | range_check, kinematic |
| C2 | `frame_convention_flip` | kinematic (EE below table), WSP |
| C3 | `joint_order_permutation` | kinematic (wrong workspace) |
| C4 | `timestamp_jitter` | range_check (non-monotonic) |
| C5 | `missing_joint_channel` | schema_check (length mismatch) |
| C6 | `duplicated_frame` | kinematic (zero velocity) |
| C7 | `impossible_ee_velocity` | kinematic (>15 m/s) |
| C8 | `impossible_contact_transition` | kinematic (contact relation 0.8m apart) — **WSP misses this** |
| C9 | `robot_object_interpenetration` | **WSP catches this** (AABB overlap, no contact relation) |
| C10 | `action_state_lag` | kinematic (action/state mismatch) |

Key paper finding: WSP catches C9 (physics-based) but misses C8 (semantically invalid contact relation present → WSP allows overlap). Kinematic check catches C8.

```python
from backend.services.wsp_corruption_suite import build_eval_corpus, ALL_CORRUPTIONS
corpus = build_eval_corpus(clean_traces, seed=42)  # n×(1 clean + 10 corrupted)
```

### Eval Baselines (`wsp_eval_baselines.py`)

Five methods, each returns `(score: float, runtime_ms: float)`, score 1.0 = corrupted:
- `schema_check_score(trace)` — NaN/inf, empty frames, joint vector length, duplicate IDs
- `range_check_score(trace)` — joint range ±200°, timestamp monotonicity, position bounds ±1.5m
- `kinematic_check_score(trace)` — EE velocity (>15 m/s), contact proximity (<20cm), duplicate timestamps
- `wsp_audit_score(trace)` — full WSP audit; reject→1.0, warn→0.5, allow→0.0
- `learned_zscore_score(trace, stats)` — Z-score on trajectory kinematics via sigmoid; fit with `fit_zscore_stats(clean_traces)`

### Paper Eval Harness (`wsp_paper_eval.py`)

```python
from backend.services.wsp_paper_eval import run_paper_eval, format_eval_table
report = run_paper_eval(corpus)
print(format_eval_table(report))
# Method         Precision  Recall  AUROC   FBR    ms/ep
# schema_check       ...
# wsp_audit          ...
```

`EvalReport` contains `methods: dict[str, MethodMetrics]` and `per_corruption: dict[str, dict[str, float]]` (recall by corruption × method).

### Minimum viable paper experiment

```python
from backend.services.wsp_lerobot_hf_ingest import load_lerobot_hf_episode
from backend.services.wsp_corruption_suite import build_eval_corpus
from backend.services.wsp_paper_eval import run_paper_eval, format_eval_table

# Load 10 real SO-101 episodes (100-500 frames each)
clean = [load_lerobot_hf_episode("lerobot/svla_so101_pickplace", i, max_frames=50) for i in range(10)]
# Load 5 real SO-100 episodes as second dataset
clean_100 = [load_lerobot_hf_episode("lerobot/svla_so100_pickplace", i, robot="so100", max_frames=50) for i in range(5)]

corpus = build_eval_corpus(clean + clean_100, seed=42)
report = run_paper_eval(corpus)
print(format_eval_table(report))
```

Real-data HuggingFace ingest:

- `backend/services/wsp_lerobot_hf_ingest.py`
  - `load_lerobot_hf_episode("lerobot/svla_so101_pickplace", episode_index=0)` → `PhysicalRolloutTrace`
  - `build_so101_hf_benchmark(episode_indices=[0,1,2])` → `list[WorldModelTrainingSample]`
  - FK via SO-101 URDF (gripper_link); dataset joint values are in degrees; joint order: `[shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper]`
  - SO-101 reaches in +X at pan=0; pan sweeps Y axis (opposite convention from SO-100)

Trace adapters:

- `backend/services/wsp_trace_adapters.py`

Adapters currently accept practical JSON/JSONL exports for:

- MuJoCo-style traces (`compile_simulator_file(path, source="mujoco")`)
- Genesis-style traces (`compile_simulator_file(path, source="genesis")`)
- ROS/MCAP-style topic/message JSON exports (`compile_trace_adapter_payload(payload, source="ros")`)
- LeRobot-style episode frames
- Native ROS 2 MCAP binary bags (`compile_mcap_file(path)` — requires `pip install mcap mcap-ros2-support`)

CLIs:

- `wsp:generate-corpus`
- `wsp:replay-label`
- `wsp:benchmark-audit`
- `wsp:train-raw-baseline`
- `wsp:train-wsp-model`
- `wsp:train-gnn`
- `wsp:compare-model-lift`
- `wsp:ingest-trace-adapter`
- `wsp:ingest-sim-trace`
- `wsp:ingest-ros-trace`
- `wsp:ingest-lerobot`
- `wsp:policy-eval`
- `wsp:ci-report`
- `wsp:lab-demo`

## Last Verified Results

Default deterministic demo:

```text
Generated: 1000 transitions
Rejected: 750
Replay agreement: 1.000
Audit precision: 1.000
Audit recall: 1.000
Raw AUROC: 0.822
WSP AUROC: 1.000
Raw unsafe FN: 0.360
WSP unsafe FN: 0.000
Policy invalid rate: 0.100 -> 0.500
CI status: BLOCK
```

Guardrail stress demo with `--stress-noise-rate 0.08`:

```text
stress audit precision: 0.925
stress audit recall: 0.967
unsafe false negative rate: 0.033
```

## Verification Commands

Last full verification passed:

```bash
npm run test:backend
npm run lint
npm run typecheck
npm run scalar-constants:check
npm run build
npm run wsp:lab-demo -- --out-dir /tmp/wsp_lab_demo_guardrail --stress-noise-rate 0.08
```

Last backend result:

```text
610 passed, 3 skipped
```

## Files To Read First

Start here:

```text
backend/services/wsp_lab_demo.py
backend/services/wsp_trace_adapters.py
backend/services/wsp_policy_eval.py
backend/services/wsp_graph_baseline.py
backend/services/wsp_audit_benchmark.py
```

Then inspect the tests:

```text
backend/tests/test_wsp_lab_demo.py
backend/tests/test_wsp_trace_adapters.py
backend/tests/test_wsp_policy_eval.py
backend/tests/test_wsp_graph_baseline.py
backend/tests/test_wsp_audit_benchmark.py
```

## Pitch Guidance

Use this:

> We have a working deterministic verification slice for robotics data/eval infrastructure. It proves that WSP can compile robot rollouts into a consistent state/action/next-state dataset, validate deterministic executability, train baseline models, and block unsafe policy regressions in CI.

Then pivot:

> The next milestone is real noisy telemetry. The value is not that synthetic metrics are perfect; the value is that the pipeline is ready to ingest MuJoCo, Genesis, ROS/MCAP, and LeRobot-style logs and run the same audit/model/CI loop on messy partner data.

Avoid this:

```text
We solved robotic world models.
Our audit is 100% accurate in real factories.
The learned model generalizes to chaotic contact physics.
```

## SO-100 Digital Twin PoC (added hkhack session)

### What was built

A random SO-100 arm rollout service that simulates a dynamic world (box moves on gripper contact, friction-damped velocity) and validates each trace through the WSP audit pipeline — no real hardware required.

New files:

```text
backend/services/so100_random_rollout.py   — trajectory generation + dynamic box world
backend/scripts/wsp_so100_demo.py          — CLI: generate N rollouts, print PASS/WARN/BLOCK
backend/tests/test_so100_random_rollout.py — 15 tests covering FK, limits, scenarios, audit
```

Demo command:

```bash
npm run wsp:so100-demo -- --count 20 --verbose
```

Expected output shape:

```text
── SO-100 Dynamic World Demo ─────────────────────────────────────
  Rollouts generated : 20
  Total frames       : 600
  Contact frames     : ~95
  Scenario mix       : {valid: 5, joint_limit: 5, contact_instability: 5, collision: 5}

  Audit results:
    PASS   ~5
    WARN   ~5
    BLOCK  ~10
──────────────────────────────────────────────────────────────────
```

Four scenario types generated:

| Scenario | Injection | Expected audit |
|---|---|---|
| `valid` | none — valid motion + box contact | PASS or WARN |
| `joint_limit` | pan=2.6 rad at midpoint (above 2.0 limit) | BLOCK |
| `contact_instability` | box mass=45 kg, push force > 35 N limit | WARN or BLOCK |
| `collision` | lift=1.5 rad, elbow=-0.35 rad → ee z=-0.022 m below table surface | BLOCK |

### Scalability gap

`so100_random_rollout.py` is not generic. It hardcodes:

1. **SO-100 link lengths** — `_L1=0.113, _L2=0.135, _L3=0.075` used in a manual 3-link planar FK approximation; wrong for any other robot
2. **Joint limits** — `JOINT_LOWER/JOINT_UPPER` Python constants, not read from the URDF file
3. **World layout** — box at `[0.25, 0, 0.025]`, table at `z=[-0.05, 0.0]`, workspace window tuned by hand for SO-100 reach
4. **Failure injection** — joint indices hardcoded (`trajectory[frame][1]=1.5`); breaks for any DOF ordering other than SO-100's
5. **FK model** — 3-link planar approximation; silently wrong outside ±20 cm workspace and incompatible with any other kinematic structure

This cannot be shown to OpenAI or frontier labs as a general-purpose world model evaluator.

### Reuse plan — what already exists across repos

**urdf-ops already has a complete rollout campaign infrastructure** (`backend/services/world_rollouts.py`):

- `WorldRolloutService.create_job(WorldScenePackageManifest, WorldRolloutCheckerProfile)` — submits a rollout job
- Manages QUEUED → RUNNING → COMPLETED lifecycle in a thread pool
- Calls an external rollout CLI subprocess; that CLI writes `trace.ndjson` + `decisions.ndjson`
- `import_results()` parses `WorldRolloutTraceRecord` (t_ms, state, semantic_outputs) and `WorldRolloutDecisionRecord`
- Decision vocabulary is **identical to WSP**: allow/warn/reject/stop/escalate

**urdf-ops `WorldBridgeRuntime`** (`backend/world_bridge/runtime.py`) records counterfactual transitions:

- `apply_joint_command()` → `WorldBridgeTransitionRecord` (joint_state_before, action_joint_positions, joint_state_after, scenario_time_ms)
- `WorldBridgeRolloutMode.COUNTERFACTUAL` — explicitly designed for hardware-free simulation
- These transitions are exactly the state-action-next-state triples WSP consumes

**The right architecture — not what so100_random_rollout.py does:**

```
WorldBridge counterfactual session
  → apply_joint_command() × N frames  (generic — any robot, any joint names)
  → WorldBridgeTransitionRecord[]
  → WSP trace adapter (wsp_trace_adapters.py already has adapter patterns)
  → PhysicalRolloutTrace
  → audit_physical_rollout_trace()
```

Full campaign path (for partner data or CI):

```
WorldScenePackageManifest (any robot URDF + world objects)
  + WorldRolloutCheckerProfile (WSP audit module config)
  → WorldRolloutService.create_job()     [urdf-ops service]
  → rollout CLI writes NDJSON            [plug in robot_rollout_generator.py here]
  → import_results() → decisions
```

The rollout CLI slot in `WorldRolloutService._run_cli()` is currently a stub pointing to a configurable external binary. `robot_rollout_generator.py` (using `compute_link_pose()` from kinematics.py) is what fills that slot.

**`backend/services/kinematics.py` in urdf-studio** already has everything needed for generic FK:

```python
def compute_link_pose(urdf_xml, joint_values, target_link):
    # yourdfpy-backed, works for ANY robot URDF, cached by SHA256
    # returns (position_xyz, quaternion_wxyz)
```

`backend/services/amik_kinematics.py` already has joint limit extraction and chain traversal:

```python
def _get_joint_limits(joint):        # reads joint.limit.lower / joint.limit.upper from URDF object
def _joint_chain(entry, target_link) # traverses child→parent, returns actuated joint list in chain
# urdf.actuated_joint_names          — all controllable joints, any robot
```

`yourdfpy` is already installed and in use. `urdf.actuated_joint_names` gives joint names for any robot; `urdf.joint_map[name].limit` gives real limits. No constants needed.

### Refactoring: completed

`so100_random_rollout.py` has been refactored into two files:

**`backend/services/robot_rollout_generator.py`** (new — generic)
- `RobotRolloutConfig` dataclass: urdf_xml, end_effector_link, entity_id, work_surface, world_objects, collision_injection_joints, workspace_bounds, min_ee_z
- `load_urdf_entry(urdf_xml)` — loads and caches via yourdfpy; reads real joint names and limits
- `fk_position(entry, joint_dict, target_link)` — generic FK, no hardcoded geometry
- `generate_joint_trajectory_dicts(entry, config, ...)` — samples within bounds, filters by min_ee_z
- `generate_rollout_trace(config, entry, ...)` → `PhysicalRolloutTrace`
- `generate_rollout_batch(config, entry, count, ...)` → `list[PhysicalRolloutTrace]`

**`backend/services/so100_random_rollout.py`** (thin SO-100 wrapper)
- Loads SO-100 URDF at import, derives `JOINT_NAMES/LOWER/UPPER` from URDF
- Preserves original public API: `fk_end_effector`, `generate_joint_trajectory`, `generate_so100_rollout_trace`, `generate_so100_rollout_batch`, `summarize_rollout_batch`
- Box placed at `[0, -0.20, 0.025]` — arm faces −Y at pan=0, not +X as the old approximation assumed
- Collision injection: `{"shoulder_lift": 2.4, "elbow_flex": -0.7}` → jaw z=−0.022 m (verified via yourdfpy)
- 558 tests pass (15 SO-100 tests + full suite)

To use the generic generator for a different robot:

```python
from backend.services.robot_rollout_generator import (
    RobotRolloutConfig, WorkSurface, WorldObject,
    load_urdf_entry, generate_rollout_batch,
)
urdf_xml = Path("franka.urdf").read_text()
entry    = load_urdf_entry(urdf_xml)
config   = RobotRolloutConfig(
    urdf_xml=urdf_xml,
    end_effector_link="panda_hand",
    entity_id="franka",
    work_surface=WorkSurface(),
    world_objects=[WorldObject("box", [0, -0.4, 0.025], [0.05, 0.05, 0.05])],
    collision_injection_joints={"panda_joint2": 1.5, "panda_joint4": -0.5},
)
traces = generate_rollout_batch(config, entry, count=20)
```

Next step: wire `RobotRolloutConfig` to `WorldScenePackageManifest` + `WorldRolloutService` from urdf-ops so that rollout campaigns can be dispatched through the existing job queue.

## Next Work

Immediate technical next steps:

1. ✅ Add native ROS2 MCAP/bag reading — `compile_mcap_file()` in `wsp_trace_adapters.py`. Raises `ImportError` with install instructions when `mcap`/`mcap-ros2-support` not installed. Ready to use once packages are added to env.
2. ✅ Ingest real MuJoCo/Genesis traces — `compile_simulator_file(path, source=)` convenience wrapper in `wsp_trace_adapters.py`. Already reads JSON/NDJSON exports; slot in real log files from simulator runs.
3. ✅ Add noisy calibration drift, missing entities, timestamp jitter, frame convention errors, and contact ambiguity — `CorpusNoiseConfig` dataclass + `_apply_corpus_noise()` in `wsp_failure_corpus.py`. Pass `noise_config=CorpusNoiseConfig(...)` to `generate_wsp_failure_corpus_samples()`.
4. ✅ Add simulator replay labels with actual stepping — `replay_label_samples_with_stepping()` hook in `wsp_replay_label.py`. Raises `NotImplementedError` until a physics CLI binary is wired in via `stepping_executable=`.
5. ✅ Split deterministic verification metrics from noisy stress metrics — `wsp_lab_demo.py` summary now exposes `metrics.deterministic` and `metrics.stress` as distinct sub-keys (in addition to the existing `stress_test` key for backward compat).
6. ✅ Build a real partner-data benchmark — `wsp_lerobot_hf_ingest.py` loads real SO-101 pick-place episodes directly from `lerobot/svla_so101_pickplace` on HuggingFace. `load_lerobot_hf_episode(repo_id, episode_index)` → `PhysicalRolloutTrace`. `build_so101_hf_benchmark(episode_indices=[0,1,2])` → `list[WorldModelTrainingSample]` for WSP audit. FK via SO-101 URDF (so101_new_calib.urdf, gripper_link); joint values are degrees. 570 tests pass.

Business/demo next steps:

1. Ask for real logs from HKSTP/HK logistics robotics partners.
2. Show `npm run wsp:lab-demo -- --stress-noise-rate 0.08`, not only the perfect default run.
3. Lead with adapters and CI gate, not the perfect synthetic metrics.
4. Say WSP is ready to evaluate messy logs, not that it has already solved real-world executability.

## Known Caveats

- Perfect default metrics are expected and should be described as deterministic pipeline verification.
- Replay labeling defaults to scale-safe export-oracle mode. Heavy simulator smoke loading is optional for small spot checks.
- The learned WSP graph baseline is a small PyTorch model. It is a measured baseline, not the final world model.
- Native binary ROS bag/MCAP ingestion is wired (`compile_mcap_file`) but gated on `pip install mcap mcap-ros2-support` — not yet in the project venv.
- The strongest product claim is currently infrastructure readiness, not real-world physical generalization.
