import { describe, expect, it } from "vitest";

import {
  resolveThumbnailHintedPath,
  selectThumbnailCandidate,
} from "@/app/pages/index/thumbnailBootstrap";

describe("resolveThumbnailHintedPath", () => {
  it("prefers the repository path when present", () => {
    expect(resolveThumbnailHintedPath("robots/demo", "urdf/demo.urdf")).toBe("robots/demo");
  });

  it("derives a hinted path from nested URDF targets", () => {
    expect(resolveThumbnailHintedPath(undefined, "robots/demo/urdf/demo.urdf")).toBe(
      "robots/demo/urdf"
    );
  });

  it("returns an empty hint for flat targets", () => {
    expect(resolveThumbnailHintedPath(undefined, "demo.urdf")).toBe("");
  });
});

describe("selectThumbnailCandidate", () => {
  it("prefers a path suffix match over the first candidate", () => {
    const candidates = [
      { name: "fallback.urdf", path: "robots/fallback.urdf" },
      { name: "demo.urdf", path: "robots/demo/urdf/demo.urdf" },
    ];

    expect(selectThumbnailCandidate(candidates, "urdf/demo.urdf")).toEqual(candidates[1]);
  });

  it("falls back to a file name match", () => {
    const candidates = [
      { name: "fallback.urdf", path: "robots/fallback.urdf" },
      { name: "demo.urdf", path: "robots/demo/urdf/other-name.urdf" },
    ];

    expect(selectThumbnailCandidate(candidates, "demo.urdf")).toEqual(candidates[1]);
  });

  it("returns the first candidate when no target matches", () => {
    const candidates = [
      { name: "fallback.urdf", path: "robots/fallback.urdf" },
      { name: "demo.urdf", path: "robots/demo/urdf/demo.urdf" },
    ];

    expect(selectThumbnailCandidate(candidates, "missing.urdf")).toEqual(candidates[0]);
  });
});
