import { describe, expect, it } from "vitest";
import type { CollisionEntry } from "@/shared/lib/urdfCore";
import {
  markAndCheckDuplicateCollisionEntry,
  toCollisionEntryDedupKey,
} from "@/features/viewer/collisionEntryDedup";

const createBoxCollision = (overrides?: Partial<CollisionEntry>): CollisionEntry => ({
  linkName: "base_link",
  index: 0,
  origin: {
    xyz: [0, 0, 0],
    rpy: [0, 0, 0],
  },
  geometry: {
    type: "box",
    size: [1, 1, 1],
  },
  ...overrides,
});

describe("collisionEntryDedup", () => {
  it("treats identical collision entries as duplicates", () => {
    const seen = new Set<string>();
    const entry = createBoxCollision();
    expect(markAndCheckDuplicateCollisionEntry(seen, entry)).toBe(false);
    expect(markAndCheckDuplicateCollisionEntry(seen, entry)).toBe(true);
  });

  it("does not dedupe different geometry payloads", () => {
    const seen = new Set<string>();
    const first = createBoxCollision();
    const second = createBoxCollision({
      geometry: {
        type: "box",
        size: [1, 2, 1],
      },
    });

    expect(markAndCheckDuplicateCollisionEntry(seen, first)).toBe(false);
    expect(markAndCheckDuplicateCollisionEntry(seen, second)).toBe(false);
  });

  it("dedup key ignores parse index and uses geometry pose payload", () => {
    const keyA = toCollisionEntryDedupKey(createBoxCollision({ index: 1 }));
    const keyB = toCollisionEntryDedupKey(createBoxCollision({ index: 99 }));
    expect(keyA).toBe(keyB);
  });
});
