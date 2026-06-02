import {
  DEFAULT_CUBE_SIZE,
  DEFAULT_CYLINDER_HEIGHT,
  DEFAULT_POINT_SIZE,
} from "./objectCreatorHelpers";

export const WORLD_OBJECT_GEOMETRY_PARAMS = {
  fallbackPositionM: 0,
  cubeFallbackSizeM: DEFAULT_CUBE_SIZE,
  cubeMinSizeM: 0.01,
  pointFallbackSizeM: DEFAULT_POINT_SIZE,
  sphereFallbackDiameterM: DEFAULT_CUBE_SIZE,
  sphereMinDiameterM: 0.01,
  cylinderFallbackDiameterM: DEFAULT_CUBE_SIZE,
  cylinderMinDiameterM: 0.01,
  cylinderFallbackHeightM: DEFAULT_CYLINDER_HEIGHT,
  cylinderMinHeightM: 0.01,
  axisAlignmentToleranceRad: 1e-6,
} as const;
