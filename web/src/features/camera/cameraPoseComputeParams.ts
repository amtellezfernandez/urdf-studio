export const CAMERA_POSE_COMPUTE_PARAMS = {
  defaultMarginForwardMeters: 0.03,
  defaultMarginUpMeters: 0.02,
  minBackOffsetMeters: 0.05,
  directionLengthEpsilon: 1e-4,
  boundingBoxBackOffsetScale: 0.6,
  fallbackBackOffsetMeters: 0.06,
  upAxisParallelDot: 0.9,
} as const;
