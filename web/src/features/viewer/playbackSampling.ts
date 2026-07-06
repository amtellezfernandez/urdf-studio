import type { AnimationFrame } from "@/features/viewer/viewer-types";

export const clampTimestampToFrameRange = (
  frames: AnimationFrame[],
  timestamp: number
) => {
  if (frames.length === 0) return timestamp;
  const first = frames[0]?.timestamp ?? 0;
  const last = frames[frames.length - 1]?.timestamp ?? first;
  return Math.max(first, Math.min(timestamp, last));
};

export const clampFrameIndexToFrameRange = (
  frames: AnimationFrame[],
  frameIndex: number
) => {
  if (frames.length === 0) return 0;
  const safeIndex = Number.isFinite(frameIndex) ? frameIndex : 0;
  return Math.max(0, Math.min(safeIndex, frames.length - 1));
};

export const resolveFrameIndexAtOrAfterTimestamp = (
  frames: AnimationFrame[],
  timestamp: number
) => {
  if (frames.length === 0) return 0;
  const first = frames[0]?.timestamp ?? 0;
  const last = frames[frames.length - 1]?.timestamp ?? first;
  if (timestamp <= first) return 0;
  if (timestamp >= last) return frames.length - 1;

  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((frames[mid]?.timestamp ?? first) < timestamp) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
};

export const resolveFrameIndexAtOrBeforeTimestamp = (
  frames: AnimationFrame[],
  timestamp: number
) => {
  if (frames.length === 0) return 0;
  const upper = resolveFrameIndexAtOrAfterTimestamp(frames, timestamp);
  const upperTimestamp = frames[upper]?.timestamp ?? timestamp;
  if (upperTimestamp <= timestamp) {
    return upper;
  }
  return Math.max(0, upper - 1);
};

export const resolveNearestFrameIndexAtTimestamp = (
  frames: AnimationFrame[],
  timestamp: number
) => {
  if (frames.length === 0) return 0;
  const upper = resolveFrameIndexAtOrAfterTimestamp(frames, timestamp);
  const lower = Math.max(0, upper - 1);
  if (upper === lower) return upper;
  const lowerTime = frames[lower]?.timestamp ?? timestamp;
  const upperTime = frames[upper]?.timestamp ?? timestamp;
  return Math.abs(timestamp - lowerTime) <= Math.abs(upperTime - timestamp)
    ? lower
    : upper;
};


// Linearly interpolate joint values between the two frames bracketing `timestamp`.
// Used to smooth the 3D robot display without changing what the graph reports.
export const resolveInterpolatedJointValues = (
  frames: AnimationFrame[],
  timestamp: number
): Record<string, number> => {
  if (frames.length === 0) return {};
  const upperIdx = resolveFrameIndexAtOrAfterTimestamp(frames, timestamp);
  const lowerIdx = Math.max(0, upperIdx - 1);
  const lower = frames[lowerIdx]!;
  const upper = frames[upperIdx]!;
  if (lowerIdx === upperIdx || lower.timestamp === upper.timestamp) {
    return { ...lower.joints };
  }
  const t = Math.max(0, Math.min(1,
    (timestamp - lower.timestamp) / (upper.timestamp - lower.timestamp)
  ));
  const result: Record<string, number> = {};
  for (const [name, lo] of Object.entries(lower.joints)) {
    const hi = upper.joints[name];
    result[name] = hi !== undefined ? lo + (hi - lo) * t : lo;
  }
  return result;
};

export const buildFrameLockedJointValues = (
  previous: Record<string, number>,
  frameJoints: Record<string, number>,
  { preservePrevious = true }: { preservePrevious?: boolean } = {}
) => {
  const next: Record<string, number> = preservePrevious ? { ...previous } : {};
  let hasNonFinite = false;

  for (const [jointName, value] of Object.entries(frameJoints)) {
    if (!Number.isFinite(value)) {
      hasNonFinite = true;
      continue;
    }
    next[jointName] = value;
  }

  return { joints: next, hasNonFinite };
};
