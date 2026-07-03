import { describe, expect, it } from "vitest";

import {
  buildViewerInertiaLegendItems,
  buildViewerInertiaSeverityLegendItems,
  getViewerInertiaReferenceColor,
  shouldShowViewerInertiaLegend,
} from "@/features/viewer/components/viewerInertiaLegendState";

describe("viewerInertiaLegendState", () => {
  it("builds stable inertia legend colors from visualization params", () => {
    expect(buildViewerInertiaLegendItems()).toEqual([
      {
        key: "shape",
        label: "Shape fill",
        borderColor: "#4ade80",
        backgroundColor: "rgba(74, 222, 128, 0.22)",
        markerColor: null,
      },
      {
        key: "volume",
        label: "Volume outline",
        borderColor: "#4ade80",
        backgroundColor: "transparent",
        markerColor: null,
      },
      {
        key: "center",
        label: "Center offset",
        borderColor: "#ff6fae",
        backgroundColor: "transparent",
        markerColor: "#ff6fae",
      },
    ]);
  });

  it("builds severity and reference legend colors", () => {
    expect(buildViewerInertiaSeverityLegendItems()).toEqual([
      { key: "low", label: "Low", color: "#4ade80" },
      { key: "moderate", label: "Moderate", color: "#facc15" },
      { key: "high", label: "High", color: "#ff5a5a" },
    ]);
    expect(getViewerInertiaReferenceColor()).toBe("#f97316");
  });

  it("shows the legend only for visible studio overlays", () => {
    const base = {
      hasSymmetryVisualization: false,
      showInertia: false,
      showReferenceGeometry: false,
      showStudioSceneChrome: true,
      thumbnailMode: false,
    };

    expect(shouldShowViewerInertiaLegend(base)).toBe(false);
    expect(shouldShowViewerInertiaLegend({ ...base, showInertia: true })).toBe(true);
    expect(shouldShowViewerInertiaLegend({ ...base, showReferenceGeometry: true })).toBe(true);
    expect(shouldShowViewerInertiaLegend({ ...base, hasSymmetryVisualization: true })).toBe(true);
    expect(
      shouldShowViewerInertiaLegend({
        ...base,
        showInertia: true,
        showStudioSceneChrome: false,
      })
    ).toBe(false);
    expect(
      shouldShowViewerInertiaLegend({
        ...base,
        showInertia: true,
        thumbnailMode: true,
      })
    ).toBe(false);
  });
});
