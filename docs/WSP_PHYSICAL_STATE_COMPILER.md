# WSP Physical-State Compiler

This branch adds the first backend-only slice of the WSP compiler loop:

```text
scene or world package
  -> physical state frame
  -> state/action token sequence
  -> deterministic rollout baseline
  -> executability audit
  -> corrective branch generation
  -> simulator-state export
  -> world-model sample export
  -> trainability smoke baseline
```

It is not a production learned world model yet. The purpose is to make the physical
state layer explicit enough to plug into learned rollouts and prove that the exported
samples can be consumed by a model-training loop.

## Commands

Run the full WSP-0.1 loop in one command:

```bash
npm run wsp:demo -- --out-dir /tmp/wsp-demo
```

That command writes:

- `/tmp/wsp-demo/compiled_tokens.json`
- `/tmp/wsp-demo/observed_trace.json`
- `/tmp/wsp-demo/predicted_trace.json`
- `/tmp/wsp-demo/executability_report.json`
- `/tmp/wsp-demo/correction_branches.json`
- `/tmp/wsp-demo/corrected_state.mjcf.xml`
- `/tmp/wsp-demo/corrected_state.genesis-scene.json`
- `/tmp/wsp-demo/export_status.mujoco.json`
- `/tmp/wsp-demo/export_status.genesis.json`
- `/tmp/wsp-demo/world_model_samples.jsonl`
- `/tmp/wsp-demo/world_model_dataset_manifest.json`
- `/tmp/wsp-demo/world_model_dataset_readiness.json`
- `/tmp/wsp-demo/world_model_baseline_report.json`
- `/tmp/wsp-demo/world_model_baseline_model.json`
- `/tmp/wsp-demo/summary.json`

Compile a static layout or world package:

```bash
npm run wsp:compile -- web/public/world-layouts/hkhack-pallet-dock.world-package.json --out /tmp/wsp-compiled.json
```

Compile an observed robot-state/action log into a WSP trace:

```bash
npm run wsp:ingest-log -- observed_robot_log.json --out /tmp/wsp-observed-trace.json
```

The default demo also ingests `backend/fixtures/wsp/observed-pallet-push.robot-log.json`.
Use an empty observed-log value to run with only simulator-generated rollouts:

```bash
npm run wsp:demo -- --observed-log "" --out-dir /tmp/wsp-demo-no-observed-log
```

Run a deterministic rollout:

```bash
npm run wsp:rollout -- /tmp/wsp-compiled.json \
  --action-json '{"action_id":"push-pallet-to-dock","action_type":"push","actor_id":"robot_1","object_id":"pallet_7","destination_id":"dock_d2","duration_ms":1000,"params":{"delta_xyz":[0.5,0,0],"max_force_n":120,"battery_cost":0.1}}' \
  --steps 2 \
  --step-ms 500 \
  --out /tmp/wsp-rollout.json
```

Audit the rollout:

```bash
npm run wsp:audit -- /tmp/wsp-rollout.json --out /tmp/wsp-audit.json
```

Repair a failed rollout:

```bash
npm run wsp:repair -- /tmp/wsp-rollout.json --out /tmp/wsp-repair.json
```

Export an executable trace or repair branch to MuJoCo:

```bash
npm run wsp:export -- /tmp/wsp-rollout.json \
  --repair-plan /tmp/wsp-repair.json \
  --branch stop_and_replan \
  --target mujoco \
  --out /tmp/wsp-corrected.xml
```

Export the same executable final frame to a Genesis scene artifact:

```bash
npm run wsp:export -- /tmp/wsp-rollout.json \
  --repair-plan /tmp/wsp-repair.json \
  --branch stop_and_replan \
  --target genesis \
  --out /tmp/wsp-corrected.genesis-scene.json
```

Export rollout transitions as trainable world-model samples:

```bash
npm run wsp:dataset -- /tmp/wsp-rollout.json \
  --repair-plan /tmp/wsp-repair.json \
  --branch stop_and_replan \
  --out /tmp/wsp-world-model-samples.jsonl \
  --manifest-out /tmp/wsp-world-model-dataset.json
```

Check the JSONL package is model-ready:

```bash
npm run wsp:dataset:check -- /tmp/wsp-world-model-samples.jsonl \
  --require-balanced-labels \
  --out /tmp/wsp-world-model-readiness.json
```

Run the trainability smoke test:

```bash
npm run wsp:train-baseline -- /tmp/wsp-world-model-samples.jsonl \
  --require-balanced-labels \
  --min-samples 2 \
  --out /tmp/wsp-world-model-baseline-report.json \
  --model-out /tmp/wsp-world-model-baseline.json
```

MuJoCo export converts physical frames declared as `studio-y-up` into simulator `z-up`
coordinates with the same `studio-y-up-to-z-up` mapping used by the static world-layout
transfer gate. The export also preserves primitive color metadata and explicit
`collision: false` objects as non-colliding MJCF geoms. Genesis export uses the same
converted final-frame primitives and performs a headless scene-build smoke check when
Genesis is installed.

Both simulator exporters reuse the static world-layout transfer verifier. Their status
artifacts report loaded primitive counts, position/size/quaternion error, missing
objects, type mismatches, and collision mismatches. The current tolerance is `1e-6m`,
which is 0.001mm.

World-model sample export writes one JSONL row per transition. Each row contains the
state tokens, action token, next-state tokens, tensor-ready continuous features,
executability label, audit score, and optional simulator export provenance.
The dataset manifest records the stable entity feature schema, entity/action vocab maps,
constraint vocab, and sample schema version. The readiness check fails on feature-dimension
drift or duplicate sample ids.
The one-command demo includes both generated rollout transitions and observed robot-log
transitions in the same JSONL package.

The baseline trainer is intentionally small and dependency-free. It fits an
action-conditioned mean-delta transition model over the fixed WSP feature schema,
evaluates held-out state/action/next-state rows, and writes a report with feature
MAE, position MAE, split counts, readiness metadata, and the learned baseline artifact.
This is a trainability smoke test, not the final world model.

The audit currently checks:

- entity quaternion validity
- positive metric geometry sizes
- action references to existing entities
- primitive AABB collision overlap unless an explicit contact/support/attached relation permits it
- push contact force stability when mass/friction/max force are known
- battery reserve when actor battery and action cost are known
- dock availability when an action targets a dock

## Current Boundary

Ready:

- typed physical entities, relations, constraints, actions, frames, rollout traces, and executability reports
- static layout and world package compilation into physical state tokens
- observed robot-state/action log ingestion into WSP rollout traces
- deterministic action rollout for `navigate`, `push`, `translate`, `move_object`, `reserve_dock`, `wait`, `handoff_to_human`, `inspect`, `replan`, and `set_pose`
- executable pass/fail reports plus correction branches
- MuJoCo MJCF and Genesis scene export for executable traces and selected repair branches
- JSONL world-model transition samples with executable/rejected labels
- dataset schema/readiness gate for fixed feature dimensions and vocab maps
- trainability smoke baseline over WSP JSONL state/action/next-state samples
- one-command demo dataset that mixes repaired simulator transitions and observed robot-log transitions

Not ready:

- learned next-state prediction
- production training loop for a learned next-state model
- rich real-log adapters beyond the current JSON/JSONL observed state/action format
- robot reachability and full joint-limit rollout auditing
- high-fidelity contact dynamics or frictional simulation
- time-series Genesis playback and Isaac/Gazebo export of corrected dynamic traces
- UI integration
