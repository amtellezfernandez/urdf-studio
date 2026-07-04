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
  dynamicLimitField: {
    gridClassName: "grid min-w-0 grid-cols-2 gap-1",
    inputClassName: "w-11 min-w-0",
    labelClassName: "text-[8px] font-medium leading-none text-muted-foreground",
    unitClassName: "shrink-0 text-[8px] leading-none text-muted-foreground",
    clearButtonClassName:
      "h-5 w-5 shrink-0 p-0 text-muted-foreground/75 hover:bg-muted/20 hover:text-foreground",
  },
  valueInput: {
    radStep: 0.01,
    degStep: 1,
  },
} as const;
