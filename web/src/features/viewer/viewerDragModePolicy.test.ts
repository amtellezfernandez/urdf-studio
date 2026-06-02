import { describe, expect, it } from "vitest";
import {
  canUseViewerDragHandleMode,
  canUseViewerLeaderTeleopMode,
  doesViewerDragModeUseIkHandles,
  resolveEffectiveViewerDragMode,
  shouldResetPoseAfterLeaderTeleopFallback,
} from "@/features/viewer/viewerDragModePolicy";

describe("viewerDragModePolicy", () => {
  it("forces move-joints while simulation prep is open", () => {
    expect(
      resolveEffectiveViewerDragMode({
        dragMode: "drag-handle",
        isAssemblyWorkspace: false,
        simulationPrepPanelOpen: true,
      })
    ).toBe("move-joints");
    expect(
      canUseViewerDragHandleMode({
        isAssemblyWorkspace: false,
        simulationPrepPanelOpen: true,
      })
    ).toBe(false);
  });

  it("keeps drag-handle available in normal studio mode", () => {
    expect(
      resolveEffectiveViewerDragMode({
        dragMode: "drag-handle",
        isAssemblyWorkspace: false,
        simulationPrepPanelOpen: false,
      })
    ).toBe("drag-handle");
    expect(
      canUseViewerDragHandleMode({
        isAssemblyWorkspace: false,
        simulationPrepPanelOpen: false,
      })
    ).toBe(true);
  });

  it("falls back from Leader Teleop to IK drag when leader input disconnects", () => {
    expect(
      resolveEffectiveViewerDragMode({
        dragMode: "hardware-teleop",
        leaderTeleopAvailable: false,
        isAssemblyWorkspace: false,
      })
    ).toBe("drag-handle");
    expect(
      resolveEffectiveViewerDragMode({
        dragMode: "hardware-teleop",
        leaderTeleopAvailable: true,
        isAssemblyWorkspace: false,
      })
    ).toBe("hardware-teleop");
    expect(
      canUseViewerLeaderTeleopMode({
        leaderTeleopAvailable: true,
        isAssemblyWorkspace: true,
      })
    ).toBe(false);
    expect(
      resolveEffectiveViewerDragMode({
        dragMode: "hardware-teleop",
        leaderTeleopAvailable: false,
        isAssemblyWorkspace: true,
      })
    ).toBe("move-joints");
  });

  it("disables IK handles while Leader Teleop mode is active", () => {
    expect(doesViewerDragModeUseIkHandles("move-joints")).toBe(false);
    expect(doesViewerDragModeUseIkHandles("drag-handle")).toBe(true);
    expect(doesViewerDragModeUseIkHandles("hardware-teleop")).toBe(false);
  });

  it("resets pose only when Leader Teleop falls back into IK drag", () => {
    expect(
      shouldResetPoseAfterLeaderTeleopFallback({
        previousDragMode: "hardware-teleop",
        currentDragMode: "drag-handle",
        leaderTeleopAvailable: false,
      }),
    ).toBe(true);
    expect(
      shouldResetPoseAfterLeaderTeleopFallback({
        previousDragMode: "hardware-teleop",
        currentDragMode: "move-joints",
        leaderTeleopAvailable: false,
      }),
    ).toBe(false);
    expect(
      shouldResetPoseAfterLeaderTeleopFallback({
        previousDragMode: "drag-handle",
        currentDragMode: "drag-handle",
        leaderTeleopAvailable: false,
      }),
    ).toBe(false);
    expect(
      shouldResetPoseAfterLeaderTeleopFallback({
        previousDragMode: "hardware-teleop",
        currentDragMode: "drag-handle",
        leaderTeleopAvailable: true,
      }),
    ).toBe(false);
  });
});
