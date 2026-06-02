import { describe, expect, it } from "vitest";
import { ROVER_APPROACH_CONFIG } from "./approachParams";
import {
  advanceRoverApproachSpeeds,
  advanceRoverApproachPhase,
  clampRoverApproachDtSec,
  moveRoverApproachValueToward,
  resolveAppliedRoverApproachMotion,
  resolveRoverApproachDesiredSpeeds,
  resolveRoverApproachFrame,
  resolveInitialRoverApproachPhase,
  resolveRoverApproachCommandYawErrorRad,
} from "./approachRuntime";
import type { RoverApproachPlan } from "./approachTypes";

const YAW_ABOVE_INITIAL_ROTATE = ROVER_APPROACH_CONFIG.initialRotateThresholdRad * 1.2;
const YAW_BELOW_INITIAL_ROTATE = ROVER_APPROACH_CONFIG.initialRotateThresholdRad * 0.8;
const YAW_BELOW_PHASE_EXIT = ROVER_APPROACH_CONFIG.yawPhaseRotateExitRad * 0.8;
const YAW_ABOVE_PHASE_ENTER = ROVER_APPROACH_CONFIG.yawPhaseRotateEnterRad * 1.2;
const YAW_BETWEEN_PHASE_THRESHOLDS =
  (ROVER_APPROACH_CONFIG.yawPhaseRotateEnterRad + ROVER_APPROACH_CONFIG.yawPhaseRotateExitRad) *
  0.5;
const YAW_ABOVE_ROTATE_IN_PLACE = ROVER_APPROACH_CONFIG.yawRotateInPlaceThresholdRad * 1.2;
const NEGATIVE_SAMPLE_YAW = -0.8;
const START_SPEED = 0.2;
const TARGET_SPEED = 1.2;
const MAX_DELTA = 0.15;
const NON_FINITE_SPEED = Number.POSITIVE_INFINITY;
const NON_FINITE_YAW = Number.NaN;
const LARGE_FINITE_YAW = Number.POSITIVE_INFINITY;
const DEFAULT_DISTANCE_TO_TARGET_M = 1.4;
const DEFAULT_DT_SEC = 1 / 60;
const DRIVE_LINEAR_SCALE = 0.8;
const DRIVE_ANGULAR_SCALE = 0.6;
const CURRENT_LINEAR_SPEED_MPS = 0.3;
const CURRENT_ANGULAR_SPEED_RADPS = 0.2;

const createApproachPlan = (overrides: Partial<RoverApproachPlan> = {}): RoverApproachPlan => ({
  mode: "approach",
  reason: "outside-reach",
  desiredStopDistanceM: 0,
  distanceToleranceM: ROVER_APPROACH_CONFIG.distanceToleranceM,
  allowTranslationYawAssist: true,
  requiresRotation: true,
  requiresTranslation: true,
  distanceToTargetM: DEFAULT_DISTANCE_TO_TARGET_M,
  forwardDotTarget: 1,
  ...overrides,
});

describe("resolveInitialRoverApproachPhase", () => {
  it("starts in rotate when yaw exceeds initial rotate threshold", () => {
    expect(resolveInitialRoverApproachPhase(YAW_ABOVE_INITIAL_ROTATE)).toBe("rotate");
  });

  it("starts in translate when yaw remains below initial rotate threshold", () => {
    expect(resolveInitialRoverApproachPhase(YAW_BELOW_INITIAL_ROTATE)).toBe("translate");
  });

  it("keeps legacy behavior for non-finite initial yaw", () => {
    expect(resolveInitialRoverApproachPhase(NON_FINITE_YAW)).toBe("translate");
    expect(resolveInitialRoverApproachPhase(LARGE_FINITE_YAW)).toBe("rotate");
  });
});

describe("clampRoverApproachDtSec", () => {
  it("clamps dt below minimum", () => {
    expect(clampRoverApproachDtSec(0)).toBe(ROVER_APPROACH_CONFIG.minDtSec);
  });

  it("clamps dt above maximum", () => {
    expect(clampRoverApproachDtSec(1)).toBe(ROVER_APPROACH_CONFIG.maxDtSec);
  });
});

describe("advanceRoverApproachPhase", () => {
  it("transitions from rotate to translate once yaw is below rotate-exit threshold", () => {
    expect(
      advanceRoverApproachPhase({
        phase: "rotate",
        yawErrorRad: YAW_BELOW_PHASE_EXIT,
      })
    ).toBe("translate");
  });

  it("re-enters rotate when yaw exceeds rotate-enter threshold while translating", () => {
    expect(
      advanceRoverApproachPhase({
        phase: "translate",
        yawErrorRad: YAW_ABOVE_PHASE_ENTER,
      })
    ).toBe("rotate");
  });

  it("stays in translate for moderate yaw between phase thresholds", () => {
    expect(
      advanceRoverApproachPhase({
        phase: "translate",
        yawErrorRad: YAW_BETWEEN_PHASE_THRESHOLDS,
      })
    ).toBe("translate");
  });

  it("finalizes rotate phase when step is no longer rotate", () => {
    expect(
      advanceRoverApproachPhase({
        phase: "rotate",
        yawErrorRad: YAW_ABOVE_PHASE_ENTER,
        stepPhase: "translate",
      })
    ).toBe("translate");
  });

  it("keeps current phase when yaw error is non-finite", () => {
    expect(
      advanceRoverApproachPhase({
        phase: "rotate",
        yawErrorRad: NON_FINITE_YAW,
      })
    ).toBe("rotate");
    expect(
      advanceRoverApproachPhase({
        phase: "translate",
        yawErrorRad: NON_FINITE_YAW,
      })
    ).toBe("translate");
  });
});

describe("resolveRoverApproachCommandYawErrorRad", () => {
  it("scales yaw command while translating", () => {
    expect(resolveRoverApproachCommandYawErrorRad("translate", NEGATIVE_SAMPLE_YAW)).toBeCloseTo(
      NEGATIVE_SAMPLE_YAW * ROVER_APPROACH_CONFIG.yawTranslateCommandScale
    );
  });

  it("preserves yaw command while rotating", () => {
    expect(resolveRoverApproachCommandYawErrorRad("rotate", NEGATIVE_SAMPLE_YAW)).toBe(
      NEGATIVE_SAMPLE_YAW
    );
  });
});

describe("moveRoverApproachValueToward", () => {
  it("moves toward target using bounded delta", () => {
    expect(moveRoverApproachValueToward(START_SPEED, TARGET_SPEED, MAX_DELTA)).toBeCloseTo(
      START_SPEED + MAX_DELTA
    );
  });

  it("snaps to target when max delta is non-positive", () => {
    expect(moveRoverApproachValueToward(START_SPEED, TARGET_SPEED, 0)).toBe(TARGET_SPEED);
  });

  it("returns zero when current or target speed is non-finite", () => {
    expect(moveRoverApproachValueToward(NON_FINITE_SPEED, TARGET_SPEED, MAX_DELTA)).toBe(0);
  });
});

describe("resolveRoverApproachFrame", () => {
  it("returns rotate phase/step when yaw exceeds rotate-in-place threshold", () => {
    const result = resolveRoverApproachFrame({
      phase: "rotate",
      yawErrorRad: YAW_ABOVE_ROTATE_IN_PLACE,
      distanceToTargetM: DEFAULT_DISTANCE_TO_TARGET_M,
      dtSec: DEFAULT_DT_SEC,
      plan: createApproachPlan(),
    });
    expect(result.phase).toBe("rotate");
    expect(result.step.phase).toBe("rotate");
  });

  it("transitions to translate once yaw is aligned", () => {
    const result = resolveRoverApproachFrame({
      phase: "rotate",
      yawErrorRad: YAW_BELOW_PHASE_EXIT,
      distanceToTargetM: DEFAULT_DISTANCE_TO_TARGET_M,
      dtSec: DEFAULT_DT_SEC,
      plan: createApproachPlan(),
    });
    expect(result.phase).toBe("translate");
    expect(result.commandYawErrorRad).toBeCloseTo(
      YAW_BELOW_PHASE_EXIT * ROVER_APPROACH_CONFIG.yawTranslateCommandScale
    );
  });

  it("allows translation immediately after a frame fully consumes the locked corner turn", () => {
    const completedTurnMotion = resolveAppliedRoverApproachMotion({
      speedState: {
        linearSpeedMps: 0,
        angularSpeedRadps: 1.2,
      },
      dtSec: DEFAULT_DT_SEC,
      remainingDistanceM: 0,
      remainingYawErrorRad: 0.005,
      phase: "rotate",
      enforceExactTurnStop: true,
    });

    expect(completedTurnMotion.completedExactTurn).toBe(true);

    const nextFrame = resolveRoverApproachFrame({
      phase: "translate",
      yawErrorRad: YAW_BETWEEN_PHASE_THRESHOLDS,
      distanceToTargetM: DEFAULT_DISTANCE_TO_TARGET_M,
      dtSec: DEFAULT_DT_SEC,
      plan: createApproachPlan({
        allowTranslationYawAssist: false,
      }),
    });

    expect(nextFrame.phase).toBe("translate");
    expect(nextFrame.commandYawErrorRad).toBe(0);
    expect(nextFrame.step.phase).toBe("translate");
  });

  it("uses explicit point-to-point rotate then straight logic for locked path segments", () => {
    const rotateResult = resolveRoverApproachFrame({
      phase: "rotate",
      yawErrorRad: YAW_BETWEEN_PHASE_THRESHOLDS,
      distanceToTargetM: DEFAULT_DISTANCE_TO_TARGET_M,
      dtSec: DEFAULT_DT_SEC,
      plan: createApproachPlan({
        allowTranslationYawAssist: false,
      }),
    });
    expect(rotateResult.phase).toBe("rotate");
    expect(rotateResult.commandYawErrorRad).toBe(YAW_BETWEEN_PHASE_THRESHOLDS);
    expect(rotateResult.step.phase).toBe("rotate");
    expect(rotateResult.step.linearTravelM).toBe(0);

    const exactTurnResult = resolveRoverApproachFrame({
      phase: "rotate",
      yawErrorRad: 0,
      distanceToTargetM: DEFAULT_DISTANCE_TO_TARGET_M,
      dtSec: DEFAULT_DT_SEC,
      plan: createApproachPlan({
        allowTranslationYawAssist: false,
      }),
    });
    expect(exactTurnResult.phase).toBe("translate");
    expect(exactTurnResult.commandYawErrorRad).toBe(0);
    expect(exactTurnResult.step.phase).toBe("translate");
    expect(exactTurnResult.step.angularTravelRad).toBe(0);

    const midSegmentTranslateResult = resolveRoverApproachFrame({
      phase: "translate",
      yawErrorRad: YAW_BETWEEN_PHASE_THRESHOLDS,
      distanceToTargetM: DEFAULT_DISTANCE_TO_TARGET_M,
      dtSec: DEFAULT_DT_SEC,
      plan: createApproachPlan({
        allowTranslationYawAssist: false,
      }),
    });
    expect(midSegmentTranslateResult.phase).toBe("translate");
    expect(midSegmentTranslateResult.commandYawErrorRad).toBe(0);
    expect(midSegmentTranslateResult.step.phase).toBe("translate");
    expect(midSegmentTranslateResult.step.angularTravelRad).toBe(0);
  });
});

describe("resolveRoverApproachDesiredSpeeds", () => {
  it("converts travel to desired speed using drive scales", () => {
    const speeds = resolveRoverApproachDesiredSpeeds({
      step: {
        phase: "translate",
        linearTravelM: 0.12,
        angularTravelRad: 0.06,
        done: false,
      },
      driveLinearScale: DRIVE_LINEAR_SCALE,
      driveAngularScale: DRIVE_ANGULAR_SCALE,
      dtSec: DEFAULT_DT_SEC,
    });
    expect(speeds.linearSpeedMps).toBeCloseTo((0.12 * DRIVE_LINEAR_SCALE) / DEFAULT_DT_SEC);
    expect(speeds.angularSpeedRadps).toBeCloseTo((0.06 * DRIVE_ANGULAR_SCALE) / DEFAULT_DT_SEC);
  });
});

describe("resolveAppliedRoverApproachMotion", () => {
  it("clamps applied straight-line travel to the remaining locked segment distance", () => {
    const motion = resolveAppliedRoverApproachMotion({
      speedState: {
        linearSpeedMps: 0.84,
        angularSpeedRadps: 0,
      },
      dtSec: DEFAULT_DT_SEC,
      remainingDistanceM: 0.01,
      remainingYawErrorRad: 0,
      phase: "translate",
    });

    expect(motion.linearTravelM).toBeCloseTo(0.01);
    expect(motion.speedState.linearSpeedMps).toBeCloseTo(0.01 / DEFAULT_DT_SEC);
    expect(motion.angularTravelRad).toBe(0);
    expect(motion.completedExactTurn).toBe(false);
  });

  it("clamps locked corner turns to the exact remaining angle", () => {
    const motion = resolveAppliedRoverApproachMotion({
      speedState: {
        linearSpeedMps: 0,
        angularSpeedRadps: -1.2,
      },
      dtSec: DEFAULT_DT_SEC,
      remainingDistanceM: 0,
      remainingYawErrorRad: -0.01,
      phase: "rotate",
      enforceExactTurnStop: true,
    });

    expect(motion.linearTravelM).toBe(0);
    expect(motion.angularTravelRad).toBeCloseTo(-0.01);
    expect(motion.speedState.angularSpeedRadps).toBeCloseTo(-0.01 / DEFAULT_DT_SEC);
    expect(motion.completedExactTurn).toBe(true);
  });
});

describe("advanceRoverApproachSpeeds", () => {
  const current = {
    linearSpeedMps: CURRENT_LINEAR_SPEED_MPS,
    angularSpeedRadps: CURRENT_ANGULAR_SPEED_RADPS,
  };

  it("zeros speeds when step is done", () => {
    const speeds = advanceRoverApproachSpeeds({
      current,
      desired: {
        linearSpeedMps: TARGET_SPEED,
        angularSpeedRadps: TARGET_SPEED,
      },
      dtSec: DEFAULT_DT_SEC,
      done: true,
    });
    expect(speeds.linearSpeedMps).toBe(0);
    expect(speeds.angularSpeedRadps).toBe(0);
  });

  it("moves toward desired speeds with acceleration limits", () => {
    const speeds = advanceRoverApproachSpeeds({
      current,
      desired: {
        linearSpeedMps: TARGET_SPEED,
        angularSpeedRadps: TARGET_SPEED,
      },
      dtSec: DEFAULT_DT_SEC,
      done: false,
    });
    expect(speeds.linearSpeedMps).toBeGreaterThan(current.linearSpeedMps);
    expect(speeds.linearSpeedMps).toBeLessThan(TARGET_SPEED);
    expect(speeds.angularSpeedRadps).toBeGreaterThan(current.angularSpeedRadps);
    expect(speeds.angularSpeedRadps).toBeLessThan(TARGET_SPEED);
  });

  it("does not blend turn and translation when locked path tracking enforces axis lock", () => {
    const translateSpeeds = advanceRoverApproachSpeeds({
      current,
      desired: {
        linearSpeedMps: TARGET_SPEED,
        angularSpeedRadps: TARGET_SPEED,
      },
      dtSec: DEFAULT_DT_SEC,
      done: false,
      phase: "translate",
      enforcePhaseAxisLock: true,
    });
    expect(translateSpeeds.linearSpeedMps).toBeGreaterThan(current.linearSpeedMps);
    expect(translateSpeeds.linearSpeedMps).toBeLessThan(TARGET_SPEED);
    expect(translateSpeeds.angularSpeedRadps).toBe(0);

    const rotateSpeeds = advanceRoverApproachSpeeds({
      current,
      desired: {
        linearSpeedMps: TARGET_SPEED,
        angularSpeedRadps: TARGET_SPEED,
      },
      dtSec: DEFAULT_DT_SEC,
      done: false,
      phase: "rotate",
      enforcePhaseAxisLock: true,
    });
    expect(rotateSpeeds.linearSpeedMps).toBe(0);
    expect(rotateSpeeds.angularSpeedRadps).toBeGreaterThan(0);
  });
});
