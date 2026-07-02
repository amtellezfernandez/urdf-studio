import { describe, expect, it } from "vitest";
import {
  canUseViewerDragHandleMode,
  doesViewerDragModeUseIkHandles,
  resolveEffectiveViewerDragMode,
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

  it("only enables IK handles for drag-handle mode", () => {
    expect(doesViewerDragModeUseIkHandles("move-joints")).toBe(false);
    expect(doesViewerDragModeUseIkHandles("drag-handle")).toBe(true);
  });
});
