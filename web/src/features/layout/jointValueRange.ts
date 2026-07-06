import type { JointLimitInfo } from "@/shared/lib/urdfBrowser";
import {
  JOINT_RANGE_PARAMS,
  WHEEL_GROUP_LABEL_PATTERN,
  WHEEL_JOINT_NAME_PATTERN,
} from "@/features/layout/jointRangeParams";
import {
  isFiniteNumber,
  toFiniteNumberOrFallback,
  toFiniteNumberOrNull,
} from "@/shared/lib/numeric";

type ResolveJointValueRangeInput = {
  jointName: string;
  jointInfo?: JointLimitInfo;
  currentValue?: number;
  groupLabel?: string | null;
};

export type JointValueRange = {
  displayMin: number;
  displayMax: number;
  clampLower: number | null;
  clampUpper: number | null;
  hasFiniteHardLimits: boolean;
};

const ensureMinDisplaySpan = (min: number, max: number): { min: number; max: number } => {
  const span = max - min;
  if (isFiniteNumber(span) && span >= JOINT_RANGE_PARAMS.minDisplaySpanRad) {
    return { min, max };
  }
  const center = isFiniteNumber(min) && isFiniteNumber(max) ? (min + max) * 0.5 : 0;
  const halfSpan = JOINT_RANGE_PARAMS.minDisplaySpanRad * 0.5;
  return {
    min: center - halfSpan,
    max: center + halfSpan,
  };
};

const isWheelLikeJoint = (jointName: string, groupLabel?: string | null): boolean => {
  if (groupLabel && WHEEL_GROUP_LABEL_PATTERN.test(groupLabel)) {
    return true;
  }
  return WHEEL_JOINT_NAME_PATTERN.test(jointName);
};

export const resolveJointValueRange = ({
  jointName,
  jointInfo,
  currentValue = 0,
  groupLabel = null,
}: ResolveJointValueRangeInput): JointValueRange => {
  const type = jointInfo?.type ?? "continuous";
  if (type === "fixed") {
    return {
      displayMin: 0,
      displayMax: 0,
      clampLower: 0,
      clampUpper: 0,
      hasFiniteHardLimits: true,
    };
  }

  let lower = toFiniteNumberOrNull(jointInfo?.lower);
  let upper = toFiniteNumberOrNull(jointInfo?.upper);
  if (lower !== null && upper !== null && lower > upper) {
    const swappedLower = upper;
    upper = lower;
    lower = swappedLower;
  }

  const finiteCurrent = toFiniteNumberOrFallback(currentValue, 0);

  if (lower !== null && upper !== null) {
    const display = ensureMinDisplaySpan(lower, upper);
    return {
      displayMin: display.min,
      displayMax: display.max,
      clampLower: lower,
      clampUpper: upper,
      hasFiniteHardLimits: true,
    };
  }

  if (lower !== null) {
    const displayMax = Math.max(
      lower + JOINT_RANGE_PARAMS.singleSidedLimitDisplaySpanRad,
      finiteCurrent
    );
    const display = ensureMinDisplaySpan(lower, displayMax);
    return {
      displayMin: display.min,
      displayMax: display.max,
      clampLower: lower,
      clampUpper: null,
      hasFiniteHardLimits: false,
    };
  }

  if (upper !== null) {
    const displayMin = Math.min(
      upper - JOINT_RANGE_PARAMS.singleSidedLimitDisplaySpanRad,
      finiteCurrent
    );
    const display = ensureMinDisplaySpan(displayMin, upper);
    return {
      displayMin: display.min,
      displayMax: display.max,
      clampLower: null,
      clampUpper: upper,
      hasFiniteHardLimits: false,
    };
  }

  const halfRange = isWheelLikeJoint(jointName, groupLabel)
    ? JOINT_RANGE_PARAMS.wheelDisplayHalfRangeRad
    : JOINT_RANGE_PARAMS.defaultDisplayHalfRangeRad;
  const display = ensureMinDisplaySpan(finiteCurrent - halfRange, finiteCurrent + halfRange);
  return {
    displayMin: display.min,
    displayMax: display.max,
    clampLower: null,
    clampUpper: null,
    hasFiniteHardLimits: false,
  };
};
