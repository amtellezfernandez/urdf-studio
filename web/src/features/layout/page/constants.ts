import type { RotationAxis } from "@/shared/types/feature";

export const DEFAULT_URDF_FILENAME = "robot.urdf";

export const AXIS_NAMES: Record<RotationAxis, string> = {
  x: "X",
  y: "Y",
  z: "Z",
} as const;

export const SIDEBAR_RESIZER_WIDTH = 8;
export const TOP_NAV_HEIGHT_PX = 28;
export const TOP_NAV_HEIGHT = `${TOP_NAV_HEIGHT_PX}px`;
export const SIDEBAR_RESIZER_TOP_OFFSET_PX = TOP_NAV_HEIGHT_PX + 4;
export const SIDEBAR_RESIZER_TOP_OFFSET = `${SIDEBAR_RESIZER_TOP_OFFSET_PX}px`;
export const VIEWPORT_HEIGHT_WITH_TOP_NAV = `calc(100dvh - ${TOP_NAV_HEIGHT})`;
export const VIEWER_RESIZER_HEIGHT = 4;
export const DEFAULT_LEFT_SIDEBAR_TOP_PANEL_HEIGHT = 0.34;
export const MIN_LEFT_SIDEBAR_TOP_PANEL_HEIGHT = 92;
export const MIN_LEFT_SIDEBAR_CAMERA_PANEL_HEIGHT = 160;
export const MIN_EPISODES_PANEL_HEIGHT = 50;
export const MIN_CAMERAS_PANEL_HEIGHT = 160;
export const MIN_HEADER_HEIGHT = MIN_EPISODES_PANEL_HEIGHT;
export const COMMON_MESH_FOLDERS = [
  "meshes",
  "mesh",
  "assets",
  "models",
  "visual",
  "collision",
] as const;
