import { updateJointTypeInUrdf } from "@/shared/lib/urdfCore";

export function updateJointTypeInURDF(
  urdfContent: string,
  jointName: string,
  jointType: string,
  lowerLimit?: number,
  upperLimit?: number
): string {
  const result = updateJointTypeInUrdf(
    urdfContent,
    jointName,
    jointType,
    lowerLimit,
    upperLimit
  );
  return result.success ? result.content : urdfContent;
}
