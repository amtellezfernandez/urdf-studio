import {
  INERTIA_CENTER_MARKER_MAX_SCALE,
  INERTIA_CENTER_MARKER_MIN_MISMATCH,
  INERTIA_CENTER_MARKER_MIN_SCALE,
  INERTIA_CENTER_MARKER_OUTSIDE_SCALE_BOOST,
  INERTIA_METRIC_PROBLEMATIC_THRESHOLD,
  INERTIA_METRIC_UNVERIFIED_COLOR,
  INERTIA_METRIC_WARNING_THRESHOLD,
  INERTIA_SHAPE_FILL_COLOR_HEALTHY,
  INERTIA_SHAPE_FILL_COLOR_PROBLEMATIC,
  INERTIA_SHAPE_FILL_COLOR_WARNING,
  INERTIA_VOLUME_EDGE_COLOR_HEALTHY,
  INERTIA_VOLUME_EDGE_COLOR_PROBLEMATIC,
  INERTIA_VOLUME_EDGE_COLOR_WARNING,
} from "@/features/viewer/inertialVisualizationParams";

export type InertiaMetricSeverity = "healthy" | "warning" | "problematic";

export const resolveInertiaMetricSeverity = (value: number | null | undefined): InertiaMetricSeverity | "unverified" => {
  if (value == null || Number.isNaN(value)) {
    return "unverified";
  }
  if (value >= INERTIA_METRIC_PROBLEMATIC_THRESHOLD) {
    return "problematic";
  }
  if (value >= INERTIA_METRIC_WARNING_THRESHOLD) {
    return "warning";
  }
  return "healthy";
};

const resolveMetricColor = (
  value: number | null | undefined,
  palette: Record<InertiaMetricSeverity, number>
): number => {
  const severity = resolveInertiaMetricSeverity(value);
  if (severity === "unverified") {
    return INERTIA_METRIC_UNVERIFIED_COLOR;
  }
  return palette[severity];
};

export const resolveInertiaShapeFillColor = (value: number | null | undefined): number =>
  resolveMetricColor(value, {
    healthy: INERTIA_SHAPE_FILL_COLOR_HEALTHY,
    warning: INERTIA_SHAPE_FILL_COLOR_WARNING,
    problematic: INERTIA_SHAPE_FILL_COLOR_PROBLEMATIC,
  });

export const resolveInertiaVolumeEdgeColor = (value: number | null | undefined): number =>
  resolveMetricColor(value, {
    healthy: INERTIA_VOLUME_EDGE_COLOR_HEALTHY,
    warning: INERTIA_VOLUME_EDGE_COLOR_WARNING,
    problematic: INERTIA_VOLUME_EDGE_COLOR_PROBLEMATIC,
  });

export const resolveInertiaCenterMarkerScale = ({
  centerMismatch,
  centerOfMassOutsideReference,
}: {
  centerMismatch: number | null | undefined;
  centerOfMassOutsideReference?: boolean;
}): number => {
  if (
    centerMismatch == null ||
    Number.isNaN(centerMismatch) ||
    centerMismatch < INERTIA_CENTER_MARKER_MIN_MISMATCH
  ) {
    return 0;
  }

  const clampedSeverity = Math.min(
    1,
    centerMismatch / INERTIA_METRIC_PROBLEMATIC_THRESHOLD
  );
  const baseScale =
    INERTIA_CENTER_MARKER_MIN_SCALE +
    (INERTIA_CENTER_MARKER_MAX_SCALE - INERTIA_CENTER_MARKER_MIN_SCALE) * clampedSeverity;

  return centerOfMassOutsideReference
    ? baseScale * INERTIA_CENTER_MARKER_OUTSIDE_SCALE_BOOST
    : baseScale;
};
