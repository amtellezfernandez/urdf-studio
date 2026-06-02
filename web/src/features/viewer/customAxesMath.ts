import { CUSTOM_AXES_NEGATIVE_MARKER_SPACING } from "@/features/viewer/customAxesParams";

export const buildNegativeAxisMarkerDistances = (
  length: number,
  spacing = CUSTOM_AXES_NEGATIVE_MARKER_SPACING
): number[] => {
  if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(spacing) || spacing <= 0) {
    return [];
  }

  const markerCount = Math.max(1, Math.ceil(length / spacing));
  const distances: number[] = [];

  for (let step = 0; step <= markerCount; step += 1) {
    const distance = Math.min(step * spacing, length);
    distances.push(-distance);
  }

  return distances;
};

