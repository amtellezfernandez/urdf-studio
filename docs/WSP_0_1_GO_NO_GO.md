# WSP-0.1 Go/No-Go

## Demo Claim

Use this claim:

```text
We built the compiler and validation substrate that world models need to produce
physically executable robot rollouts.
```

Do not claim this:

```text
We built a learned robotic world model.
```

The implemented vertical slice is:

```text
scene/world package
observed robot-state/action log
  -> PhysicalStateFrame
  -> state/action token sequence
  -> deterministic next-state rollout
  -> executability audit
  -> corrective branch generation
  -> MuJoCo + Genesis simulator export verification
  -> JSONL world-model training samples
```

## One-Command Demo

```bash
npm run wsp:demo -- --out-dir /tmp/wsp-demo
```

Expected artifacts:

```text
/tmp/wsp-demo/compiled_tokens.json
/tmp/wsp-demo/predicted_trace.json
/tmp/wsp-demo/executability_report.json
/tmp/wsp-demo/correction_branches.json
/tmp/wsp-demo/corrected_state.mjcf.xml
/tmp/wsp-demo/corrected_state.genesis-scene.json
/tmp/wsp-demo/export_status.mujoco.json
/tmp/wsp-demo/export_status.genesis.json
/tmp/wsp-demo/world_model_samples.jsonl
/tmp/wsp-demo/world_model_dataset_manifest.json
/tmp/wsp-demo/world_model_dataset_readiness.json
/tmp/wsp-demo/summary.json
```

Observed robot reality logs can be compiled separately:

```bash
npm run wsp:ingest-log -- observed_robot_log.json --out /tmp/wsp-observed-trace.json
```

The demo should report:

```text
compile: physical entities + text tokens + tensor-ready features
rollout: state/action trace
audit: reject original rollout
repair: correction branches
export: MuJoCo and Genesis success
verification: position/size/quaternion/collision equivalence
dataset: executable and rejected transition samples for model training
readiness: fixed feature schema, vocab maps, and label distribution
```

## Acceptance Criteria

WSP-0.1 is a go for a technical demo if all checks pass:

```text
same scene + same action -> deterministic token sequence
PhysicalStateFrame -> tokens -> decoded state preserves entity ids/types/poses
push action changes pallet pose
wait/replan does not move geometry
reserve_dock changes dock metadata
heavy pallet push triggers contact_stability rejection
invalid rollout export is rejected
corrected branch export is accepted
MuJoCo export loads and verifies within 1e-6m tolerance
Genesis export builds headless and verifies within 1e-6m tolerance
collision:false survives into simulator verification
world-model sample JSONL contains state/action/next-state tokens
world-model sample JSONL contains both rejected and executable labels
observed robot-state/action log -> WSP trace -> world-model samples
dataset readiness check enforces stable feature dimensions and vocab metadata
```

## Commands To Prove It

```bash
npm run test:backend -- \
  backend/tests/test_physical_state_compiler.py \
  backend/tests/test_executability_audit.py \
  backend/tests/test_wsp_demo_pipeline.py \
  backend/tests/test_world_layout_static_transfer.py

npm run wsp:demo -- --out-dir /tmp/wsp-demo

npm run world:layout:transfer:check -- \
  web/public/world-layouts/hkhack-pallet-dock.world-package.json \
  --write-mjcf /tmp/hkhack-transfer.mjcf.xml

npm run wsp:dataset -- \
  /tmp/wsp-demo/predicted_trace.json \
  --repair-plan /tmp/wsp-demo/correction_branches.json \
  --branch stop_and_replan \
  --out /tmp/wsp-demo/world-model-samples.jsonl \
  --manifest-out /tmp/wsp-demo/world-model-dataset.json

npm run wsp:dataset:check -- \
  /tmp/wsp-demo/world-model-samples.jsonl \
  --require-balanced-labels \
  --out /tmp/wsp-demo/world-model-readiness.json

npm run wsp:ingest-log -- observed_robot_log.json --out /tmp/wsp-observed-trace.json
```

Full branch guard:

```bash
npm run test:backend
npm run lint
npm run typecheck
npm run scalar-constants:check
```

## What Is Ready

- Typed physical state, action, token, rollout, audit, correction, and export models.
- Static layout and world package compilation into physical-state tokens.
- Observed robot-state/action log ingestion into WSP traces.
- Deterministic action rollout for the WSP-0.1 protocol.
- Executability audit with real rejection cases.
- Repair branches for invalid traces.
- MuJoCo MJCF export of corrected executable final state.
- Genesis scene export of the same corrected final state.
- Simulator equivalence verification for position, size, quaternion, type, missing objects, and collision flags.
- JSONL state/action/next-state samples with executable/rejected labels for world-model training.
- Dataset readiness gate with stable feature schema, vocab maps, and feature-dimension checks.

## What Is Not Ready

- Learned next-state model.
- Training job for the next-state model.
- Production adapters for every real robot log format.
- Full robot reachability and joint-limit rollout auditing.
- High-fidelity contact dynamics.
- Time-series simulator playback.
- Isaac/Gazebo export.
- UI integration.

## 3-Minute Demo Script

```text
0:00 Problem:
World-model futures can look plausible but still be physically impossible.

0:25 Compile:
Show scene -> PhysicalStateFrame -> text tokens + tensor-ready features.

0:55 Rollout:
Show state_t + push action -> predicted trace.

1:30 Audit:
Show original rollout rejected for contact/collision/executability reasons.

2:05 Repair:
Show correction branches and select stop_and_replan or another executable branch.

2:40 Export:
Show corrected branch exported to MuJoCo and Genesis with simulator equivalence metrics.

2:55 Dataset:
Show JSONL samples with state tokens, action tokens, next-state targets, and labels.
```

Closing line:

```text
Visual plausibility is not enough. Robots need executable futures.
```
