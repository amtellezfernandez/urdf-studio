import type { RotationAxis } from "@/features/types";

export const DEFAULT_URDF_FILENAME = "robot.urdf";

export const AXIS_NAMES: Record<RotationAxis, string> = {
  x: "X",
  y: "Y",
  z: "Z",
} as const;

export const SIDEBAR_RESIZER_WIDTH = 8;
export const VIEWER_RESIZER_HEIGHT = 4;
export const DEFAULT_RECORDING_VIEW_HEIGHT = 0.4;
export const MIN_HEADER_HEIGHT = 50;
export const COMMON_MESH_FOLDERS = [
  "meshes",
  "mesh",
  "assets",
  "models",
  "visual",
  "collision",
] as const;
