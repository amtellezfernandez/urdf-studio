export const createIkDragAllowedJointNameSet = (
  allowedJointNames?: readonly string[] | null
): Set<string> =>
  new Set(
    (allowedJointNames ?? [])
      .map((jointName) => jointName.trim())
      .filter(Boolean)
  );

const isLikelyNonArmJointName = (jointName: string): boolean =>
  /(wheel|caster|drive|tire)/i.test(jointName);

export const filterIkDragJointValuesToActiveArmChain = ({
  jointValues,
  allowedJointNames,
  chainJointNames,
}: {
  jointValues: Record<string, number>;
  allowedJointNames: ReadonlySet<string>;
  chainJointNames: ReadonlySet<string> | null | undefined;
}): Record<string, number> => {
  if (allowedJointNames.size > 0) {
    const strictFiltered: Record<string, number> = {};
    allowedJointNames.forEach((jointName) => {
      const value = jointValues[jointName];
      if (typeof value === "number" && Number.isFinite(value)) {
        strictFiltered[jointName] = value;
      }
    });
    if (Object.keys(strictFiltered).length > 0) {
      return strictFiltered;
    }
  }

  const filtered: Record<string, number> = {};

  if (chainJointNames && chainJointNames.size > 0) {
    chainJointNames.forEach((jointName) => {
      const value = jointValues[jointName];
      if (typeof value === "number" && Number.isFinite(value)) {
        filtered[jointName] = value;
      }
    });
    if (Object.keys(filtered).length > 0) {
      return filtered;
    }
  }

  Object.entries(jointValues).forEach(([jointName, value]) => {
    if (!Number.isFinite(value)) return;
    if (isLikelyNonArmJointName(jointName)) return;
    filtered[jointName] = value;
  });

  return Object.keys(filtered).length > 0 ? filtered : jointValues;
};
