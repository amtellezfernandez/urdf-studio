import { setJointAxisInUrdf } from "@/shared/lib/urdfCore";

export function updateJointAxisInURDF(
  urdfContent: string,
  jointName: string,
  axis: [number, number, number]
): string {
  const result = setJointAxisInUrdf(urdfContent, jointName, axis);
  return result.success ? result.content : urdfContent;
}
