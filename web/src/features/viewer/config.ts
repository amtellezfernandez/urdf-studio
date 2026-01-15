import { IK_RUNTIME_CONFIG } from "@/shared/config/runtime";

export const IK_DRAG_CONFIG = {
  maxDragSpeed: 1.2,
  minSolveDistance: 0.003,
  springStrength: 45,
  springDamping: 12,
  snapDistance: 0.003,
  reachMargin: 1.25,
  ikThrottleMs: 40,
  maxLinkTraversal: 200,
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
