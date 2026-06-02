import { updateJointVelocityInUrdf } from "@/shared/lib/urdfCore";

export function updateJointVelocityInURDF(
  urdfContent: string,
  jointName: string,
  velocity: number | null
): string {
  const result = updateJointVelocityInUrdf(urdfContent, jointName, velocity);
  return result.success ? result.content : urdfContent;
}
