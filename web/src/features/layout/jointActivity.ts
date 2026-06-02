type JointValuesByName = Record<string, number>;
type JointActivityUntilByName = Record<string, number>;

export type JointActivityState = {
  previousJointValues: JointValuesByName;
  activeUntilByJointName: JointActivityUntilByName;
};

type AdvanceJointActivityStateArgs = {
  state: JointActivityState;
  trackedJointNames: readonly string[];
  currentJointValues: JointValuesByName;
  nowMs: number;
  changeEpsilonRad: number;
  visibleHoldMs: number;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const createInitialJointActivityState = (): JointActivityState => ({
  previousJointValues: {},
  activeUntilByJointName: {},
});

export const advanceJointActivityState = ({
  state,
  trackedJointNames,
  currentJointValues,
  nowMs,
  changeEpsilonRad,
  visibleHoldMs,
}: AdvanceJointActivityStateArgs): JointActivityState => {
  const trackedJointNameSet = new Set(trackedJointNames);
  const nextPreviousValues: JointValuesByName = { ...state.previousJointValues };
  const nextActiveUntilByJointName: JointActivityUntilByName = {};

  Object.entries(state.activeUntilByJointName).forEach(([jointName, visibleUntilMs]) => {
    if (!trackedJointNameSet.has(jointName)) {
      return;
    }
    if (isFiniteNumber(visibleUntilMs) && visibleUntilMs > nowMs) {
      nextActiveUntilByJointName[jointName] = visibleUntilMs;
    }
  });

  trackedJointNames.forEach((jointName) => {
    const currentValue = currentJointValues[jointName];
    if (!isFiniteNumber(currentValue)) {
      return;
    }
    const previousValue = state.previousJointValues[jointName];
    if (
      isFiniteNumber(previousValue) &&
      Math.abs(currentValue - previousValue) > changeEpsilonRad
    ) {
      nextActiveUntilByJointName[jointName] = nowMs + visibleHoldMs;
    }
    nextPreviousValues[jointName] = currentValue;
  });

  return {
    previousJointValues: nextPreviousValues,
    activeUntilByJointName: nextActiveUntilByJointName,
  };
};

export const resolveActiveJointNameSet = (
  activeUntilByJointName: JointActivityUntilByName,
  nowMs: number
): Set<string> => {
  const next = new Set<string>();
  Object.entries(activeUntilByJointName).forEach(([jointName, visibleUntilMs]) => {
    if (isFiniteNumber(visibleUntilMs) && visibleUntilMs > nowMs) {
      next.add(jointName);
    }
  });
  return next;
};
