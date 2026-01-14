// Joint colors matching the episode viewer
const JOINT_COLORS = [
  "#ec4899",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#f97316",
  "#06b6d4",
  "#ef4444",
] as const;

/**
 * Gets the color for a specific joint based on its position in sorted joint names
 */
export function getJointColor(jointName: string, allJointNames: string[]): string {
  const sortedNames = [...allJointNames].sort();
  const index = sortedNames.indexOf(jointName);
  if (index === -1) return JOINT_COLORS[0];
  return JOINT_COLORS[index % JOINT_COLORS.length];
}
