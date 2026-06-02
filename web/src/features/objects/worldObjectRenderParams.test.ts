import { describe, expect, it } from "vitest";

import { DEFAULT_POINT_SIZE } from "@/features/objects/objectCreatorHelpers";
import { WORLD_OBJECT_RENDER_PARAMS } from "@/features/objects/worldObjectRenderParams";

describe("worldObjectRenderParams", () => {
  it("keeps point display diameter bound to the default point marker size", () => {
    expect(WORLD_OBJECT_RENDER_PARAMS.pointDisplayDiameterM).toBe(DEFAULT_POINT_SIZE);
  });

  it("defines explicit selection overlay tunables", () => {
    expect(WORLD_OBJECT_RENDER_PARAMS.selectionOverlayPaddingM).toBe(0.02);
    expect(WORLD_OBJECT_RENDER_PARAMS.selectionOverlayMinCubeSizeM).toBe(0.04);
    expect(WORLD_OBJECT_RENDER_PARAMS.selectionOverlayPointRadiusScale).toBe(1.35);
    expect(WORLD_OBJECT_RENDER_PARAMS.selectionOverlayMinPointRadiusM).toBe(0.03);
    expect(WORLD_OBJECT_RENDER_PARAMS.selectionOverlayOpacity).toBe(1);
    expect(WORLD_OBJECT_RENDER_PARAMS.selectionOverlayFillOpacity).toBe(0.12);
    expect(WORLD_OBJECT_RENDER_PARAMS.selectionOverlayColor).toBe("#ff6b6b");
  });
});
