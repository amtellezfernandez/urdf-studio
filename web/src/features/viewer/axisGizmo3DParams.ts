export const AXIS_GIZMO_3D_PARAMS = {
  colors: {
    x: "#BE2C41",
    y: "#6DA424",
    z: "#3464AD",
  },
  geometry: {
    axisLength: 0.32,
    axisRadius: 0.016,
    arrowLength: 0.08,
    arrowRadius: 0.024,
    labelDistance: 0.4,
    ballRadius: 0.11,
    radialSegments: 16,
  },
  renderOrder: {
    label: 10000,
    endpoint: 999,
  },
  screenScale: {
    targetScreenSizePx: 140,
    referenceViewportHeightPx: 600,
    viewDistance: 1.2,
    screenOffsetX: 0.65,
    screenOffsetY: 0.4,
    minScale: 0.16,
    maxScale: 0.4,
  },
} as const;
