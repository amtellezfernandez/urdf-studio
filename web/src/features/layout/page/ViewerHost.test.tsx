/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/runtime_engine/rosviz/session/runtimeSelector", () => ({
  canUseWebGpu: vi.fn(),
  getRosVizRuntimeDecision: vi.fn(),
}));

vi.mock("@/shared/config/featureFlags", () => ({
  isFeatureFlagEnabled: vi.fn(),
  subscribeFeatureFlags: vi.fn(() => () => {}),
}));

vi.mock("@/shared/lib/featureGateUi", () => ({
  useFeatureGateAvailability: vi.fn(),
}));

vi.mock("@/features/viewer/ViewerErrorBoundary", async () => {
  const React = await import("react");
  return {
    ViewerErrorBoundary: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-viewer-error-boundary": "true" }, children),
  };
});

vi.mock("@/features/viewer/Viewer3D", async () => {
  const React = await import("react");
  return {
    Viewer3D: ({
      preferStudioRuntime,
      thumbnailMode,
    }: {
      preferStudioRuntime?: boolean;
      thumbnailMode?: boolean;
    }) =>
      React.createElement("div", {
        "data-viewer-3d": `${String(preferStudioRuntime ?? false)}:${String(
          thumbnailMode ?? false
        )}`,
      }),
  };
});

vi.mock("@/studio_ui/rosviz/RosVizViewer", async () => {
  const React = await import("react");
  return {
    RosVizViewer: ({
      preferStudioRuntime,
      thumbnailMode,
    }: {
      preferStudioRuntime?: boolean;
      thumbnailMode?: boolean;
    }) =>
      React.createElement("div", {
        "data-rosviz-viewer": `${String(preferStudioRuntime ?? false)}:${String(
          thumbnailMode ?? false
        )}`,
      }),
  };
});

import { ViewerHost } from "@/features/layout/page/ViewerHost";
import {
  canUseWebGpu,
  getRosVizRuntimeDecision,
} from "@/runtime_engine/rosviz/session/runtimeSelector";
import { isFeatureFlagEnabled } from "@/shared/config/featureFlags";
import { useFeatureGateAvailability } from "@/shared/lib/featureGateUi";

const mockCanUseWebGpu = vi.mocked(canUseWebGpu);
const mockGetRosVizRuntimeDecision = vi.mocked(getRosVizRuntimeDecision);
const mockIsFeatureFlagEnabled = vi.mocked(isFeatureFlagEnabled);
const mockUseFeatureGateAvailability = vi.mocked(useFeatureGateAvailability);

const createViewerProps = () =>
  ({
    preferStudioRuntime: false,
    thumbnailMode: false,
  }) as Parameters<typeof ViewerHost>[0]["viewerProps"];

const renderViewerHost = async () => {
  const container = document.createElement("div");
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(ViewerHost, {
        viewerKey: "robot-1",
        viewerProps: createViewerProps(),
      })
    );
  });

  return { container, root };
};

describe("ViewerHost", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mockCanUseWebGpu.mockReturnValue(true);
    mockIsFeatureFlagEnabled.mockReturnValue(false);
    mockUseFeatureGateAvailability.mockReturnValue({
      kind: "availability",
      enabled: true,
      unavailableSuffix: "",
      unavailableReason: "",
      disabledBadge: "",
      requiredBackends: [],
    });
    mockGetRosVizRuntimeDecision.mockReturnValue({
      runtime: "studio3D",
      reason: "flag_disabled",
      message: "Studio 3D renderer is active.",
    });
  });

  it("renders the Studio 3D viewer when ROS Viz is not selected", async () => {
    const { container, root } = await renderViewerHost();

    expect(container.querySelector('[data-viewer-error-boundary="true"]')).toBeTruthy();
    expect(container.querySelector('[data-viewer-3d="false:false"]')).toBeTruthy();
    expect(container.querySelector("[data-rosviz-viewer]")).toBeNull();
    expect(mockGetRosVizRuntimeDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        rosVizFlagEnabled: false,
        rosVizGateEnabled: true,
        webGpuSupported: true,
      })
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("renders the ROS Viz viewer when the runtime decision enables it", async () => {
    mockIsFeatureFlagEnabled.mockReturnValue(true);
    mockGetRosVizRuntimeDecision.mockReturnValue({
      runtime: "rosViz",
      reason: "enabled",
      message: "ROS Viz renderer is enabled.",
    });

    const { container, root } = await renderViewerHost();

    expect(container.querySelector('[data-rosviz-viewer="false:false"]')).toBeTruthy();
    expect(container.querySelector("[data-viewer-3d]")).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
