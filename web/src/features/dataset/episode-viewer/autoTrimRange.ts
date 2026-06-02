import { AUTO_TRIM_PARAMS } from "@/features/dataset/episode-viewer/autoTrimParams";

type FrameLike = {
  jointPositions?: Record<string, number>;
};

export type AutoTrimRangeStatus =
  | "ok"
  | "not_enough_frames"
  | "movement_too_small"
  | "no_movement"
  | "already_trimmed";

export type AutoTrimRangeResult =
  | {
      status: "ok";
      start: number;
      end: number;
      threshold: number;
    }
  | {
      status: Exclude<AutoTrimRangeStatus, "ok">;
    };

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const resolvePercentile = (values: number[], percentile: number) => {
  if (values.length === 0) return 0;
  const clampedPercentile = Math.max(0, Math.min(1, percentile));
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.floor(clampedPercentile * (sorted.length - 1));
  return sorted[index] ?? 0;
};

const smoothSeries = (values: number[]) => {
  if (values.length === 0) return [];
  const radius = AUTO_TRIM_PARAMS.smoothingWindowRadius;
  if (radius <= 0) return [...values];
  return values.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    let sum = 0;
    let count = 0;
    for (let cursor = start; cursor <= end; cursor += 1) {
      sum += values[cursor] ?? 0;
      count += 1;
    }
    return count > 0 ? sum / count : 0;
  });
};

const findFirstActiveRunStart = (isActive: boolean[]) => {
  const minRun = AUTO_TRIM_PARAMS.minConsecutiveActiveFrames;
  for (let index = 0; index <= isActive.length - minRun; index += 1) {
    let hasRun = true;
    for (let offset = 0; offset < minRun; offset += 1) {
      if (!isActive[index + offset]) {
        hasRun = false;
        break;
      }
    }
    if (hasRun) {
      return index;
    }
  }
  return null;
};

const findLastActiveRunEnd = (isActive: boolean[]) => {
  const minRun = AUTO_TRIM_PARAMS.minConsecutiveActiveFrames;
  for (let index = isActive.length - 1; index >= minRun - 1; index -= 1) {
    let hasRun = true;
    for (let offset = 0; offset < minRun; offset += 1) {
      if (!isActive[index - offset]) {
        hasRun = false;
        break;
      }
    }
    if (hasRun) {
      return index;
    }
  }
  return null;
};

export const resolveAutoTrimRange = ({
  frames,
  signalNames,
  resolveSignalValue,
}: {
  frames: ReadonlyArray<FrameLike>;
  signalNames: ReadonlyArray<string>;
  resolveSignalValue?: (frame: FrameLike, signalName: string) => number | null;
}): AutoTrimRangeResult => {
  if (frames.length < AUTO_TRIM_PARAMS.minFrameCount) {
    return { status: "not_enough_frames" };
  }
  if (signalNames.length === 0) {
    return { status: "no_movement" };
  }

  const resolveValue =
    resolveSignalValue ??
    ((frame: FrameLike, signalName: string) => frame.jointPositions?.[signalName] ?? null);

  const perFrameMotion: number[] = [];
  let maxMotion = 0;
  for (let frameIndex = 1; frameIndex < frames.length; frameIndex += 1) {
    const currentFrame = frames[frameIndex];
    const previousFrame = frames[frameIndex - 1];
    let maxSignalDelta = 0;
    let hasFiniteDelta = false;
    signalNames.forEach((signalName) => {
      const currentValue = resolveValue(currentFrame, signalName);
      const previousValue = resolveValue(previousFrame, signalName);
      if (!isFiniteNumber(currentValue) || !isFiniteNumber(previousValue)) return;
      const delta = Math.abs(currentValue - previousValue);
      if (!Number.isFinite(delta)) return;
      hasFiniteDelta = true;
      if (delta > maxSignalDelta) {
        maxSignalDelta = delta;
      }
    });
    const motionValue = hasFiniteDelta ? maxSignalDelta : 0;
    perFrameMotion.push(motionValue);
    if (motionValue > maxMotion) {
      maxMotion = motionValue;
    }
  }

  if (!Number.isFinite(maxMotion) || maxMotion < AUTO_TRIM_PARAMS.minTotalMotion) {
    return { status: "movement_too_small" };
  }

  const noiseFloor = resolvePercentile(
    perFrameMotion,
    AUTO_TRIM_PARAMS.noiseFloorPercentile
  );
  const baseThreshold = Math.max(
    AUTO_TRIM_PARAMS.absoluteFrameMotionThreshold,
    maxMotion * AUTO_TRIM_PARAMS.relativeFrameMotionThreshold,
    noiseFloor * AUTO_TRIM_PARAMS.noiseFloorScale
  );
  const threshold = Math.min(
    maxMotion * AUTO_TRIM_PARAMS.maxThresholdRatio,
    baseThreshold
  );
  const smoothedMotion = smoothSeries(perFrameMotion);
  const activeMotion = smoothedMotion.map((value) => value > threshold);

  const firstActive = findFirstActiveRunStart(activeMotion);
  const lastActive = findLastActiveRunEnd(activeMotion);
  if (firstActive === null || lastActive === null) {
    return { status: "no_movement" };
  }

  const start = Math.max(
    0,
    firstActive + 1 - AUTO_TRIM_PARAMS.edgePaddingFrames
  );
  const end = Math.min(
    frames.length - 1,
    lastActive + 1 + AUTO_TRIM_PARAMS.edgePaddingFrames
  );

  const activeCount = activeMotion.filter(Boolean).length;
  const activeRatio =
    activeMotion.length > 0 ? activeCount / activeMotion.length : 0;
  if (
    start <= AUTO_TRIM_PARAMS.fullRangeGuardFrames &&
    end >= frames.length - 1 - AUTO_TRIM_PARAMS.fullRangeGuardFrames &&
    activeRatio >= AUTO_TRIM_PARAMS.fullRangeMinActiveRatio
  ) {
    return { status: "already_trimmed" };
  }

  return {
    status: "ok",
    start,
    end,
    threshold,
  };
};
