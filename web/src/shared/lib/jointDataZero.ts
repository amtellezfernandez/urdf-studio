type JointValues = Record<string, number>;

const hasFiniteJointValue = (values: Readonly<JointValues>, jointName: string): boolean =>
  Number.isFinite(values[jointName]);

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
      if (!Number.isFinite(value) || !hasFiniteJointValue(dataZeroJointValues, jointName)) {
        return [jointName, value];
      }
      return [jointName, value + direction * (dataZeroJointValues[jointName] as number)];
    }),
  );

const hasJointDataZeroValues = (
  dataZeroJointValues: Readonly<JointValues>,
): boolean =>
  Object.values(dataZeroJointValues).some((value) => Number.isFinite(value));

export const applyJointDataZeroOffset = ({
  jointValues,
  dataZeroJointValues,
}: {
  jointValues: Readonly<JointValues>;
  dataZeroJointValues: Readonly<JointValues>;
}): JointValues => {
  if (!hasJointDataZeroValues(dataZeroJointValues)) {
    return { ...jointValues };
  }
  return mapJointDataZeroOffset({
    jointValues,
    dataZeroJointValues,
    direction: 1,
  });
};

export const removeJointDataZeroOffset = ({
  jointValues,
  dataZeroJointValues,
}: {
  jointValues: Readonly<JointValues>;
  dataZeroJointValues: Readonly<JointValues>;
}): JointValues => {
  if (!hasJointDataZeroValues(dataZeroJointValues)) {
    return { ...jointValues };
  }
  return mapJointDataZeroOffset({
    jointValues,
    dataZeroJointValues,
    direction: -1,
  });
};

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
