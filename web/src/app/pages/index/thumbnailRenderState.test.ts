/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";

import {
  readThumbnailRenderState,
  writeThumbnailRenderState,
} from "@/app/pages/index/thumbnailRenderState";

describe("thumbnailRenderState", () => {
  beforeEach(() => {
    writeThumbnailRenderState({}, { reset: true });
  });

  it("publishes a stable ready contract for thumbnail capture", () => {
    const state = writeThumbnailRenderState({
      phase: "ready",
      ready: true,
      hasBoundingBox: true,
      cameraApplied: true,
      cameraPosition: [1, 2, 3],
      cameraTarget: [4, 5, 6],
    });

    expect(state).toEqual({
      phase: "ready",
      ready: true,
      hasBoundingBox: true,
      cameraApplied: true,
      error: null,
      cameraPosition: [1, 2, 3],
      cameraTarget: [4, 5, 6],
    });
    expect(window.__URDF_GALLERY_RENDER_STATE__).toEqual(state);
    expect(window.__URDF_THUMB_READY__).toBe(true);
    expect(window.__URDF_THUMB_ERROR__).toBeUndefined();
    expect(document.body.getAttribute("data-urdf-thumb-ready")).toBe("1");
  });

  it("preserves error state until a reset clears it", () => {
    writeThumbnailRenderState({
      phase: "error",
      error: "load failed",
    });

    expect(readThumbnailRenderState().error).toBe("load failed");
    expect(window.__URDF_THUMB_ERROR__).toBe("load failed");
    expect(document.body.getAttribute("data-urdf-thumb-ready")).toBe("0");

    writeThumbnailRenderState({}, { reset: true });

    expect(readThumbnailRenderState()).toEqual({
      phase: "idle",
      ready: false,
      hasBoundingBox: false,
      cameraApplied: false,
      error: null,
      cameraPosition: null,
      cameraTarget: null,
    });
    expect(window.__URDF_THUMB_ERROR__).toBeUndefined();
    expect(document.body.hasAttribute("data-urdf-thumb-ready")).toBe(false);
  });
});
