import { toFiniteNumberOrNull } from "@/shared/lib/numeric";

export const getJointLimitsError = (
  lower?: number | null,
  upper?: number | null,
  jointName?: string
): string | null => {
  const finiteLower = toFiniteNumberOrNull(lower);
  const finiteUpper = toFiniteNumberOrNull(upper);

  if (finiteLower === null && finiteUpper === null) {
    return null;
  }
  if (finiteLower === null || finiteUpper === null) {
    return jointName
      ? `Both lower and upper limits are required for joint "${jointName}"`
      : "Both lower and upper limits are required";
  }
  if (finiteLower > finiteUpper) {
    return jointName
      ? `Lower limit must be <= upper limit for joint "${jointName}"`
      : "Lower limit must be <= upper limit";
  }
  return null;
};
