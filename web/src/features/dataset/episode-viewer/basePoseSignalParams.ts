export const BASE_POSE_SIGNAL_PARAMS = {
  metersToMillimeters: 1000,
  quaternionYawScale: 2,
  quaternionNormEpsilon: 1e-12,
  derivedSignalNames: ["x_mm", "y_mm", "theta"],
} as const;
