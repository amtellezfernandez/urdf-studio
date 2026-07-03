import { describe, expect, it } from "vitest";
import {
  AdaptiveTrajectoryRuntime,
  createInMemoryAdaptiveTrajectoryRepository,
} from "./adaptiveTrajectoryRuntime";

const FORWARD_TARGET = 1.4;
const FORWARD_START = 0;
const REVERSE_TARGET = -0.6;
const REVERSE_START = 1.1;
const FORWARD_MAX_VELOCITY = 1.8;
const FORWARD_MAX_ACCELERATION = 6.0;
const REVERSE_MAX_VELOCITY = 1.6;
const REVERSE_MAX_ACCELERATION = 5.2;
const FORWARD_DURATION_SEC = 0.9;
const REVERSE_DURATION_SEC = 0.85;
const EPSILON = 1e-4;
const COMPLETION_TOLERANCE = 8e-4;
const FORWARD_TOTAL_FRAMES = 240;
const REVERSE_TOTAL_FRAMES = 240;
const MONOTONIC_TOLERANCE = 1e-9;
const FINAL_PROXIMITY_TOLERANCE = 0.01;

describe("AdaptiveTrajectoryRuntime", () => {
  it("generates continuous, convergent steps", () => {
    const runtime = new AdaptiveTrajectoryRuntime({
      contextKey: "robot-a::arm",
      jointSpecs: [
        {
          jointName: "j1",
          startValue: 0,
          targetValue: 1.1,
          maxVelocity: 2.2,
          maxAcceleration: 8.5,
        },
      ],
      durationSec: 0.4,
      epsilon: 1e-4,
      completionTolerance: 8e-4,
    });

    let current = { j1: 0 };
    let last = current.j1;
    let maxStep = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      const tSec = frame / 120;
      const step = runtime.step(current, tSec, 1 / 120);
      current = { ...current, ...step.desiredValues };
      runtime.reconcileApplied({ j1: last }, current, 1 / 120);
      const stepDelta = Math.abs(current.j1 - last);
      maxStep = Math.max(maxStep, stepDelta);
      last = current.j1;
    }

    expect(current.j1).toBeGreaterThan(1.0);
    expect(maxStep).toBeLessThan(0.12);
    expect(runtime.getTelemetry().maxVelocityJump).toBeLessThan(0.8);
  });

  it("adapts and persists profile when many steps are safety-projected", () => {
    const repository = createInMemoryAdaptiveTrajectoryRepository();
    const runtime = new AdaptiveTrajectoryRuntime({
      contextKey: "robot-b::arm",
      jointSpecs: [
        {
          jointName: "j1",
          startValue: 0,
          targetValue: 0.9,
          maxVelocity: 2.0,
          maxAcceleration: 6.0,
        },
      ],
      durationSec: 0.35,
      epsilon: 1e-4,
      completionTolerance: 8e-4,
      repository,
    });

    const initialProfile = runtime.getProfile();
    for (let i = 0; i < 30; i += 1) {
      runtime.step({ j1: 0 }, i / 60, 1 / 60);
      runtime.markSafetyProjection();
    }
    const updated = runtime.finalize(false, 1200);
    expect(updated.speedScale).toBeLessThan(initialProfile.speedScale);
    expect(updated.accelerationScale).toBeLessThan(initialProfile.accelerationScale);

    const restored = repository.load("robot-b::arm");
    expect(restored?.completedRuns).toBe(1);
    expect(restored?.speedScale).toBeCloseTo(updated.speedScale, 6);
  });

  it("keeps monotonic forward progress under variable frame dt", () => {
    const runtime = new AdaptiveTrajectoryRuntime({
      contextKey: "robot-c::arm",
      jointSpecs: [
        {
          jointName: "j1",
          startValue: FORWARD_START,
          targetValue: FORWARD_TARGET,
          maxVelocity: FORWARD_MAX_VELOCITY,
          maxAcceleration: FORWARD_MAX_ACCELERATION,
        },
      ],
      durationSec: FORWARD_DURATION_SEC,
      epsilon: EPSILON,
      completionTolerance: COMPLETION_TOLERANCE,
    });

    const frameDtSequenceSec = [1 / 120, 1 / 90, 1 / 60, 1 / 75, 1 / 55];
    let elapsedSec = 0;
    let current = { j1: FORWARD_START };
    let previous = current.j1;

    for (let frame = 0; frame < FORWARD_TOTAL_FRAMES; frame += 1) {
      const dtSec = frameDtSequenceSec[frame % frameDtSequenceSec.length];
      elapsedSec += dtSec;
      const step = runtime.step(current, elapsedSec, dtSec);
      const next = { ...current, ...step.desiredValues };
      runtime.reconcileApplied(current, next, dtSec);
      expect(next.j1).toBeGreaterThanOrEqual(previous - MONOTONIC_TOLERANCE);
      expect(next.j1).toBeLessThanOrEqual(FORWARD_TARGET + MONOTONIC_TOLERANCE);
      previous = next.j1;
      current = next;
    }

    expect(current.j1).toBeGreaterThan(FORWARD_TARGET - FINAL_PROXIMITY_TOLERANCE);
  });

  it("keeps monotonic reverse progress for decreasing targets", () => {
    const runtime = new AdaptiveTrajectoryRuntime({
      contextKey: "robot-d::arm",
      jointSpecs: [
        {
          jointName: "j1",
          startValue: REVERSE_START,
          targetValue: REVERSE_TARGET,
          maxVelocity: REVERSE_MAX_VELOCITY,
          maxAcceleration: REVERSE_MAX_ACCELERATION,
        },
      ],
      durationSec: REVERSE_DURATION_SEC,
      epsilon: EPSILON,
      completionTolerance: COMPLETION_TOLERANCE,
    });

    const frameDtSequenceSec = [1 / 100, 1 / 80, 1 / 60, 1 / 120];
    let elapsedSec = 0;
    let current = { j1: REVERSE_START };
    let previous = current.j1;

    for (let frame = 0; frame < REVERSE_TOTAL_FRAMES; frame += 1) {
      const dtSec = frameDtSequenceSec[frame % frameDtSequenceSec.length];
      elapsedSec += dtSec;
      const step = runtime.step(current, elapsedSec, dtSec);
      const next = { ...current, ...step.desiredValues };
      runtime.reconcileApplied(current, next, dtSec);
      expect(next.j1).toBeLessThanOrEqual(previous + MONOTONIC_TOLERANCE);
      expect(next.j1).toBeGreaterThanOrEqual(REVERSE_TARGET - MONOTONIC_TOLERANCE);
      previous = next.j1;
      current = next;
    }

    expect(current.j1).toBeLessThan(REVERSE_TARGET + FINAL_PROXIMITY_TOLERANCE);
  });
});
