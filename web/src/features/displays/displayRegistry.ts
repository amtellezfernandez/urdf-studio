import type { DisplayInstance, DisplayKind } from "@/features/displays/types";

export const DISPLAY_ORDER: DisplayKind[] = [
  "robot_model",
  "tf_frames",
  "markers",
  "trajectory",
  "diagnostics_overlay",
];

type DisplaySeed = Omit<DisplayInstance, "status" | "metrics">;

const DISPLAY_SEEDS: Record<DisplayKind, DisplaySeed> = {
  robot_model: {
    kind: "robot_model",
    label: "Robot Model",
    description: "Resolved robot links and frame points.",
    enabled: true,
    source: "runtime",
    params: {},
  },
  tf_frames: {
    kind: "tf_frames",
    label: "TF Frames",
    description: "Frame labels and hierarchy context.",
    enabled: true,
    source: "runtime",
    params: {},
  },
  markers: {
    kind: "markers",
    label: "Markers",
    description: "RViz-style marker primitives (sphere/cube/line).",
    enabled: true,
    source: "runtime",
    params: {},
  },
  trajectory: {
    kind: "trajectory",
    label: "Trajectory",
    description: "End-effector trail and path overlays.",
    enabled: true,
    source: "runtime",
    params: {},
  },
  diagnostics_overlay: {
    kind: "diagnostics_overlay",
    label: "Diagnostics Overlay",
    description: "Stream and runtime diagnostics text overlay.",
    enabled: true,
    source: "viewer",
    params: {},
  },
};

export const createDefaultDisplays = (): Record<DisplayKind, DisplayInstance> => {
  const displays = {} as Record<DisplayKind, DisplayInstance>;
  DISPLAY_ORDER.forEach((kind) => {
    const seed = DISPLAY_SEEDS[kind];
    displays[kind] = {
      ...seed,
      status: "idle",
      metrics: {},
    };
  });
  return displays;
};
