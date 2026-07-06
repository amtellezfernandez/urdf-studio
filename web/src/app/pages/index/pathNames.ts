export const getFilenameFromPath = (
  inputPath: string | null | undefined,
  fallback = "robot.urdf"
): string => {
  if (!inputPath) return fallback;
  const normalized = inputPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || fallback;
};
