import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ROVER_APPROACH_CONFIG } from "./approachParams";
import {
  computeRoverApproachRotateTravelRad,
  computeRoverApproachStep,
  computeSignedPlanarYawErrorRad,
} from "./approachExecutor";
import type { RoverApproachPlan } from "./approachTypes";

const DT_SEC = 1 / 60;
const DESIRED_STOP_DISTANCE_M = 0.6;
const WAYPOINT_STOP_DISTANCE_M = 0;
const WAYPOINT_DISTANCE_TO_TARGET_M = 0.04;
const YAW_MODERATE_RAD = (ROVER_APPROACH_CONFIG.yawToleranceRad + ROVER_APPROACH_CONFIG.yawRotateInPlaceThresholdRad) * 0.5;

const createApproachPlan = (): RoverApproachPlan => ({
  mode: "approach",
  reason: "outside-reach",
  desiredStopDistanceM: DESIRED_STOP_DISTANCE_M,
  distanceToleranceM: ROVER_APPROACH_CONFIG.distanceToleranceM,
  allowTranslationYawAssist: true,
  requiresRotation: true,
  requiresTranslation: true,
  distanceToTargetM: 1.5,
  forwardDotTarget: 1,
});

describe("computeSignedPlanarYawErrorRad", () => {
  it("returns signed yaw around up-axis", () => {
    const forward = new THREE.Vector3(1, 0, 0);
    const target = new THREE.Vector3(0, 1, 0);
    const up = new THREE.Vector3(0, 0, 1);
    const yaw = computeSignedPlanarYawErrorRad(forward, target, up);
    expect(yaw).toBeGreaterThan(0);
  });
});

describe("computeRoverApproachStep", () => {
  it("returns zero rotate travel for non-finite yaw input", () => {
    expect(computeRoverApproachRotateTravelRad(Number.NaN, DT_SEC)).toBe(0);
  });

  it("rotates in place while yaw error is high", () => {
    const step = computeRoverApproachStep({
      plan: createApproachPlan(),
      distanceToTargetM: 1.2,
      yawErrorRad: ROVER_APPROACH_CONFIG.yawRotateInPlaceThresholdRad * 1.2,
      dtSec: DT_SEC,
    });
    expect(step.phase).toBe("rotate");
    expect(step.linearTravelM).toBe(0);
    expect(Math.abs(step.angularTravelRad)).toBeGreaterThan(0);
  });

  it("translates once yaw is aligned and still far", () => {
    const step = computeRoverApproachStep({
      plan: createApproachPlan(),
      distanceToTargetM: 1.2,
      yawErrorRad: ROVER_APPROACH_CONFIG.yawToleranceRad * 0.5,
      dtSec: DT_SEC,
    });
    expect(step.phase).toBe("translate");
    expect(step.linearTravelM).toBeGreaterThan(0);
    expect(step.angularTravelRad).not.toBe(0);
  });

  it("blends translation and steering when yaw is moderately misaligned", () => {
    const step = computeRoverApproachStep({
      plan: createApproachPlan(),
      distanceToTargetM: 1.2,
      yawErrorRad: YAW_MODERATE_RAD,
      dtSec: DT_SEC,
    });
    expect(step.phase).toBe("translate");
    expect(step.linearTravelM).toBeGreaterThan(0);
    expect(Math.abs(step.angularTravelRad)).toBeGreaterThan(0);
  });

  it("rotates in place instead of arcing when translation yaw assist is disabled", () => {
    const step = computeRoverApproachStep({
      plan: {
        ...createApproachPlan(),
        allowTranslationYawAssist: false,
      },
      distanceToTargetM: 1.2,
      yawErrorRad: YAW_MODERATE_RAD,
      dtSec: DT_SEC,
    });

    expect(step.phase).toBe("rotate");
    expect(step.linearTravelM).toBe(0);
    expect(Math.abs(step.angularTravelRad)).toBeGreaterThan(0);
  });

  it("reduces travel as remaining distance shrinks", () => {
    const yawAligned = ROVER_APPROACH_CONFIG.yawToleranceRad * 0.5;
    const farStep = computeRoverApproachStep({
      plan: createApproachPlan(),
      distanceToTargetM: 1.2,
      yawErrorRad: yawAligned,
      dtSec: DT_SEC,
    });
    const nearDistanceToTargetM = DESIRED_STOP_DISTANCE_M + ROVER_APPROACH_CONFIG.distanceToleranceM * 1.5;
    const nearStep = computeRoverApproachStep({
      plan: createApproachPlan(),
      distanceToTargetM: nearDistanceToTargetM,
      yawErrorRad: yawAligned,
      dtSec: DT_SEC,
    });
    const nearDistanceError = nearDistanceToTargetM - DESIRED_STOP_DISTANCE_M;
    expect(farStep.phase).toBe("translate");
    expect(nearStep.phase).toBe("translate");
    expect(nearStep.linearTravelM).toBeLessThan(farStep.linearTravelM);
    expect(nearStep.linearTravelM).toBeLessThanOrEqual(nearDistanceError);
  });

  it("completes when yaw and distance are within tolerance", () => {
    const step = computeRoverApproachStep({
      plan: createApproachPlan(),
      distanceToTargetM: DESIRED_STOP_DISTANCE_M + ROVER_APPROACH_CONFIG.distanceToleranceM * 0.5,
      yawErrorRad: ROVER_APPROACH_CONFIG.yawToleranceRad * 0.5,
      dtSec: DT_SEC,
    });
    expect(step.done).toBe(true);
    expect(step.phase).toBe("done");
  });

  it("falls back for non-finite distance, yaw, and tolerance inputs", () => {
    const step = computeRoverApproachStep({
      plan: {
        ...createApproachPlan(),
        distanceToleranceM: Number.NaN,
      },
      distanceToTargetM: Number.NaN,
      yawErrorRad: Number.POSITIVE_INFINITY,
      dtSec: DT_SEC,
    });

    expect(step.done).toBe(true);
    expect(step.phase).toBe("done");
    expect(step.linearTravelM).toBe(0);
    expect(step.angularTravelRad).toBe(0);
  });

  it("keeps translating on detour waypoint leg until close to waypoint center", () => {
    const step = computeRoverApproachStep({
      plan: {
        ...createApproachPlan(),
        desiredStopDistanceM: WAYPOINT_STOP_DISTANCE_M,
      },
      distanceToTargetM: WAYPOINT_DISTANCE_TO_TARGET_M,
      yawErrorRad: ROVER_APPROACH_CONFIG.yawToleranceRad * 0.5,
      dtSec: DT_SEC,
    });

    expect(step.done).toBe(false);
    expect(step.phase).toBe("translate");
    expect(step.linearTravelM).toBeGreaterThan(0);
  });

  it("reuses the direct-target stopping law for locked path segments once the segment angle is exact", () => {
    const lockedPathPlan = {
      ...createApproachPlan(),
      desiredStopDistanceM: WAYPOINT_STOP_DISTANCE_M,
      allowTranslationYawAssist: false,
    };
    const farStep = computeRoverApproachStep({
      plan: lockedPathPlan,
      distanceToTargetM: 1.2,
      yawErrorRad: 0,
      dtSec: DT_SEC,
    });
    const nearStep = computeRoverApproachStep({
      plan: lockedPathPlan,
      distanceToTargetM: 0.2,
      yawErrorRad: 0,
      dtSec: DT_SEC,
    });

    expect(farStep.phase).toBe("translate");
    expect(nearStep.phase).toBe("translate");
    expect(nearStep.linearTravelM).toBeLessThan(farStep.linearTravelM);
  });
});
