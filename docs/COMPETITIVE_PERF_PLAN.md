# Competitive Performance Plan (Genesis vs URDF Studio IKD)

## Purpose

Build a fair, reproducible benchmark program to compare `ikd` against publicly reported Genesis simulator performance claims, then optimize until URDF Studio wins on control-loop latency, jitter, CPU/RAM efficiency, and sustained throughput.

## External baseline (public claims)

Use only primary/public sources and store them with dates in this document before every benchmark cycle.

- Genesis official site: claims include simulation speedup and large-scene throughput.
- Genesis benchmark repo and docs (speed benchmark scripts/config).
- Hardware/software notes from those sources.

Important: treat public numbers as marketing baselines until reproduced under matched conditions.

## Phase 0: Benchmark governance

1. Freeze benchmark rules:
- Same robot model(s), same target trajectory, same update rates.
- Same CPU/GPU class (or clearly normalized tiers).
- Same OS kernel scheduler settings and thermal conditions.
2. Freeze success metric format:
- p50/p95/p99 and max for each metric.
- Minimum 3 repeated runs; report mean and variance.
3. Add benchmark metadata schema:
- commit sha, machine profile, clock governor, build mode, benchmark scenario, timestamp.

## Phase 1: Competitor profiling pipeline

1. Collect Genesis public numbers into a versioned table.
2. Re-run their public benchmark harness where possible.
3. Record gaps between claim and observed numbers.
4. Define a conservative competitor target envelope:
- `target_floor` = best reproduced competitor value.
- `target_ceiling` = published claim.

## Phase 2: URDF Studio baseline suite

Create `benchmarks/` with fixed scenarios:

1. `drag_single_ee`
- Continuous drag target at 60/120 Hz input.
- `ikd` loop at 200/500/1000 Hz.

2. `burst_targets`
- 500–2000 target updates/sec for 30 seconds.

3. `ws_fanout`
- 1, 5, 20 telemetry clients at 60/120 Hz.

4. `degraded_client`
- One intentionally slow client to validate non-blocking behavior.

5. `multi_robot_session` (future)
- N independent chains in one daemon process.

## Phase 3: Metrics that matter

Primary KPIs:

1. Control-loop timing
- Tick period error (ns), p99 jitter, overrun ratio.

2. Command latency
- `source_ts -> applied tick` latency p50/p95/p99.

3. Smoothness
- Joint jerk proxy from finite differences (q, dq, ddq).

4. Resource footprint
- RSS, peak RSS, CPU%, context switches/sec.

5. Stability
- NaN count, clamp event rate, stale-target event rate.

6. Throughput
- sustained accepted target updates/sec without instability.

## Phase 4: Optimization roadmap (ordered by ROI)

1. Hot-path data structures
- Replace lock+clone telemetry paths with lock-free latest-sample buffers.
- Use fixed-capacity structures in control path.

2. Network/control isolation
- Latest-only coalescing for target ingress.
- Zero waiting in drag callback paths.

3. Solver micro-optimizations
- Precompute chain constants.
- Minimize allocations and matrix rebuilds per tick.
- SIMD-friendly vector math and cache-aware layout.

4. Scheduling and OS tuning
- Isolate control thread affinity.
- Tune timer source and scheduler policy where available.

5. Backpressure hardening
- Per-client bounded WS queues and drop-old strategy.

## Phase 5: Win criteria

Declare "faster and lighter" only when all hold for a scenario tier:

1. p99 command-to-apply latency <= competitor `target_floor`.
2. p99 loop jitter <= competitor `target_floor`.
3. RSS <= competitor `target_floor` at equal workload.
4. No regression in control stability metrics.

## Phase 6: Release gates

1. Every perf PR includes benchmark delta table.
2. Block merge on >3% regression in primary KPIs.
3. Weekly benchmark run on fixed hardware with trend dashboard.

## Execution schedule

Week 1:
- Implement benchmark harness and metadata capture.
- Produce first reproducible URDF baseline table.

Week 2:
- Reproduce competitor public benchmarks and publish comparison.
- Apply lock-free telemetry and latest-only ingress improvements.

Week 3:
- Solver micro-optimization pass + scheduling/affinity tuning.
- Re-run full matrix and publish win/loss table.

Week 4:
- Close remaining KPI gaps and enforce regression gates in CI.

## Deliverables

- `benchmarks/README.md` with exact run commands.
- `benchmarks/results/*.jsonl` raw runs.
- `benchmarks/reports/*.md` summarized tables and plots.
- CI perf check for critical scenarios.
