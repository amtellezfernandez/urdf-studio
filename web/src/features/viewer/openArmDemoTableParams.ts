export const OPENARM_DEMO_TABLE_TOP_SIZE_M = {
  x: 1.5,
  y: 1.6,
  z: 0.04,
} as const;
export const OPENARM_DEMO_TABLE_CALIBRATED_MIN_TOP_SIZE_M = {
  x: 0.28,
  y: 0.28,
} as const;
export const OPENARM_DEMO_TABLE_LEG_SIZE_M = {
  x: 0.055,
  y: 0.055,
} as const;
export const OPENARM_DEMO_TABLE_LEG_INSET_M = 0.12;
export const OPENARM_DEMO_TABLE_LEG_BOTTOM_Z_M = 0;
export const OPENARM_DEMO_TABLE_LEG_MIN_HEIGHT_M = 0.04;
export const OPENARM_DEMO_TABLE_LEG_COUNT = 4;
export const OPENARM_DEMO_TABLE_LEG_LOCAL_OFFSETS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;

// Fallback used before the live point cloud has enough samples to locate the
// demo tabletop surface in the URDF Z-up scene.
export const OPENARM_DEMO_TABLE_TOP_SURFACE_Z_M = 0.32;
export const OPENARM_DEMO_TABLE_TOP_SURFACE_ABOVE_FLOOR_M = 0.05;
export const OPENARM_DEMO_TABLE_HEIGHT_BIN_SIZE_M = 0.015;
export const OPENARM_DEMO_TABLE_POINT_CLOUD_MAX_HEIGHT_SAMPLES = 65_536;
export const OPENARM_DEMO_TABLE_SURFACE_MIN_SAMPLE_COUNT = 24;
export const OPENARM_DEMO_TABLE_POINT_CLOUD_FIT_PADDING_M = 0;
export const OPENARM_DEMO_TABLE_FIT_SOLVE_MAX_ITERATIONS = 6;
export const OPENARM_DEMO_TABLE_FIT_CONVERGENCE_EPSILON_M = 1e-6;
export const OPENARM_DEMO_TABLE_YAW_COVARIANCE_CROSS_FACTOR = 2;
export const OPENARM_DEMO_TABLE_YAW_HALF_ANGLE_FACTOR = 0.5;
export const OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD = 0;
export const OPENARM_DEMO_TABLE_BACK_EDGE_CLEARANCE_X_M = 0.18;
export const OPENARM_DEMO_TABLE_CENTER_X_M =
  OPENARM_DEMO_TABLE_BACK_EDGE_CLEARANCE_X_M + OPENARM_DEMO_TABLE_TOP_SIZE_M.x / 2;
export const OPENARM_DEMO_TABLE_CENTER_Y_M = 0;
export const OPENARM_DEMO_TABLE_FOOTPRINT_CORNER_SIGNS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;
