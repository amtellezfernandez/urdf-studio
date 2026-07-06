import { isFiniteNumber } from "@/shared/lib/numeric";

type JointValues = Record<string, number>;

const mapJointDataZeroOffset = ({
  jointValues,
  dataZeroJointValues,
  direction,
}: {
  jointValues: Readonly<JointValues>;
  dataZeroJointValues: Readonly<JointValues>;
  direction: 1 | -1;
}): JointValues =>
  Object.fromEntries(
    Object.entries(jointValues).map(([jointName, value]) => {
      const dataZeroValue = dataZeroJointValues[jointName];
      if (!isFiniteNumber(value) || !isFiniteNumber(dataZeroValue)) {
        return [jointName, value];
      }
      return [jointName, value + direction * dataZeroValue];
    }),
  );

const hasJointDataZeroValues = (
  dataZeroJointValues: Readonly<JointValues>,
): boolean =>
  Object.values(dataZeroJointValues).some(isFiniteNumber);

const offsetJointDataZeroValues = ({
  jointValues,
  dataZeroJointValues,
  direction,
}: {
  jointValues: Readonly<JointValues>;
  dataZeroJointValues: Readonly<JointValues>;
  direction: 1 | -1;
}): JointValues => {
  if (!hasJointDataZeroValues(dataZeroJointValues)) {
    return { ...jointValues };
  }
  return mapJointDataZeroOffset({
    jointValues,
    dataZeroJointValues,
    direction,
  });
};

export const applyJointDataZeroOffset = ({
  jointValues,
  dataZeroJointValues,
}: {
  jointValues: Readonly<JointValues>;
  dataZeroJointValues: Readonly<JointValues>;
}): JointValues =>
  offsetJointDataZeroValues({
    jointValues,
    dataZeroJointValues,
    direction: 1,
  });

export const removeJointDataZeroOffset = ({
  jointValues,
  dataZeroJointValues,
}: {
  jointValues: Readonly<JointValues>;
  dataZeroJointValues: Readonly<JointValues>;
}): JointValues =>
  offsetJointDataZeroValues({
    jointValues,
    dataZeroJointValues,
    direction: -1,
  });

export const resolveJointDataZeroReference = ({
  dataZeroJointValues,
  fallbackJointValues,
}: {
  dataZeroJointValues: Readonly<JointValues>;
  fallbackJointValues: Readonly<JointValues>;
}): JointValues =>
  hasJointDataZeroValues(dataZeroJointValues)
    ? { ...dataZeroJointValues }
    : { ...fallbackJointValues };
