import { numberToHexColor, numberToRgba } from "@/shared/lib/color";
import {
  INERTIA_BOX_OPACITY,
  INERTIA_CENTER_MARKER_COLOR,
  INERTIA_REFERENCE_BOX_COLOR,
  INERTIA_SHAPE_FILL_COLOR_HEALTHY,
  INERTIA_SHAPE_FILL_COLOR_PROBLEMATIC,
  INERTIA_SHAPE_FILL_COLOR_WARNING,
  INERTIA_VOLUME_EDGE_COLOR_HEALTHY,
} from "@/features/viewer/inertialVisualizationParams";

export type ViewerInertiaLegendItem = {
  backgroundColor: string;
  borderColor: string;
  key: string;
  label: string;
  markerColor: string | null;
};

export type ViewerInertiaSeverityLegendItem = {
  color: string;
  key: string;
  label: string;
};

export const VIEWER_INERTIA_OVERLAY_TOOLTIP_LINES = [
  "shape fill: green to red based on how well the inertia box proportions fit the reference.",
  "volume outline: compares the authored inertia size against the reference geometry.",
  "center offset: shows the drift from the reference center to the inertia center.",
  "reference geometry: comparison box from collision or mesh geometry.",
  "mismatch: low, moderate, and high severity for shape and volume agreement.",
] as const;

export function buildViewerInertiaLegendItems(): ViewerInertiaLegendItem[] {
  return [
    {
      key: "shape",
      label: "Shape fill",
      borderColor: numberToHexColor(INERTIA_SHAPE_FILL_COLOR_HEALTHY),
      backgroundColor: numberToRgba(INERTIA_SHAPE_FILL_COLOR_HEALTHY, INERTIA_BOX_OPACITY),
      markerColor: null,
    },
    {
      key: "volume",
      label: "Volume outline",
      borderColor: numberToHexColor(INERTIA_VOLUME_EDGE_COLOR_HEALTHY),
      backgroundColor: "transparent",
      markerColor: null,
    },
    {
      key: "center",
      label: "Center offset",
      borderColor: numberToHexColor(INERTIA_CENTER_MARKER_COLOR),
      backgroundColor: "transparent",
      markerColor: numberToHexColor(INERTIA_CENTER_MARKER_COLOR),
    },
  ];
}

export function buildViewerInertiaSeverityLegendItems(): ViewerInertiaSeverityLegendItem[] {
  return [
    {
      key: "low",
      label: "Low",
      color: numberToHexColor(INERTIA_SHAPE_FILL_COLOR_HEALTHY),
    },
    {
      key: "moderate",
      label: "Moderate",
      color: numberToHexColor(INERTIA_SHAPE_FILL_COLOR_WARNING),
    },
    {
      key: "high",
      label: "High",
      color: numberToHexColor(INERTIA_SHAPE_FILL_COLOR_PROBLEMATIC),
    },
  ];
}

export function getViewerInertiaReferenceColor(): string {
  return numberToHexColor(INERTIA_REFERENCE_BOX_COLOR);
}

export function shouldShowViewerInertiaLegend({
  hasSymmetryVisualization,
  showInertia,
  showReferenceGeometry,
  showStudioSceneChrome,
  thumbnailMode,
}: {
  hasSymmetryVisualization: boolean;
  showInertia: boolean;
  showReferenceGeometry: boolean;
  showStudioSceneChrome: boolean;
  thumbnailMode: boolean;
}): boolean {
  return (
    showStudioSceneChrome &&
    !thumbnailMode &&
    (showInertia || showReferenceGeometry || hasSymmetryVisualization)
  );
}
