export const OPERATOR_TELEOP_MJLAB_MOTION_LIMITS = {
  maxJointVelocityRadPerSec: 12,
  maxJointAccelerationRadPerSec2: 120,
  maxTimestampGapMs: 250,
  minTrajectorySampleCount: 2,
  safetyScale: 0.99,
  millisecondsPerSecond: 1_000,
  defaultControlDtSec: 1 / 60,
  maxControlDtSec: 1 / 30,
  initialJointVelocityRadPerSec: 0,
  stationaryJointDeltaRad: 1e-9,
} as const;
