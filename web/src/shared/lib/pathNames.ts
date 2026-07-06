export const getPathSegments = (inputPath: string | null | undefined): string[] => {
  if (!inputPath) return [];
  const normalized = inputPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean);
};

export const getFirstPathSegment = (
  inputPath: string | null | undefined,
  fallback = ""
): string => getPathSegments(inputPath)[0] ?? fallback;

export const getFilenameFromPath = (
  inputPath: string | null | undefined,
  fallback = "robot.urdf"
): string => {
  const parts = getPathSegments(inputPath);
  return parts[parts.length - 1] || fallback;
};
