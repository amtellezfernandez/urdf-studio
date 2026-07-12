# Paper plan — a simulator-agnostic cross-simulator divergence benchmark

Branch: `paper/cross-sim-benchmark` (private during development; benchmark + contracts
to be released public at publication). Working artifact — evolve as we go.

## Decisions (locked 2026-07-12)

| Question | Decision |
| --- | --- |
| Paper spine | Benchmark + attribution method, real-anchored *framing* |
| Ground truth | **Cross-sim consistency** is the operational metric (no correctness claim); real-SO-101 anchoring is a validation case study + roadmap |
| Repo | Private branch, frozen at a paper commit; benchmark carved into a separable package |
| Release | **Public** — the contract + benchmark are meant to become a community standard |

### Spine ↔ ground-truth reconciliation (important, keep honest)

We do **not** claim which simulator is "correct." The empirical backbone is
*pairwise consistency*: where, when, and (via attribution) plausibly why two
engines running the identical scenario diverge. Real-hardware anchoring (SO-101/
SO-100 HF data) appears as **one case study** showing the framework *can* be
anchored, plus a roadmap item — not as the primary result. Any "which sim is
more realistic" language must be scoped to that single anchored case.

## What already exists (this repo, reuse — do not rebuild)

- **Simulator-agnostic scenario contract** — `scenarios/*`, `world-v1`/`scenario-v1`
  JSON Schemas already published CC0 (git `01d7761`). This *is* the paper's API.
- **Cross-sim execution** — `backend/scripts/scenario_run.py` runs one scenario on
  N engines (mujoco, genesis, isaac) in isolated worker processes → `comparison.json`.
- **Divergence engine** — `backend/services/scenario_trace_divergence.py`: time-aligns
  two `trace.ndjson`, computes per-step joint-RMSE + object pose deltas, finds the
  **split point** (first threshold crossing). Verified genesis-vs-mujoco: split at
  0.06s (joints) preceding 60mm object drift.
- **Metrics surfaced** — `scenario_compare.py`: success-agreement, final pose/joint
  delta, per-episode trajectory divergence, `mean_wall_time_s`.
- **Report** — `scenario_report_html.py`: self-contained HTML with a divergence-over-time
  chart (split marker) + playback.
- **Reproducibility** — `scenario repro` re-runs a recorded run and verifies outcomes;
  digest-signed traces + environment fingerprints per run.

## Gaps to close for a paper (ranked)

1. **Benchmark suite spanning physics regimes** — one contact-rich pick-place is not a
   benchmark. Each scenario must stress a *different* engine subsystem so attribution
   is meaningful:
   - contact-rich manipulation (grasp/place) — **must replace the `grasp_attach: weld`
     kinematic cheat with a real contact grasp**, or the contact-physics claim is void
   - stiff vs. compliant contact
   - restitution / high-speed impact (bouncing)
   - friction-limited pushing/sliding
   - articulated constraints / closed kinematic chains
   - long-horizon stacking stability (numerical drift over time)
2. **Attribution (rung 3)** — currently we *localize* divergence but cannot *attribute*
   it. Needs: contact forces in `ContactRecord` (today position-only), and per-engine
   solver config (integrator, iterations, timestep, contact model, substeps) captured
   into the environment fingerprint. Without this, "why" stays a hypothesis.
3. **Statistical rigor** — multi-seed runs + variance, to separate genuine engine
   divergence from run-to-run noise. Report normalized divergence (scale-invariant)
   and an **agreement matrix** across all engine pairs per scenario (the headline
   artifact / "leaderboard").
4. **Backend matrix** — extend beyond mujoco/genesis; PyBullet, MJX, (Isaac on native
   Linux). More engines → a more compelling consistency matrix.
5. **Real-SO-101 anchoring case study** — replay one real trajectory in each sim,
   measure fidelity. Scoped, not the backbone.

## Separable public package

Carve the benchmark out of the app so it can be cited/released independently:
`scenario_*` + `sim_backends` + `scenario_trace_divergence` + the CC0 contracts →
a documented package with its own README, `doctor`, and reproduce path. URDF Studio
*depends on / authors into* it; the paper cites *it*, not the app.

## Paper skeleton (draft)

1. Intro — simulator fragmentation; disagreement is real but unmeasured; contribution.
2. Related work — sim-to-real gap, prior MuJoCo/PyBullet/Isaac comparisons, contact-model
   studies. **(lit scan required before claiming novelty — see TODO)**
3. The simulator-agnostic scenario contract.
4. Divergence localization + attribution method.
5. Benchmark suite — regimes and what each isolates.
6. Results — agreement matrices, split-time analyses, efficiency (wall-clock/steps-per-s).
7. Case study — real SO-101 anchoring.
8. Limitations — consistency≠correctness, grasp modeling, WSL/GPU constraints, engine coverage.
9. Release + reproducibility.

## Open risks

- **Novelty positioning** — simulator comparison is not new; our edge is
  attribution + reproducible contract + real anchoring. Must be scoped precisely.
- **Grasp-weld cheat** undermines the contact-physics story until replaced.
- **Two eval threads** — this benchmark vs. the WSP policy-failure eval are *separate*;
  the SO-101 data is their only shared seam. Decide deliberately whether they are one
  paper or two.

## TODO (next actions)

- [ ] Literature scan to fix novelty positioning (deep-research).
- [ ] Decide commit hygiene: divergence *infrastructure* is product code (belongs on
      `main`); this branch carries *paper-specific* additions (suite, analysis, this plan).
- [ ] Design the benchmark-suite scenario set (regimes above).
- [ ] Spec rung-3 attribution capture (contact forces + solver config in fingerprint).
