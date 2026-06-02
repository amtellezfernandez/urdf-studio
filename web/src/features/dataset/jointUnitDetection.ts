import { JOINT_UNIT_DETECTION_PARAMS } from "@/features/dataset/jointUnitDetectionParams";

type JointRange = { min: number; max: number };

type JointRangeDegToRadResolution = {
  degToRad: boolean;
  autoConverted: boolean;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const shouldAutoConvertJointRangesDegToRad = (
  jointRanges: Record<string, JointRange>
) => {
  const maxAbsValues = Object.values(jointRanges)
    .map((range) => {
      if (!isFiniteNumber(range.min) || !isFiniteNumber(range.max)) {
        return Number.NaN;
      }
      return Math.max(Math.abs(range.min), Math.abs(range.max));
    })
    .filter((value) => Number.isFinite(value));

  if (maxAbsValues.length === 0) {
    return false;
  }

  const threshold = JOINT_UNIT_DETECTION_PARAMS.radiansLikelyAbsMax;
  if (
    maxAbsValues.length <
    JOINT_UNIT_DETECTION_PARAMS.minJointCountForFractionRule
  ) {
    return Math.max(...maxAbsValues) > threshold;
  }

  const countOverThreshold = maxAbsValues.filter(
    (value) => value > threshold
  ).length;
  const fractionOverThreshold = countOverThreshold / maxAbsValues.length;
  return (
    fractionOverThreshold >=
    JOINT_UNIT_DETECTION_PARAMS.minJointFractionOverThreshold
  );
};

export const resolveJointRangeDegToRadConversion = ({
  jointRanges,
  existingDegToRad,
}: {
  jointRanges: Record<string, JointRange>;
  existingDegToRad?: boolean;
}): JointRangeDegToRadResolution => {
  if (existingDegToRad === true) {
    return {
      degToRad: true,
      autoConverted: false,
    };
  }

  if (shouldAutoConvertJointRangesDegToRad(jointRanges)) {
    return {
      degToRad: true,
      autoConverted: true,
    };
  }

  return {
    degToRad: false,
    autoConverted: false,
  };
};
