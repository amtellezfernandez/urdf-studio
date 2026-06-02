import { describe, expect, it } from "vitest";
import { ROVER_APPROACH_CONFIG } from "./approachParams";
import {
  planRoverApproach,
  resolveRoverApproachStopDistance,
  shouldExecuteRoverApproachPlan,
} from "./approachPlanner";

const REACH_RADIUS_M = 1.1;
const CLOSER_REACH_RADIUS_M = 0.5;
const LONGER_REACH_RADIUS_M = 0.9;
const FRONT_DOT = 0.98;
const REAR_DOT = -0.5;
const CONTACT_OVERRIDE_DISTANCE_M = 0.09;

describe("planRoverApproach", () => {
  it("skips when wheel drive is disabled", () => {
    const plan = planRoverApproach({
      wheelDriveEnabled: false,
      hasWheelDriveModel: true,
      distanceToTargetM: 2,
      forwardDotTarget: FRONT_DOT,
      armReachRadiusM: REACH_RADIUS_M,
    });
    expect(plan.mode).toBe("skip");
    expect(plan.reason).toBe("wheel-disabled");
  });

  it("requests approach when target is outside arm reach comfort", () => {
    const plan = planRoverApproach({
      wheelDriveEnabled: true,
      hasWheelDriveModel: true,
      distanceToTargetM: REACH_RADIUS_M + ROVER_APPROACH_CONFIG.reachGapTriggerM + 0.05,
      forwardDotTarget: FRONT_DOT,
      armReachRadiusM: REACH_RADIUS_M,
    });
    expect(plan.mode).toBe("approach");
    expect(plan.reason).toBe("outside-reach");
    expect(plan.allowTranslationYawAssist).toBe(true);
  });

  it("requests approach for rear targets", () => {
    const plan = planRoverApproach({
      wheelDriveEnabled: true,
      hasWheelDriveModel: true,
      distanceToTargetM: 0.5,
      forwardDotTarget: REAR_DOT,
      armReachRadiusM: REACH_RADIUS_M,
    });
    expect(plan.mode).toBe("approach");
    expect(plan.reason).toBe("rear-target");
  });

  it("resolves stop distance from reach radius within configured bounds", () => {
    const stopDistance = resolveRoverApproachStopDistance(REACH_RADIUS_M);
    expect(stopDistance).toBeGreaterThanOrEqual(ROVER_APPROACH_CONFIG.minStopDistanceM);
    expect(stopDistance).toBeLessThanOrEqual(ROVER_APPROACH_CONFIG.maxStopDistanceM);
    expect(stopDistance).toBeLessThanOrEqual(
      REACH_RADIUS_M - ROVER_APPROACH_CONFIG.reachGapTriggerM
    );
  });

  it("uses configured fallback stop distance when reach radius is missing", () => {
    const stopDistance = resolveRoverApproachStopDistance(null);
    expect(stopDistance).toBe(ROVER_APPROACH_CONFIG.fallbackStopDistanceM);
  });

  it("keeps close-range stop distance near the tuned reach ratio", () => {
    const expectedStopDistanceM = Math.max(
      ROVER_APPROACH_CONFIG.minStopDistanceM,
      Math.min(
        Math.min(
          ROVER_APPROACH_CONFIG.maxStopDistanceM,
          CLOSER_REACH_RADIUS_M - ROVER_APPROACH_CONFIG.reachGapTriggerM
        ),
        CLOSER_REACH_RADIUS_M * ROVER_APPROACH_CONFIG.stopDistanceReachRatio +
          ROVER_APPROACH_CONFIG.stopDistanceStandOffM
      )
    );
    const stopDistance = resolveRoverApproachStopDistance(CLOSER_REACH_RADIUS_M);
    expect(stopDistance).toBeCloseTo(expectedStopDistanceM);
    expect(stopDistance).toBeLessThan(
      REACH_RADIUS_M * ROVER_APPROACH_CONFIG.stopDistanceReachRatio +
        ROVER_APPROACH_CONFIG.stopDistanceStandOffM
    );
  });

  it("adapts stop distance to the active EE reach radius", () => {
    const shortReachStopDistanceM = resolveRoverApproachStopDistance(CLOSER_REACH_RADIUS_M);
    const longerReachStopDistanceM = resolveRoverApproachStopDistance(LONGER_REACH_RADIUS_M);
    expect(longerReachStopDistanceM).toBeGreaterThan(shortReachStopDistanceM);
  });

  it("never sets stop distance beyond the reach-safe upper bound for tiny reaches", () => {
    const tinyReachRadiusM = ROVER_APPROACH_CONFIG.reachGapTriggerM * 0.5;
    expect(resolveRoverApproachStopDistance(tinyReachRadiusM)).toBe(0);
  });

  it("honors preferred stop distance and tolerance overrides for precision contact", () => {
    const plan = planRoverApproach({
      wheelDriveEnabled: true,
      hasWheelDriveModel: true,
      distanceToTargetM: CONTACT_OVERRIDE_DISTANCE_M,
      forwardDotTarget: FRONT_DOT,
      armReachRadiusM: REACH_RADIUS_M,
      preferredStopDistanceM: ROVER_APPROACH_CONFIG.objectContactSurfaceStandoffM,
      preferredDistanceToleranceM: ROVER_APPROACH_CONFIG.objectContactDistanceToleranceM,
    });

    expect(plan.mode).toBe("approach");
    expect(plan.desiredStopDistanceM).toBeLessThanOrEqual(
      ROVER_APPROACH_CONFIG.objectContactSurfaceStandoffM
    );
    expect(plan.distanceToleranceM).toBeLessThanOrEqual(
      ROVER_APPROACH_CONFIG.objectContactDistanceToleranceM
    );
  });

  it("still executes rover approach for orientation-only adjustments", () => {
    const plan = planRoverApproach({
      wheelDriveEnabled: true,
      hasWheelDriveModel: true,
      distanceToTargetM: 0.2,
      forwardDotTarget: 0,
      armReachRadiusM: REACH_RADIUS_M,
    });

    expect(plan.mode).toBe("approach");
    expect(plan.reason).toBe("orientation-adjust");
    expect(plan.requiresRotation).toBe(true);
    expect(plan.requiresTranslation).toBe(false);
    expect(shouldExecuteRoverApproachPlan(plan)).toBe(true);
  });

  it("executes rover approach when translation is still required for a front target", () => {
    const plan = planRoverApproach({
      wheelDriveEnabled: true,
      hasWheelDriveModel: true,
      distanceToTargetM: 0.5,
      forwardDotTarget: FRONT_DOT,
      armReachRadiusM: REACH_RADIUS_M,
    });

    expect(plan.mode).toBe("approach");
    expect(plan.reason).toBe("orientation-adjust");
    expect(plan.requiresTranslation).toBe(true);
    expect(shouldExecuteRoverApproachPlan(plan)).toBe(true);
  });

  it("still enters the rover stage for already-reachable front targets", () => {
    const plan = planRoverApproach({
      wheelDriveEnabled: true,
      hasWheelDriveModel: true,
      distanceToTargetM: 0.08,
      forwardDotTarget: 1,
      armReachRadiusM: REACH_RADIUS_M,
    });

    expect(plan.mode).toBe("approach");
    expect(plan.reason).toBe("within-reach");
    expect(plan.requiresRotation).toBe(false);
    expect(plan.requiresTranslation).toBe(false);
    expect(shouldExecuteRoverApproachPlan(plan)).toBe(true);
  });

  it("still executes rover approach for outside-reach and rear targets", () => {
    const outsideReachPlan = planRoverApproach({
      wheelDriveEnabled: true,
      hasWheelDriveModel: true,
      distanceToTargetM: REACH_RADIUS_M + ROVER_APPROACH_CONFIG.reachGapTriggerM + 0.05,
      forwardDotTarget: FRONT_DOT,
      armReachRadiusM: REACH_RADIUS_M,
    });
    const rearTargetPlan = planRoverApproach({
      wheelDriveEnabled: true,
      hasWheelDriveModel: true,
      distanceToTargetM: 0.5,
      forwardDotTarget: REAR_DOT,
      armReachRadiusM: REACH_RADIUS_M,
    });

    expect(shouldExecuteRoverApproachPlan(outsideReachPlan)).toBe(true);
    expect(shouldExecuteRoverApproachPlan(rearTargetPlan)).toBe(true);
  });
});
