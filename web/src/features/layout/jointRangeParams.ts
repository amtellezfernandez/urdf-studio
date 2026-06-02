export const JOINT_RANGE_PARAMS = {
  defaultDisplayHalfRangeRad: Math.PI * 2,
  wheelDisplayHalfRangeRad: Math.PI * 4,
  singleSidedLimitDisplaySpanRad: Math.PI * 4,
  minDisplaySpanRad: 0.01,
} as const;

export const WHEEL_GROUP_LABEL_PATTERN = /^wheel\d*$/i;
export const WHEEL_JOINT_NAME_PATTERN = /(wheel|drive|caster|omni)/i;
