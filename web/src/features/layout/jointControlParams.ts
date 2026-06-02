export const JOINT_CONTROL_PARAMS = {
  defaultJointType: "continuous",
  velocity: {
    radStep: 0.05,
    degStep: 0.5,
    minRadPerSec: 0.01,
    radPrecision: 1000,
    degPrecision: 100,
  },
  effort: {
    step: 1,
    min: 0,
    precision: 1000,
  },
  valueInput: {
    radStep: 0.01,
    degStep: 1,
  },
} as const;
