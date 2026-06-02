import { renameJointInUrdf } from "@/shared/lib/urdfCore";

export function updateJointNameInURDF(
  urdfContent: string,
  oldJointName: string,
  newJointName: string
): string {
  const result = renameJointInUrdf(urdfContent, oldJointName, newJointName);
  return result.success ? result.content : urdfContent;
}
