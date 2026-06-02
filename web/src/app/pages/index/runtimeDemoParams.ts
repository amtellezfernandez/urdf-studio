export const RUNTIME_DEMO_PARAMS = {
  scanSweepRadians: Math.PI * 2,
  navigationDurationMs: 2600,
  stopDistanceMeters: 0.34,
  navigationRotatePhase: 0.5,
  navigationDurationBySpeedMs: {
    slow: 3600,
    fast: 120,
  },
  millisecondsPerSecond: 1000,
  directMoveMinDurationMs: 150,
  directRotateMinDurationMs: 150,
} as const;
