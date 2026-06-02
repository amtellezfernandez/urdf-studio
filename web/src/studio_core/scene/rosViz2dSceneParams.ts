export type ViewTransform = {
  pixelsPerMeter: number;
  offsetX: number;
  offsetY: number;
};

export const ROSVIZ_CANVAS_PIXELS_PER_METER = 96;
export const ROSVIZ_CANVAS_MIN_PIXELS_PER_METER = 24;
export const ROSVIZ_CANVAS_MAX_PIXELS_PER_METER = 420;

export const ROSVIZ_GRID_STEP_METERS = 0.5;
export const ROSVIZ_GRID_LINE_COLOR = "rgba(148, 163, 184, 0.16)";
export const ROSVIZ_AXIS_LINE_COLOR = "rgba(226, 232, 240, 0.42)";
export const ROSVIZ_LABEL_COLOR = "rgba(226, 232, 240, 0.9)";
export const ROSVIZ_BACKGROUND_COLOR = "#0b1117";
export const ROSVIZ_BASE_LINK_COLOR = "#22c55e";
export const ROSVIZ_LINK_COLOR = "#60a5fa";
export const ROSVIZ_MARKER_LINE_FALLBACK_COLOR = "rgba(56, 189, 248, 0.95)";
export const ROSVIZ_MARKER_POINT_FALLBACK_COLOR = "rgba(250, 204, 21, 0.95)";
export const ROSVIZ_POINT_RADIUS = 4;

export const INITIAL_VIEW_TRANSFORM: ViewTransform = {
  pixelsPerMeter: ROSVIZ_CANVAS_PIXELS_PER_METER,
  offsetX: 0,
  offsetY: 0,
};

export const clampPixelsPerMeter = (value: number): number =>
  Math.min(ROSVIZ_CANVAS_MAX_PIXELS_PER_METER, Math.max(ROSVIZ_CANVAS_MIN_PIXELS_PER_METER, value));
