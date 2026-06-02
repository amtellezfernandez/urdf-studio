import { describe, expect, it } from "vitest";

import {
  resolveInertiaCenterMarkerScale,
  resolveInertiaMetricSeverity,
  resolveInertiaShapeFillColor,
  resolveInertiaVolumeEdgeColor,
} from "@/features/viewer/inertialVisualizationColor";
import {
  INERTIA_CENTER_MARKER_MIN_MISMATCH,
  INERTIA_METRIC_UNVERIFIED_COLOR,
  INERTIA_SHAPE_FILL_COLOR_HEALTHY,
  INERTIA_SHAPE_FILL_COLOR_PROBLEMATIC,
  INERTIA_SHAPE_FILL_COLOR_WARNING,
  INERTIA_VOLUME_EDGE_COLOR_HEALTHY,
  INERTIA_VOLUME_EDGE_COLOR_PROBLEMATIC,
  INERTIA_VOLUME_EDGE_COLOR_WARNING,
} from "@/features/viewer/inertialVisualizationParams";

describe("resolveInertiaMetricSeverity", () => {
  it("marks low metric values as healthy", () => {
    expect(resolveInertiaMetricSeverity(0.05)).toBe("healthy");
  });

  it("marks mid metric values as warning", () => {
    expect(resolveInertiaMetricSeverity(0.3)).toBe("warning");
  });

  it("marks high metric values as problematic", () => {
    expect(resolveInertiaMetricSeverity(0.8)).toBe("problematic");
  });

  it("falls back to unverified when no metric value exists", () => {
    expect(resolveInertiaMetricSeverity(undefined)).toBe("unverified");
  });
});

describe("metric color resolvers", () => {
  it("maps shape fill severity to the shape palette", () => {
    expect(resolveInertiaShapeFillColor(0.05)).toBe(INERTIA_SHAPE_FILL_COLOR_HEALTHY);
    expect(resolveInertiaShapeFillColor(0.3)).toBe(INERTIA_SHAPE_FILL_COLOR_WARNING);
    expect(resolveInertiaShapeFillColor(0.8)).toBe(INERTIA_SHAPE_FILL_COLOR_PROBLEMATIC);
  });

  it("maps volume edge severity to the edge palette", () => {
    expect(resolveInertiaVolumeEdgeColor(0.05)).toBe(INERTIA_VOLUME_EDGE_COLOR_HEALTHY);
    expect(resolveInertiaVolumeEdgeColor(0.3)).toBe(INERTIA_VOLUME_EDGE_COLOR_WARNING);
    expect(resolveInertiaVolumeEdgeColor(0.8)).toBe(INERTIA_VOLUME_EDGE_COLOR_PROBLEMATIC);
  });

  it("uses a neutral fallback color when geometry metrics are unavailable", () => {
    expect(resolveInertiaShapeFillColor(undefined)).toBe(INERTIA_METRIC_UNVERIFIED_COLOR);
    expect(resolveInertiaVolumeEdgeColor(undefined)).toBe(INERTIA_METRIC_UNVERIFIED_COLOR);
  });
});

describe("resolveInertiaCenterMarkerScale", () => {
  it("suppresses the center marker when the center mismatch is negligible", () => {
    expect(
      resolveInertiaCenterMarkerScale({
        centerMismatch: INERTIA_CENTER_MARKER_MIN_MISMATCH / 2,
      })
    ).toBe(0);
  });

  it("grows the center marker as the center mismatch increases", () => {
    const moderateScale = resolveInertiaCenterMarkerScale({ centerMismatch: 0.2 });
    const severeScale = resolveInertiaCenterMarkerScale({ centerMismatch: 0.5 });
    expect(moderateScale).toBeGreaterThan(0);
    expect(severeScale).toBeGreaterThan(moderateScale);
  });

  it("boosts the center marker when the COM leaves the reference bounds", () => {
    const insideScale = resolveInertiaCenterMarkerScale({ centerMismatch: 0.3 });
    const outsideScale = resolveInertiaCenterMarkerScale({
      centerMismatch: 0.3,
      centerOfMassOutsideReference: true,
    });
    expect(outsideScale).toBeGreaterThan(insideScale);
  });
});
