import { describe, expect, it } from "vitest";
import {
  buildViewerChromePolicy,
  buildViewerUiPolicy,
} from "@/features/viewer/viewerUiPolicy";

describe("viewerUiPolicy", () => {
  it("builds active studio chrome policy with high-power rendering", () => {
    const policy = buildViewerChromePolicy({
      requestedGpuMode: "high",
      workspaceMode: "studio",
      thumbnailMode: false,
      readOnlyMode: false,
      showStudioChrome: true,
      hasStudioRobot: true,
      hasUrdfFile: true,
    });

    expect(policy.showSceneChrome).toBe(true);
    expect(policy.showEditableChrome).toBe(true);
    expect(policy.showStudioSceneChrome).toBe(true);
    expect(policy.showStudioEditableSceneChrome).toBe(true);
    expect(policy.showTopRightTools).toBe(true);
    expect(policy.canUseReadOnlyRoverGuide).toBe(false);
    expect(policy.effectiveGpuMode).toBe("high");
    expect(policy.enableShadows).toBe(true);
  });

  it("hides edit chrome and enables read-only rover guide in read-only studio views", () => {
    const policy = buildViewerChromePolicy({
      requestedGpuMode: "high",
      workspaceMode: "studio",
      thumbnailMode: false,
      readOnlyMode: true,
      showStudioChrome: true,
      hasStudioRobot: true,
      hasUrdfFile: true,
    });

    expect(policy.showSceneChrome).toBe(true);
    expect(policy.showEditableChrome).toBe(false);
    expect(policy.showStudioSceneChrome).toBe(true);
    expect(policy.showStudioEditableSceneChrome).toBe(false);
    expect(policy.showHeader).toBe(false);
    expect(policy.canUseReadOnlyRoverGuide).toBe(true);
    expect(policy.effectiveGpuMode).toBe("low");
  });

  it("turns off chrome for thumbnail mode", () => {
    const policy = buildViewerChromePolicy({
      requestedGpuMode: "high",
      workspaceMode: "studio",
      thumbnailMode: true,
      readOnlyMode: false,
      showStudioChrome: true,
      hasStudioRobot: true,
      hasUrdfFile: true,
    });

    expect(policy.showSceneChrome).toBe(false);
    expect(policy.showStudioSceneChrome).toBe(false);
    expect(policy.showTopRightTools).toBe(false);
    expect(policy.effectiveGpuMode).toBe("low");
  });

  it("shows IK handles only when every IK visibility input is ready", () => {
    const viewerPolicy = buildViewerChromePolicy({
      requestedGpuMode: "high",
      workspaceMode: "studio",
      thumbnailMode: false,
      readOnlyMode: false,
      showStudioChrome: true,
      hasStudioRobot: true,
      hasUrdfFile: true,
    });

    const visibleUi = buildViewerUiPolicy({
      viewerPolicy,
      showIkPanel: true,
      hasJointLimits: true,
      isWheelRolesOpen: false,
      ikHandlesReady: true,
      ikEndEffectorLinkCount: 1,
      ikDragEnabled: true,
      ikDragSuppressed: false,
      simulationPrepPanelOpen: false,
      hasUrdfContent: true,
      showWorldLayoutOverlays: true,
    });
    const blockedUi = buildViewerUiPolicy({
      viewerPolicy,
      showIkPanel: true,
      hasJointLimits: true,
      isWheelRolesOpen: false,
      ikHandlesReady: true,
      ikEndEffectorLinkCount: 1,
      ikDragEnabled: true,
      ikDragSuppressed: false,
      simulationPrepPanelOpen: true,
      hasUrdfContent: true,
      showWorldLayoutOverlays: true,
    });

    expect(visibleUi.showIkHandles).toBe(true);
    expect(visibleUi.showJointTypesPanel).toBe(true);
    expect(visibleUi.showEndEffectorSummary).toBe(true);
    expect(visibleUi.showCreatedObjects).toBe(true);
    expect(blockedUi.showIkHandles).toBe(false);
  });
});
