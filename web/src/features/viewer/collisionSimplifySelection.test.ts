import { describe, expect, it } from "vitest";
import { applyCollisionSimplifyToSelectedLinks } from "@/features/viewer/collisionSimplifySelection";

describe("collisionSimplifySelection", () => {
  it("adds selected links to simplify list when enabling simplify", () => {
    const result = applyCollisionSimplifyToSelectedLinks(
      ["base_link"],
      ["arm_link", "base_link"],
      true
    );
    expect(result).toEqual(["arm_link", "base_link"]);
  });

  it("removes selected links from simplify list when disabling simplify", () => {
    const result = applyCollisionSimplifyToSelectedLinks(
      ["arm_link", "base_link", "wrist_link"],
      ["arm_link", "wrist_link"],
      false
    );
    expect(result).toEqual(["base_link"]);
  });
});
