import { DEFAULT_POINT_SIZE } from "./objectCreatorHelpers";

export const WORLD_OBJECT_RENDER_PARAMS = {
  pointDisplayDiameterM: DEFAULT_POINT_SIZE,
  selectionOverlayPaddingM: 0.02,
  selectionOverlayMinCubeSizeM: 0.04,
  selectionOverlayPointRadiusScale: 1.35,
  selectionOverlayMinPointRadiusM: 0.03,
  selectionOverlayOpacity: 1,
  selectionOverlayFillOpacity: 0.12,
  selectionOverlayColor: "#ff6b6b",
} as const;
