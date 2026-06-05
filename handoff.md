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

Trace adapters:

- `backend/services/wsp_trace_adapters.py`

Adapters currently accept practical JSON/JSONL exports for:

- MuJoCo-style traces
- Genesis-style traces
- ROS/MCAP-style topic/message exports
- LeRobot-style episode frames

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
537 passed, 2 skipped
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

## Next Work

Immediate technical next steps:

1. Add native ROS2 MCAP/bag reading, not only JSON topic exports.
2. Ingest real MuJoCo/Genesis traces from an external task, not generated WSP fixtures.
3. Add noisy calibration drift, missing entities, timestamp jitter, frame convention errors, and contact ambiguity into the corpus generator.
4. Add simulator replay labels that run longer rollouts with actual simulator stepping, not only export-oracle labels at scale.
5. Split deterministic verification metrics from noisy stress metrics in any public report.
6. Build a real partner-data benchmark once logs are available.

Business/demo next steps:

1. Ask for real logs from HKSTP/HK logistics robotics partners.
2. Show `npm run wsp:lab-demo -- --stress-noise-rate 0.08`, not only the perfect default run.
3. Lead with adapters and CI gate, not the perfect synthetic metrics.
4. Say WSP is ready to evaluate messy logs, not that it has already solved real-world executability.

## Known Caveats

- Perfect default metrics are expected and should be described as deterministic pipeline verification.
- Replay labeling defaults to scale-safe export-oracle mode. Heavy simulator smoke loading is optional for small spot checks.
- The learned WSP graph baseline is a small PyTorch model. It is a measured baseline, not the final world model.
- Native binary ROS bag/MCAP ingestion is not implemented yet.
- The strongest product claim is currently infrastructure readiness, not real-world physical generalization.
