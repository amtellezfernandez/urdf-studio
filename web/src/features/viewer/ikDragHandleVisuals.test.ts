import { describe, expect, it } from "vitest";
import { IK_DRAG_HANDLE_VISUAL_CONFIG } from "@/features/viewer/config";
import {
  resolveIkDragHandleColor,
  resolveIkDragHandleOpacity,
} from "@/features/viewer/ikDragHandleVisuals";

describe("ikDragHandleVisuals", () => {
  it("uses the studio blue handle color by default", () => {
    expect(
      resolveIkDragHandleColor({
        affectsHardware: false,
        isClamped: false,
        isDragging: false,
        isHovered: false,
      })
    ).toBe(IK_DRAG_HANDLE_VISUAL_CONFIG.colors.default);
  });

  it("keeps clamp warning color above interaction colors", () => {
    expect(
      resolveIkDragHandleColor({
        affectsHardware: true,
        isClamped: true,
        isDragging: false,
        isHovered: false,
      })
    ).toBe(IK_DRAG_HANDLE_VISUAL_CONFIG.colors.clamped);
  });

  it("uses hardware green when Studio IK commands affect follower hardware", () => {
    expect(
      resolveIkDragHandleColor({
        affectsHardware: true,
        isClamped: false,
        isDragging: false,
        isHovered: false,
      })
    ).toBe(IK_DRAG_HANDLE_VISUAL_CONFIG.colors.hardwareActive);
    expect(
      resolveIkDragHandleColor({
        affectsHardware: true,
        isClamped: false,
        isDragging: true,
        isHovered: false,
      })
    ).toBe(IK_DRAG_HANDLE_VISUAL_CONFIG.colors.hardwareHover);
  });

  it("resolves opacity from interaction state", () => {
    expect(
      resolveIkDragHandleOpacity({
        affectsHardware: false,
        isClamped: false,
        isDragging: false,
        isHovered: false,
      })
    ).toBe(IK_DRAG_HANDLE_VISUAL_CONFIG.opacity.idle);
    expect(
      resolveIkDragHandleOpacity({
        affectsHardware: false,
        isClamped: false,
        isDragging: false,
        isHovered: true,
      })
    ).toBe(IK_DRAG_HANDLE_VISUAL_CONFIG.opacity.hover);
    expect(
      resolveIkDragHandleOpacity({
        affectsHardware: true,
        isClamped: false,
        isDragging: true,
        isHovered: true,
      })
    ).toBe(IK_DRAG_HANDLE_VISUAL_CONFIG.opacity.draggingOrClamped);
  });
});
