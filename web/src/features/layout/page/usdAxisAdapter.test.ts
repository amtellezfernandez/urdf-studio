import { describe, expect, it } from "vitest";

import { resolveAxisAdapter } from "../../../../public/usd-viewer/usdUtils.js";

describe("resolveAxisAdapter", () => {
  it("maps a declared Y-up stage into the canonical Z-up workspace", () => {
    const adapter = resolveAxisAdapter("Y", "z");

    expect(adapter).toMatchObject({
      sourceUpAxis: "y",
      targetUpAxis: "z",
      applied: true,
      confidence: "declared",
    });
    expect(adapter.rotationEuler[0]).toBeCloseTo(Math.PI / 2);
  });

  it("does not add a transform when the source already matches", () => {
    expect(resolveAxisAdapter("z", "z")).toMatchObject({
      applied: false,
      rotationEuler: [0, 0, 0],
      warning: null,
    });
  });

  it("keeps unknown source axes visible instead of guessing", () => {
    expect(resolveAxisAdapter(undefined, "z")).toMatchObject({
      applied: false,
      confidence: "unknown",
    });
  });
});
