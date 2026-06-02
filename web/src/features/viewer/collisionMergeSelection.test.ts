import { describe, expect, it } from "vitest";
import {
  removeMergedCollisionLinks,
  replaceMergedCollisionLinks,
} from "@/features/viewer/collisionMergeSelection";

describe("collisionMergeSelection", () => {
  it("replaces merged group with selected links", () => {
    const result = replaceMergedCollisionLinks([
      "arm_link",
      "base_link",
      "arm_link",
      "wrist_link",
    ]);
    expect(result).toEqual(["arm_link", "base_link", "wrist_link"]);
  });

  it("removes selected links from existing merged group", () => {
    const result = removeMergedCollisionLinks(
      ["arm_link", "base_link", "wrist_link"],
      ["arm_link", "wrist_link"]
    );
    expect(result).toEqual(["base_link"]);
  });
});

