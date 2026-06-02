export const AUTO_TRIM_PARAMS = {
  minFrameCount: 2,
  minTotalMotion: 1e-3,
  absoluteFrameMotionThreshold: 1e-4,
  relativeFrameMotionThreshold: 0.15,
  maxThresholdRatio: 0.8,
  noiseFloorPercentile: 0.5,
  noiseFloorScale: 3,
  smoothingWindowRadius: 0,
  minConsecutiveActiveFrames: 3,
  edgePaddingFrames: 1,
  fullRangeGuardFrames: 0,
  fullRangeMinActiveRatio: 0.85,
} as const;
