import { updateJointLimitsInUrdf } from "@/shared/lib/urdfCore";

export function updateJointLimitsInURDF(
  urdfContent: string,
  jointName: string,
  lowerLimit?: number | null,
  upperLimit?: number | null
): string {
  const result = updateJointLimitsInUrdf(urdfContent, jointName, lowerLimit, upperLimit);
  return result.success ? result.content : urdfContent;
}
