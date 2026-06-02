export const getJointLimitsError = (
  lower?: number | null,
  upper?: number | null,
  jointName?: string
): string | null => {
  const hasLower = Number.isFinite(lower);
  const hasUpper = Number.isFinite(upper);

  if (!hasLower && !hasUpper) {
    return null;
  }
  if (!hasLower || !hasUpper) {
    return jointName
      ? `Both lower and upper limits are required for joint "${jointName}"`
      : "Both lower and upper limits are required";
  }
  if ((lower as number) > (upper as number)) {
    return jointName
      ? `Lower limit must be <= upper limit for joint "${jointName}"`
      : "Lower limit must be <= upper limit";
  }
  return null;
};
