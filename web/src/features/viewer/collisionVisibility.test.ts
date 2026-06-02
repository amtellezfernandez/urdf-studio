import { describe, expect, it } from "vitest";
import type { CollisionEntry } from "@/shared/lib/urdfCore";
import {
  hasRenderableCollisionEntries,
  isCollisionEntryVisible,
} from "@/features/viewer/collisionVisibility";

const BOX_COLLISION = (
  linkName: string,
  index: number
): CollisionEntry => ({
  linkName,
  index,
  origin: {
    xyz: [0, 0, 0],
    rpy: [0, 0, 0],
  },
  geometry: {
    type: "box",
    size: [1, 1, 1],
  },
});

describe("collisionVisibility", () => {
  it("treats unspecified visibility entries as visible", () => {
    expect(isCollisionEntryVisible({}, "base_link", 0)).toBe(true);
    expect(isCollisionEntryVisible({ base_link: {} }, "base_link", 0)).toBe(true);
  });

  it("hides only explicitly false entries", () => {
    expect(isCollisionEntryVisible({ base_link: { 0: false } }, "base_link", 0)).toBe(false);
    expect(isCollisionEntryVisible({ base_link: { 0: true } }, "base_link", 0)).toBe(true);
    expect(isCollisionEntryVisible({ base_link: { 0: false } }, "base_link", 1)).toBe(true);
  });

  it("detects whether at least one collision entry should render", () => {
    const collisionsByLink = {
      base_link: [BOX_COLLISION("base_link", 0), BOX_COLLISION("base_link", 1)],
      wrist_link: [BOX_COLLISION("wrist_link", 0)],
    };

    expect(hasRenderableCollisionEntries(collisionsByLink, {})).toBe(true);
    expect(
      hasRenderableCollisionEntries(collisionsByLink, {
        base_link: { 0: false, 1: false },
        wrist_link: { 0: false },
      })
    ).toBe(false);
    expect(
      hasRenderableCollisionEntries(collisionsByLink, {
        base_link: { 0: false, 1: false },
      })
    ).toBe(true);
  });
});
