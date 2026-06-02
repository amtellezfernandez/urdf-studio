import { describe, expect, it } from "vitest";

import type { RecordedFrame } from "@/features/dataset";
import {
  applyMotionLimitsToRecordedFrames,
  computeMotionLimitStatusForFrames,
  computeTimestampGapStatusForFrames,
} from "@/features/layout/sidebar/sidebarHelpers";
import type { JointLimits } from "@/shared/lib/urdfBrowser";

const TEST_MOTION_LIMIT_FIXTURE = {
  jointName: "openarm_left_joint1",
  frameStartMs: 0,
  frameStepMs: 100,
  velocityLimitRadPerSec: 20,
  accelerationLimitRadPerSec2: 120,
  zeroTolerance: 0,
  firstPositionRad: 0,
  secondPositionRad: -0.1,
  accelerationSpikePositionRad: 1.08,
  accelerationLimitedPositionRad: 0.988,
  safeTimestampGapMs: 250,
  unsafeTimestampGapMs: 251,
  fractionalFrameStepMs: 32.8125,
  firstRoundedEdgeRad: -0.05,
  fractionalRoundedEdgeSpikeRad: 0.08042,
} as const;

const TEST_JOINT_LIMITS = {
  [TEST_MOTION_LIMIT_FIXTURE.jointName]: {
    type: "revolute",
    lower: -10,
    upper: 10,
    velocity: TEST_MOTION_LIMIT_FIXTURE.velocityLimitRadPerSec,
  },
} satisfies JointLimits;

const frame = (timestamp: number, position: number): RecordedFrame => ({
  timestamp,
  jointPositions: {
    [TEST_MOTION_LIMIT_FIXTURE.jointName]: position,
  },
});

const TEST_OPENARM_REJECTION_FIXTURE = {
  frameCount: 65,
  durationMs: 2_100,
  zeroTolerance: 0,
  joints: {
    openarm_left_joint1: {
      type: "revolute",
      lower: -3.490659,
      upper: 1.3962629999999998,
      velocity: 16.754666,
      firstStepRad: -0.5,
      spikeRad: 0.64,
    },
    openarm_left_joint2: {
      type: "revolute",
      lower: -3.3161253267948965,
      upper: 0.17453267320510335,
      velocity: 16.754666,
      firstStepRad: -0.5,
      spikeRad: 0.64,
    },
    openarm_left_joint4: {
      type: "revolute",
      lower: 0,
      upper: 2.443461,
      velocity: 5.445426,
      firstStepRad: 0.1,
      spikeRad: 0.8,
    },
    openarm_left_joint7: {
      type: "revolute",
      lower: -1.570796,
      upper: 1.570796,
      velocity: 20.943946,
      firstStepRad: -0.5,
      spikeRad: 0.64,
    },
  },
} as const;

const TEST_OPENARM_JOINT_LIMITS = Object.fromEntries(
  Object.entries(TEST_OPENARM_REJECTION_FIXTURE.joints).map(
    ([jointName, joint]) => [
      jointName,
      {
        type: joint.type,
        lower: joint.lower,
        upper: joint.upper,
        velocity: joint.velocity,
      },
    ]
  )
) satisfies JointLimits;

const buildUnsafeOpenArmFrames = (): RecordedFrame[] => {
  const frameStepMs =
    TEST_OPENARM_REJECTION_FIXTURE.durationMs /
    (TEST_OPENARM_REJECTION_FIXTURE.frameCount - 1);
  return Array.from(
    { length: TEST_OPENARM_REJECTION_FIXTURE.frameCount },
    (_, frameIndex): RecordedFrame => {
      const jointPositions = Object.fromEntries(
        Object.entries(TEST_OPENARM_REJECTION_FIXTURE.joints).map(
          ([jointName, joint]) => {
            const value =
              frameIndex === 0
                ? 0
                : frameIndex === 1
                  ? joint.firstStepRad
                  : joint.spikeRad;
            return [jointName, value];
          }
        )
      );
      return {
        timestamp: frameIndex * frameStepMs,
        jointPositions,
      };
    }
  );
};

describe("recording motion limits", () => {
  it("detects MJLab-style acceleration spikes even when velocity is legal", () => {
    const frames = [
      frame(
        TEST_MOTION_LIMIT_FIXTURE.frameStartMs,
        TEST_MOTION_LIMIT_FIXTURE.firstPositionRad
      ),
      frame(
        TEST_MOTION_LIMIT_FIXTURE.frameStepMs,
        TEST_MOTION_LIMIT_FIXTURE.secondPositionRad
      ),
      frame(
        TEST_MOTION_LIMIT_FIXTURE.frameStepMs * 2,
        TEST_MOTION_LIMIT_FIXTURE.accelerationSpikePositionRad
      ),
    ];

    const status = computeMotionLimitStatusForFrames(
      frames,
      TEST_JOINT_LIMITS,
      TEST_MOTION_LIMIT_FIXTURE.zeroTolerance,
      TEST_MOTION_LIMIT_FIXTURE.accelerationLimitRadPerSec2
    );

    expect(status.velocity.overCount).toBe(0);
    expect(status.acceleration.overCount).toBe(1);
    expect(status.worstKind).toBe("acceleration");
    expect(status.worstJoint).toBe(TEST_MOTION_LIMIT_FIXTURE.jointName);
  });

  it("clamps recorded frames to velocity and acceleration limits before MJLab submission", () => {
    const frames = [
      frame(
        TEST_MOTION_LIMIT_FIXTURE.frameStartMs,
        TEST_MOTION_LIMIT_FIXTURE.firstPositionRad
      ),
      frame(
        TEST_MOTION_LIMIT_FIXTURE.frameStepMs,
        TEST_MOTION_LIMIT_FIXTURE.secondPositionRad
      ),
      frame(
        TEST_MOTION_LIMIT_FIXTURE.frameStepMs * 2,
        TEST_MOTION_LIMIT_FIXTURE.accelerationSpikePositionRad
      ),
    ];

    const result = applyMotionLimitsToRecordedFrames(frames, TEST_JOINT_LIMITS, {
      maxJointAccelerationRadPerSec2:
        TEST_MOTION_LIMIT_FIXTURE.accelerationLimitRadPerSec2,
    });
    const status = computeMotionLimitStatusForFrames(
      result.frames,
      TEST_JOINT_LIMITS,
      TEST_MOTION_LIMIT_FIXTURE.zeroTolerance,
      TEST_MOTION_LIMIT_FIXTURE.accelerationLimitRadPerSec2
    );

    expect(result.accelerationClampedSteps).toBe(1);
    expect(
      result.frames[2]?.jointPositions[TEST_MOTION_LIMIT_FIXTURE.jointName] ??
        Number.NaN
    ).toBeCloseTo(TEST_MOTION_LIMIT_FIXTURE.accelerationLimitedPositionRad);
    expect(status.overCount).toBe(0);
  });

  it("flags timestamp gaps that MJLab would reject", () => {
    const frames = [
      frame(
        TEST_MOTION_LIMIT_FIXTURE.frameStartMs,
        TEST_MOTION_LIMIT_FIXTURE.firstPositionRad
      ),
      frame(
        TEST_MOTION_LIMIT_FIXTURE.unsafeTimestampGapMs,
        TEST_MOTION_LIMIT_FIXTURE.secondPositionRad
      ),
    ];

    const status = computeTimestampGapStatusForFrames(
      frames,
      TEST_MOTION_LIMIT_FIXTURE.safeTimestampGapMs
    );

    expect(status.overCount).toBe(1);
    expect(status.maxGapMs).toBe(TEST_MOTION_LIMIT_FIXTURE.unsafeTimestampGapMs);
  });

  it("turns the reported OpenArm IK acceleration spike into an MJLab-passable recording", () => {
    const rawFrames = buildUnsafeOpenArmFrames();
    const rawStatus = computeMotionLimitStatusForFrames(
      rawFrames,
      TEST_OPENARM_JOINT_LIMITS,
      TEST_OPENARM_REJECTION_FIXTURE.zeroTolerance
    );

    const result = applyMotionLimitsToRecordedFrames(
      rawFrames,
      TEST_OPENARM_JOINT_LIMITS
    );
    const safeStatus = computeMotionLimitStatusForFrames(
      result.frames,
      TEST_OPENARM_JOINT_LIMITS,
      TEST_OPENARM_REJECTION_FIXTURE.zeroTolerance
    );
    const timestampStatus = computeTimestampGapStatusForFrames(result.frames);

    expect(rawStatus.overCount).toBeGreaterThan(0);
    expect(result.frames).toHaveLength(TEST_OPENARM_REJECTION_FIXTURE.frameCount);
    expect(result.accelerationClampedSteps).toBeGreaterThan(0);
    expect(safeStatus.overCount).toBe(0);
    expect(timestampStatus.overCount).toBe(0);
  });

  it("uses MJLab-rounded timestamps so 120.25 rad/s^2 edge cases are clamped before save", () => {
    const frames = [
      frame(
        TEST_MOTION_LIMIT_FIXTURE.frameStartMs,
        TEST_MOTION_LIMIT_FIXTURE.firstPositionRad
      ),
      frame(
        TEST_MOTION_LIMIT_FIXTURE.fractionalFrameStepMs,
        TEST_MOTION_LIMIT_FIXTURE.firstRoundedEdgeRad
      ),
      frame(
        TEST_MOTION_LIMIT_FIXTURE.fractionalFrameStepMs * 2,
        TEST_MOTION_LIMIT_FIXTURE.fractionalRoundedEdgeSpikeRad
      ),
    ];

    const rawStatus = computeMotionLimitStatusForFrames(
      frames,
      TEST_JOINT_LIMITS,
      TEST_MOTION_LIMIT_FIXTURE.zeroTolerance,
      TEST_MOTION_LIMIT_FIXTURE.accelerationLimitRadPerSec2
    );
    const result = applyMotionLimitsToRecordedFrames(frames, TEST_JOINT_LIMITS, {
      maxJointAccelerationRadPerSec2:
        TEST_MOTION_LIMIT_FIXTURE.accelerationLimitRadPerSec2,
    });
    const safeStatus = computeMotionLimitStatusForFrames(
      result.frames,
      TEST_JOINT_LIMITS,
      TEST_MOTION_LIMIT_FIXTURE.zeroTolerance,
      TEST_MOTION_LIMIT_FIXTURE.accelerationLimitRadPerSec2
    );

    expect(rawStatus.acceleration.maxRatio).toBeGreaterThan(1);
    expect(result.frames.map((safeFrame) => safeFrame.timestamp)).toEqual([
      0,
      33,
      66,
    ]);
    expect(result.accelerationClampedSteps).toBeGreaterThan(0);
    expect(safeStatus.overCount).toBe(0);
  });
});
