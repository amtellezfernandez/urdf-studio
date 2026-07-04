import { describe, expect, it } from "vitest";

import {
  isJointResetShortcut,
  resolveJointDragCursor,
  resolveJointDragDelta,
  resolveJointDragDirection,
} from "@/features/layout/jointValueInteractionHelpers";

describe("jointValueInteractionHelpers", () => {
  it("keeps drag direction undecided until the threshold is crossed", () => {
    expect(
      resolveJointDragDirection({
        deltaX: 2,
        deltaY: 1,
        previousDirection: "undecided",
      })
    ).toBe("undecided");
    expect(
      resolveJointDragDirection({
        deltaX: 5,
        deltaY: 1,
        previousDirection: "undecided",
      })
    ).toBe("horizontal");
    expect(
      resolveJointDragDirection({
        deltaX: 1,
        deltaY: 5,
        previousDirection: "undecided",
      })
    ).toBe("vertical");
  });

  it("preserves an already chosen drag direction", () => {
    expect(
      resolveJointDragDirection({
        deltaX: 0,
        deltaY: 0,
        previousDirection: "horizontal",
      })
    ).toBe("horizontal");
  });

  it("resolves the drag cursor and delta from the direction", () => {
    expect(resolveJointDragCursor("horizontal")).toBe("ew-resize");
    expect(resolveJointDragCursor("vertical")).toBe("ns-resize");
    expect(
      resolveJointDragDelta({
        deltaX: 4,
        deltaY: 7,
        direction: "horizontal",
      })
    ).toBe(4);
    expect(
      resolveJointDragDelta({
        deltaX: 4,
        deltaY: 7,
        direction: "vertical",
      })
    ).toBe(7);
  });

  it("detects reset shortcuts", () => {
    expect(isJointResetShortcut({ altKey: true, key: "r" })).toBe(true);
    expect(isJointResetShortcut({ altKey: true, key: "0" })).toBe(true);
    expect(isJointResetShortcut({ altKey: false, key: "r" })).toBe(false);
  });
});
