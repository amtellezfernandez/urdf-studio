import type { MarkerStoreMap } from "@/runtime_engine/rosviz/state/markerStore";
import type {
  RosVizMarkerPayload,
  RosVizResolvedFramePosePayload,
} from "@/runtime_engine/rosviz/types";
import {
  ROSVIZ_AXIS_LINE_COLOR,
  ROSVIZ_BACKGROUND_COLOR,
  ROSVIZ_BASE_LINK_COLOR,
  ROSVIZ_GRID_LINE_COLOR,
  ROSVIZ_GRID_STEP_METERS,
  ROSVIZ_LABEL_COLOR,
  ROSVIZ_LINK_COLOR,
  ROSVIZ_MARKER_LINE_FALLBACK_COLOR,
  ROSVIZ_MARKER_POINT_FALLBACK_COLOR,
  ROSVIZ_POINT_RADIUS,
  type ViewTransform,
} from "@/studio_core/scene/rosViz2dSceneParams";

export type RosVizSceneVisibility = {
  showRobotModel: boolean;
  showTfFrames: boolean;
  showMarkers: boolean;
  showTrajectory: boolean;
};

export type RosViz2dSceneRenderInput = {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  viewTransform: ViewTransform;
  resolvedPoses: RosVizResolvedFramePosePayload[];
  markers: MarkerStoreMap;
  visibility: RosVizSceneVisibility;
};

const toMarkerColor = (marker: RosVizMarkerPayload, fallback: string): string => {
  const [r, g, b, a] = marker.color_rgba;
  const rr = Math.round(Math.max(0, Math.min(1, r)) * 255);
  const gg = Math.round(Math.max(0, Math.min(1, g)) * 255);
  const bb = Math.round(Math.max(0, Math.min(1, b)) * 255);
  const aa = Math.max(0, Math.min(1, a));
  return Number.isFinite(rr + gg + bb + aa) ? `rgba(${rr}, ${gg}, ${bb}, ${aa})` : fallback;
};

export const renderRosViz2dScene = ({
  context,
  width,
  height,
  viewTransform,
  resolvedPoses,
  markers,
  visibility,
}: RosViz2dSceneRenderInput): void => {
  context.clearRect(0, 0, width, height);
  context.fillStyle = ROSVIZ_BACKGROUND_COLOR;
  context.fillRect(0, 0, width, height);

  const pixelsPerMeter = viewTransform.pixelsPerMeter;
  const centerX = width / 2 + viewTransform.offsetX;
  const centerY = height / 2 + viewTransform.offsetY;

  context.strokeStyle = ROSVIZ_GRID_LINE_COLOR;
  context.lineWidth = 1;
  const gridStepPx = Math.max(8, ROSVIZ_GRID_STEP_METERS * pixelsPerMeter);
  for (let x = centerX % gridStepPx; x < width; x += gridStepPx) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = centerY % gridStepPx; y < height; y += gridStepPx) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.strokeStyle = ROSVIZ_AXIS_LINE_COLOR;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(0, centerY);
  context.lineTo(width, centerY);
  context.stroke();
  context.beginPath();
  context.moveTo(centerX, 0);
  context.lineTo(centerX, height);
  context.stroke();

  context.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";

  resolvedPoses.forEach((pose) => {
    const [x, y] = pose.translation_xyz;
    const screenX = centerX + x * pixelsPerMeter;
    const screenY = centerY - y * pixelsPerMeter;

    if (visibility.showRobotModel) {
      context.fillStyle = pose.frame_id.includes("base") ? ROSVIZ_BASE_LINK_COLOR : ROSVIZ_LINK_COLOR;
      context.beginPath();
      context.arc(screenX, screenY, ROSVIZ_POINT_RADIUS, 0, Math.PI * 2);
      context.fill();
    }

    if (visibility.showTfFrames) {
      context.fillStyle = ROSVIZ_LABEL_COLOR;
      context.fillText(pose.frame_id, screenX + 8, screenY - 8);
    }
  });

  if (!visibility.showMarkers) {
    return;
  }

  markers.forEach((entry) => {
    const marker = entry.marker;
    if (marker.marker_type === "line_strip") {
      if (!visibility.showTrajectory || marker.points_xyz.length < 2) {
        return;
      }
      context.strokeStyle = toMarkerColor(marker, ROSVIZ_MARKER_LINE_FALLBACK_COLOR);
      context.lineWidth = Math.max(1.5, marker.scale_xyz[0] * pixelsPerMeter);
      context.beginPath();
      marker.points_xyz.forEach((point, index) => {
        const screenX = centerX + point[0] * pixelsPerMeter;
        const screenY = centerY - point[1] * pixelsPerMeter;
        if (index === 0) {
          context.moveTo(screenX, screenY);
        } else {
          context.lineTo(screenX, screenY);
        }
      });
      context.stroke();
      return;
    }

    const [x, y] = marker.pose_position_xyz;
    const screenX = centerX + x * pixelsPerMeter;
    const screenY = centerY - y * pixelsPerMeter;
    const radius = Math.max(2, marker.scale_xyz[0] * pixelsPerMeter);
    context.fillStyle = toMarkerColor(marker, ROSVIZ_MARKER_POINT_FALLBACK_COLOR);
    if (marker.marker_type === "cube") {
      context.fillRect(screenX - radius, screenY - radius, radius * 2, radius * 2);
      return;
    }
    context.beginPath();
    context.arc(screenX, screenY, radius, 0, Math.PI * 2);
    context.fill();
  });
};
