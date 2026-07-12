# Paper draft — contributions & abstract (v0, post-lit-scan)

STATUS: target framing, scoped to survive the novelty objections in `PAPER_PLAN.md`.
Implemented today = split-point localization + agreement metrics (mujoco/genesis).
To build = subsystem attribution, multi-engine coverage, the scenario suite. Marked [BUILT]/[TODO].

## Working title

*When and Why Simulators Disagree: A Ground-Truth-Free Benchmark for Cross-Engine
Trajectory Divergence in Robotics*

## Abstract (draft)

Robot-learning results increasingly depend on which physics engine produced them,
yet the field measures simulators only two ways: fidelity against real-world data
(expensive, engine-vs-reality) and raw throughput. How much two engines *disagree
with each other* on the same task — and, more usefully, *where in a rollout* and
*why* — is essentially unmeasured. We present a benchmark that runs an identical
scenario across multiple physics engines and reports cross-engine **agreement** as
a first-class metric, requiring no real-world ground truth. Our core contribution
is **divergence-onset localization**: time-aligning per-step trajectories to
identify the moment two engines' rollouts split, rather than comparing only
aggregate or final-state error. We further **attribute** divergence to engine
subsystems (contact model, solver iterations, timestep, integrator). We frame the
metric explicitly as *verification* (do independent implementations agree?) rather
than *validation* (are they right?), importing the Verification-and-Validation
distinction from computational science into multi-engine robotics evaluation. On
[N] scenarios across [K] engines we show [agreement matrices + representative
split analyses]; e.g. a Genesis-vs-MuJoCo pick task agrees on outcome yet the joint
trajectories split at 0.06 s — long before the 60 mm final object-pose gap — a
divergence invisible to outcome- or final-state metrics.

## Contributions (scoped)

1. **Divergence-onset localization (headline, [BUILT]).** A method that time-aligns
   two engines' per-step rollouts of the same scenario and reports the *split point*
   — the first time divergence crosses a threshold — with the metric (joint vs.
   object) that triggered it. No prior work locates cross-engine divergence *in time*.
2. **Sim-to-sim subsystem attribution ([TODO], scope narrowly).** Attributing a
   located split to a specific engine subsystem via captured contact forces and
   solver/integrator configuration. Novelty is *sim-to-sim, onset-linked* attribution
   — NOT parameter-sensitivity analysis, which is prior art (Acosta et al. 2022).
3. **Agreement as a first-class, ground-truth-free metric + reusable benchmark
   ([partial]).** Cross-engine consistency framed via V&V verification; an
   agreement/divergence matrix over engines × scenarios that needs no hardware.
4. **An open benchmark suite ([TODO]) + reproducible artifacts** spanning physics
   regimes (contact-rich, stiff/soft, restitution, friction, articulation, stacking).

## Positioning (one line per closest work)

- **RoboVerse/MetaSim (2025):** a simulator-agnostic *task/data* layer — we do not
  claim the contract; we contribute the *agreement/divergence metric* on top of one.
- **PolySim (2025):** uses sim-to-sim differences as a *route to sim-to-real*; we make
  those differences the *object of measurement and attribution*.
- **Acosta et al., RA-L/IROS 2022:** attributes *sim-to-real* error to tunable params;
  we attribute *sim-to-sim* divergence, tied to its onset.

## What we explicitly do NOT claim (scope discipline)

- NOT the first simulator-agnostic task contract (RoboVerse owns that).
- NOT the first cross-engine comparison (Erez–Tassa–Todorov, ICRA 2015).
- NOT correctness / which engine is "right" — consistency only; real-hardware
  anchoring appears as a single case study, not the empirical backbone.
- NOT novelty in parameter-sensitivity analysis itself.
