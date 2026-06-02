import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { buildWorldScenarioTimeline } from "./worldScenarioEngine";

const WORLD_PERF_TARGET_REDUCTION_FACTOR = 0.5;
const WORLD_PERF_BUILD_ITERATIONS = 120;
const WORLD_PERF_SAMPLE_ITERATIONS = 120;
const WORLD_PERF_SNAPSHOTS_PER_SAMPLE = 120;
const WORLD_PERF_SAMPLE_TIME_STEP_MS = 17;
const WORLD_PERF_BASE_SEED = 100;

const WORLD_PERF_BASELINE_TIMELINE_BUILD_P95_MS = 12;
const WORLD_PERF_BASELINE_TIMELINE_SAMPLE_P95_MS = 1;

const WORLD_PERF_TARGET_TIMELINE_BUILD_P95_MS =
  WORLD_PERF_BASELINE_TIMELINE_BUILD_P95_MS * WORLD_PERF_TARGET_REDUCTION_FACTOR;
const WORLD_PERF_TARGET_TIMELINE_SAMPLE_P95_MS =
  WORLD_PERF_BASELINE_TIMELINE_SAMPLE_P95_MS * WORLD_PERF_TARGET_REDUCTION_FACTOR;

const WORLD_PERF_PARAMS = {
  baseCenter: new THREE.Vector3(0, 0, 0),
  baseSize: new THREE.Vector3(0.5, 0.4, 0.3),
  baseZ: 0,
  ringRadius: 0.9,
  forwardOffset: 0.8,
} as const;
const WORLD_PERF_P95_FRACTION = 0.95;

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const rank = Math.floor((sorted.length - 1) * p);
  return sorted[rank] ?? 0;
};

describe("world perf gate", () => {
  it("keeps timeline build latency within tightened p95 budget", () => {
    const latenciesMs: number[] = [];
    for (let i = 0; i < WORLD_PERF_BUILD_ITERATIONS; i++) {
      const startMs = performance.now();
      buildWorldScenarioTimeline({
        ...WORLD_PERF_PARAMS,
        seed: WORLD_PERF_BASE_SEED + i,
      });
      latenciesMs.push(performance.now() - startMs);
    }

    const p95Ms = percentile(latenciesMs, WORLD_PERF_P95_FRACTION);
    expect(p95Ms).toBeLessThanOrEqual(WORLD_PERF_TARGET_TIMELINE_BUILD_P95_MS);
  });

  it("keeps per-frame sampling latency within tightened p95 budget", () => {
    const latenciesMs: number[] = [];
    for (let i = 0; i < WORLD_PERF_SAMPLE_ITERATIONS; i++) {
      const timeline = buildWorldScenarioTimeline({
        ...WORLD_PERF_PARAMS,
        seed: WORLD_PERF_BASE_SEED + i,
      });
      const startMs = performance.now();
      for (let frame = 0; frame < WORLD_PERF_SNAPSHOTS_PER_SAMPLE; frame++) {
        timeline.sampleAt(frame * WORLD_PERF_SAMPLE_TIME_STEP_MS);
      }
      const durationMs = performance.now() - startMs;
      latenciesMs.push(durationMs / WORLD_PERF_SNAPSHOTS_PER_SAMPLE);
    }

    const p95Ms = percentile(latenciesMs, WORLD_PERF_P95_FRACTION);
    expect(p95Ms).toBeLessThanOrEqual(WORLD_PERF_TARGET_TIMELINE_SAMPLE_P95_MS);
  });
});
