export const VIEWER_SCENE_GRID_PARAMS = {
  highSpanMeters: 240,
  lowSpanMeters: 180,
  highDivisions: 240,
  lowDivisions: 180,
  snapStepMeters: 1,
  planeZMeters: 0,
  highOpacity: 0.38,
  lowOpacity: 0.3,
  majorLineColor: "#8a8a8a",
  minorLineColor: "#6f6f6f",
  renderOrder: -20,
  rotationRad: [Math.PI / 2, 0, 0] as const,
} as const;

export const VIEWER_SCENE_FLOOR_PARAMS = {
  sizeMeters: 20,
  color: 0xfafafa,
  opacity: 0.15,
  renderOrder: -15,
  rotationRad: [-Math.PI / 2, 0, 0] as const,
  position: [0, 0, 0] as const,
} as const;
