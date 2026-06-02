import { OPERATOR_TELEOP_MJLAB_MOTION_LIMITS } from "@/features/teleop/recording/operatorTeleopMotionSafetyParams";
import type { JointLimits } from "@/shared/lib/urdfBrowser";

export type IkMotionSafetyState = {
  lastTimestampMs: number | null;
  velocityByJoint: Map<string, number>;
};

export type IkMotionSafetyResult = {
  jointValues: Record<string, number>;
  limited: boolean;
  limitedJointNames: string[];
};

export const createIkMotionSafetyState = (): IkMotionSafetyState => ({
  lastTimestampMs: null,
  velocityByJoint: new Map<string, number>(),
});

export const resetIkMotionSafetyState = (state: IkMotionSafetyState) => {
  state.lastTimestampMs = null;
  state.velocityByJoint.clear();
};

export const resolveIkMotionSafetyVelocityLimit = (
  jointLimits: JointLimits | undefined,
  jointName: string
): number => {
  const limit = jointLimits?.[jointName]?.velocity;
  const mjlabLimit = OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.maxJointVelocityRadPerSec;
  const effectiveLimit = Number.isFinite(limit) && (limit as number) > 0
    ? Math.min(limit as number, mjlabLimit)
    : mjlabLimit;
  return effectiveLimit * OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.safetyScale;
};

export const resolveIkMotionSafetyAccelerationLimit = (): number =>
  OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.maxJointAccelerationRadPerSec2 *
  OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.safetyScale;

const resolveDtSec = (
  state: IkMotionSafetyState,
  timestampMs: number
): number | null => {
  const previousTimestampMs = state.lastTimestampMs;
  state.lastTimestampMs = timestampMs;
  if (previousTimestampMs === null) {
    return OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.defaultControlDtSec;
  }
  const dtSec =
    (timestampMs - previousTimestampMs) /
    OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.millisecondsPerSecond;
  if (!Number.isFinite(dtSec) || dtSec <= 0) {
    return null;
  }
  return Math.min(dtSec, OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.maxControlDtSec);
};

const holdCurrentFiniteJointTargets = (
  currentJointValues: Record<string, number>,
  targetJointValues: Record<string, number>
): IkMotionSafetyResult => {
  const nextJointValues: Record<string, number> = { ...targetJointValues };
  const limitedJointNames = new Set<string>();
  Object.entries(targetJointValues).forEach(([jointName, targetValue]) => {
    const currentValue = currentJointValues[jointName];
    if (!Number.isFinite(currentValue) || !Number.isFinite(targetValue)) {
      return;
    }
    if (Math.abs((targetValue as number) - (currentValue as number)) <= Number.EPSILON) {
      return;
    }
    nextJointValues[jointName] = currentValue as number;
    limitedJointNames.add(jointName);
  });
  return {
    jointValues: nextJointValues,
    limited: limitedJointNames.size > 0,
    limitedJointNames: Array.from(limitedJointNames),
  };
};

const clampNextJointValueTowardTarget = (
  currentValue: number,
  targetValue: number,
  nextValue: number
): number => {
  if (targetValue > currentValue) {
    return Math.min(targetValue, Math.max(currentValue, nextValue));
  }
  if (targetValue < currentValue) {
    return Math.max(targetValue, Math.min(currentValue, nextValue));
  }
  return currentValue;
};

export const limitIkJointTargetsToMotionSafety = ({
  currentJointValues,
  jointLimits,
  state,
  targetJointValues,
  timestampMs,
}: {
  currentJointValues: Record<string, number>;
  jointLimits: JointLimits | undefined;
  state: IkMotionSafetyState;
  targetJointValues: Record<string, number>;
  timestampMs: number;
}): IkMotionSafetyResult => {
  const dtSec = resolveDtSec(state, timestampMs);
  if (dtSec === null) {
    const held = holdCurrentFiniteJointTargets(currentJointValues, targetJointValues);
    held.limitedJointNames.forEach((jointName) => {
      state.velocityByJoint.set(jointName, 0);
    });
    return held;
  }

  const accelerationLimit = resolveIkMotionSafetyAccelerationLimit();
  const nextJointValues: Record<string, number> = { ...targetJointValues };
  const limitedJointNames = new Set<string>();

  Object.entries(targetJointValues).forEach(([jointName, targetValue]) => {
    const currentValue = currentJointValues[jointName];
    if (!Number.isFinite(currentValue) || !Number.isFinite(targetValue)) {
      return;
    }

    const targetDelta = (targetValue as number) - (currentValue as number);
    if (
      Math.abs(targetDelta) <=
      OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.stationaryJointDeltaRad
    ) {
      state.velocityByJoint.set(jointName, 0);
      return;
    }

    const requestedVelocity = targetDelta / dtSec;
    let minVelocity = Number.NEGATIVE_INFINITY;
    let maxVelocity = Number.POSITIVE_INFINITY;
    const velocityLimit = resolveIkMotionSafetyVelocityLimit(jointLimits, jointName);
    minVelocity = Math.max(minVelocity, -velocityLimit);
    maxVelocity = Math.min(maxVelocity, velocityLimit);

    const previousVelocity =
      state.velocityByJoint.get(jointName) ??
      OPERATOR_TELEOP_MJLAB_MOTION_LIMITS.initialJointVelocityRadPerSec;
    if (Number.isFinite(previousVelocity)) {
      const maxVelocityDelta = accelerationLimit * dtSec;
      minVelocity = Math.max(minVelocity, previousVelocity - maxVelocityDelta);
      maxVelocity = Math.min(maxVelocity, previousVelocity + maxVelocityDelta);
    }

    const clampedVelocity = Math.min(
      maxVelocity,
      Math.max(minVelocity, requestedVelocity)
    );
    const nextValue = clampNextJointValueTowardTarget(
      currentValue as number,
      targetValue as number,
      (currentValue as number) + clampedVelocity * dtSec
    );
    const appliedVelocity = (nextValue - (currentValue as number)) / dtSec;
    state.velocityByJoint.set(jointName, appliedVelocity);
    if (Math.abs(nextValue - (targetValue as number)) <= Number.EPSILON) {
      return;
    }
    nextJointValues[jointName] = nextValue;
    limitedJointNames.add(jointName);
  });

  return {
    jointValues: nextJointValues,
    limited: limitedJointNames.size > 0,
    limitedJointNames: Array.from(limitedJointNames),
  };
};
