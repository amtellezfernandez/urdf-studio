// Joint colors matching the episode viewer
export const JOINT_COLORS = [
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
 * Creates a color map for joints based on their sorted order
 * This matches the logic used in EpisodeViewer3DModal
 */
export function createJointColorMap(jointNames: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const sortedNames = [...jointNames].sort();
  sortedNames.forEach((jointName, index) => {
    map.set(jointName, JOINT_COLORS[index % JOINT_COLORS.length]);
  });
  return map;
}

/**
 * Gets the color for a specific joint based on its position in sorted joint names
 */
export function getJointColor(jointName: string, allJointNames: string[]): string {
  const sortedNames = [...allJointNames].sort();
  const index = sortedNames.indexOf(jointName);
  if (index === -1) return JOINT_COLORS[0];
  return JOINT_COLORS[index % JOINT_COLORS.length];
}
