import { IK_RUNTIME_CONFIG } from "@/shared/config/runtime";

export const IK_DRAG_CONFIG = {
  maxDragSpeed: 1.8,
  minSolveDistance: 0.001,
  springStrength: 55,
  springDamping: 24,
  snapDistance: 0.004,
  reachMargin: 1.2,
  ikThrottleMs: 20,
  maxLinkTraversal: 200,
};

export const IK_DRAG_HANDLE_CONFIG = {
  radiusMeters: 0.055,
  anchorSurfacePadMeters: 0.015,
  anchorMinOffsetMeters: 0.12,
  anchorMaxOffsetMeters: 3.5,
  maxLeadDistanceMeters: 0.08,
};

export const IK_DRAG_HANDLE_VISUAL_CONFIG = {
  colors: {
    default: "#4dabf7",
    hover: "#5bc0de",
    hardwareActive: "#22c55e",
    hardwareHover: "#34d399",
    dragging: "#ff6b6b",
    clamped: "#f59e0b",
  },
  opacity: {
    idle: 0.7,
    hover: 0.8,
    draggingOrClamped: 0.9,
  },
} as const;

export const IK_ARM_REACH_CONFIG = {
  margin: 1.0,
  minMargin: 1.0,
  slackMeters: 0.0,
  dynamicHeadroomMeters: 0.0,
  clampEpsilonMeters: 1e-6,
};

export const LIVE_TELEOP_JOINT_SYNC_CONFIG = {
  positionEpsilonRad: 1e-6,
};

export const IK_ORBIT_DEFAULTS = {
  radius: 0.3,
  inclinationDeg: 45,
  phaseDeg: 0,
  secondaryOffsetDeg: 180,
};

const ikTimeouts = IK_RUNTIME_CONFIG?.timeouts ?? {};

export const IK_SOLVER_DEFAULTS = {
  requestTimeoutMs: ikTimeouts.requestMs ?? 1200,
  dragTimeoutMs: ikTimeouts.dragMs ?? 300,
  orbitTimeoutMs: ikTimeouts.orbitMs ?? 250,
};
