import type { JointLimits } from "@/shared/lib/urdfBrowser";

const IK_MOTION_SAFETY_LIMITS = {
  maxJointVelocityRadPerSec: 12,
  maxJointAccelerationRadPerSec2: 120,
  safetyScale: 0.99,
  millisecondsPerSecond: 1_000,
  defaultControlDtSec: 1 / 60,
  maxControlDtSec: 1 / 30,
  initialJointVelocityRadPerSec: 0,
  stationaryJointDeltaRad: 1e-9,
} as const;

export type IkMotionSafetyState = {
  lastTimestampMs: number | null;
  velocityByJoint: Map<string, number>;
};

export type IkMotionSafetyResult = {
  jointValues: Record<string, number>;
  limited: boolean;
  limitedJointNames: string[];
};

type FiniteJointTargetPair = {
  currentValue: number;
  targetValue: number;
};

type IkMotionSafetyDraft = {
  nextJointValues: Record<string, number>;
  limitedJointNames: Set<string>;
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
  const mjlabLimit = IK_MOTION_SAFETY_LIMITS.maxJointVelocityRadPerSec;
  const effectiveLimit = Number.isFinite(limit) && (limit as number) > 0
    ? Math.min(limit as number, mjlabLimit)
    : mjlabLimit;
  return effectiveLimit * IK_MOTION_SAFETY_LIMITS.safetyScale;
};

export const resolveIkMotionSafetyAccelerationLimit = (): number =>
  IK_MOTION_SAFETY_LIMITS.maxJointAccelerationRadPerSec2 *
  IK_MOTION_SAFETY_LIMITS.safetyScale;

const resolveDtSec = (
  state: IkMotionSafetyState,
  timestampMs: number
): number | null => {
  const previousTimestampMs = state.lastTimestampMs;
  state.lastTimestampMs = timestampMs;
  if (previousTimestampMs === null) {
    return IK_MOTION_SAFETY_LIMITS.defaultControlDtSec;
  }
  const dtSec =
    (timestampMs - previousTimestampMs) /
    IK_MOTION_SAFETY_LIMITS.millisecondsPerSecond;
  if (!Number.isFinite(dtSec) || dtSec <= 0) {
    return null;
  }
  return Math.min(dtSec, IK_MOTION_SAFETY_LIMITS.maxControlDtSec);
};

const readFiniteJointTargetPair = (
  currentJointValues: Record<string, number>,
  jointName: string,
  targetValue: number
): FiniteJointTargetPair | null => {
  const currentValue = currentJointValues[jointName];
  if (!Number.isFinite(currentValue) || !Number.isFinite(targetValue)) {
    return null;
  }
  return {
    currentValue: currentValue as number,
    targetValue,
  };
};

const toIkMotionSafetyResult = (
  jointValues: Record<string, number>,
  limitedJointNames: Set<string>
): IkMotionSafetyResult => ({
  jointValues,
  limited: limitedJointNames.size > 0,
  limitedJointNames: Array.from(limitedJointNames),
});

const createIkMotionSafetyDraft = (
  targetJointValues: Record<string, number>
): IkMotionSafetyDraft => ({
  nextJointValues: { ...targetJointValues },
  limitedJointNames: new Set<string>(),
});

const forEachFiniteJointTarget = (
  currentJointValues: Record<string, number>,
  targetJointValues: Record<string, number>,
  visitor: (jointName: string, pair: FiniteJointTargetPair) => void
) => {
  Object.entries(targetJointValues).forEach(([jointName, targetValue]) => {
    const pair = readFiniteJointTargetPair(currentJointValues, jointName, targetValue);
    if (!pair) return;
    visitor(jointName, pair);
  });
};

const holdCurrentFiniteJointTargets = (
  currentJointValues: Record<string, number>,
  targetJointValues: Record<string, number>
): IkMotionSafetyResult => {
  const draft = createIkMotionSafetyDraft(targetJointValues);
  forEachFiniteJointTarget(currentJointValues, targetJointValues, (jointName, pair) => {
    if (Math.abs(pair.targetValue - pair.currentValue) <= Number.EPSILON) {
      return;
    }
    draft.nextJointValues[jointName] = pair.currentValue;
    draft.limitedJointNames.add(jointName);
  });
  return toIkMotionSafetyResult(draft.nextJointValues, draft.limitedJointNames);
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
  const draft = createIkMotionSafetyDraft(targetJointValues);

  forEachFiniteJointTarget(currentJointValues, targetJointValues, (jointName, pair) => {
    const targetDelta = pair.targetValue - pair.currentValue;
    if (
      Math.abs(targetDelta) <=
      IK_MOTION_SAFETY_LIMITS.stationaryJointDeltaRad
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
      IK_MOTION_SAFETY_LIMITS.initialJointVelocityRadPerSec;
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
      pair.currentValue,
      pair.targetValue,
      pair.currentValue + clampedVelocity * dtSec
    );
    const appliedVelocity = (nextValue - pair.currentValue) / dtSec;
    state.velocityByJoint.set(jointName, appliedVelocity);
    if (Math.abs(nextValue - pair.targetValue) <= Number.EPSILON) {
      return;
    }
    draft.nextJointValues[jointName] = nextValue;
    draft.limitedJointNames.add(jointName);
  });

  return toIkMotionSafetyResult(draft.nextJointValues, draft.limitedJointNames);
};
