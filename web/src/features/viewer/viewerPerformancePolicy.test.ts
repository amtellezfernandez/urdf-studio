import { describe, expect, it } from "vitest";

import {
  buildViewerRenderPerformancePolicy,
  resolveEffectiveViewerGpuMode,
} from "@/features/viewer/viewerPerformancePolicy";

describe("viewerPerformancePolicy", () => {
  it("defaults runtime, assembly, thumbnails, and read-only views to low GPU", () => {
    expect(
      resolveEffectiveViewerGpuMode({
        requestedGpuMode: "high",
        workspaceMode: "runtime",
        thumbnailMode: false,
        readOnlyMode: false,
      })
    ).toBe("low");
    expect(
      resolveEffectiveViewerGpuMode({
        requestedGpuMode: "high",
        workspaceMode: "assembly",
        thumbnailMode: false,
        readOnlyMode: false,
      })
    ).toBe("low");
    expect(
      resolveEffectiveViewerGpuMode({
        requestedGpuMode: "high",
        workspaceMode: "studio",
        thumbnailMode: true,
        readOnlyMode: false,
      })
    ).toBe("low");
    expect(
      resolveEffectiveViewerGpuMode({
        requestedGpuMode: "high",
        workspaceMode: "studio",
        thumbnailMode: false,
        readOnlyMode: true,
      })
    ).toBe("low");
  });

  it("keeps high GPU available only for active studio editing and caps DPR", () => {
    const policy = buildViewerRenderPerformancePolicy({
      requestedGpuMode: "high",
      workspaceMode: "studio",
      thumbnailMode: false,
      readOnlyMode: false,
      showStudioSceneChrome: true,
    });

    expect(policy.effectiveGpuMode).toBe("high");
    expect(policy.canvasDpr).toEqual([1, 1.5]);
    expect(policy.canvasPowerPreference).toBe("high-performance");
    expect(policy.enableCanvasAntialias).toBe(true);
    expect(policy.enableShadows).toBe(true);
    expect(policy.canPublishLiveRobotBasePose).toBe(true);
    expect(policy.canRunStudioWheelDrive).toBe(true);
  });

  it("uses a low-power policy outside active studio editing", () => {
    const policy = buildViewerRenderPerformancePolicy({
      requestedGpuMode: "high",
      workspaceMode: "runtime",
      thumbnailMode: false,
      readOnlyMode: false,
      showStudioSceneChrome: true,
    });

    expect(policy.effectiveGpuMode).toBe("low");
    expect(policy.canvasDpr).toEqual([0.75, 1]);
    expect(policy.canvasPowerPreference).toBe("low-power");
    expect(policy.enableCanvasAntialias).toBe(false);
    expect(policy.enableShadows).toBe(false);
    expect(policy.canPublishLiveRobotBasePose).toBe(false);
    expect(policy.canRunStudioWheelDrive).toBe(false);
  });
});
