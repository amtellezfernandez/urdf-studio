import { describe, expect, it } from "vitest";

import {
  shouldPrepareDemoWorldLayoutOnMotion,
  shouldPreserveDemoWorldLayoutOnMotion,
} from "@/app/pages/index/demoMotionPolicy";

describe("shouldPrepareDemoWorldLayoutOnMotion", () => {
  it("prepares the scene when the manifest requests demo world layout", () => {
    expect(shouldPrepareDemoWorldLayoutOnMotion(true)).toBe(true);
  });

  it("skips scene preparation by default", () => {
    expect(shouldPrepareDemoWorldLayoutOnMotion(false)).toBe(false);
  });
});

describe("shouldPreserveDemoWorldLayoutOnMotion", () => {
  it("preserves scenario ownership while loading bundled demo assets", () => {
    expect(
      shouldPreserveDemoWorldLayoutOnMotion({
        hasLoadedFiles: false,
        preserveDemoWorldLayoutOnMotion: false,
      })
    ).toBe(true);
  });

  it("preserves scenario ownership when the manifest requests it", () => {
    expect(
      shouldPreserveDemoWorldLayoutOnMotion({
        hasLoadedFiles: true,
        preserveDemoWorldLayoutOnMotion: true,
      })
    ).toBe(true);
  });

  it("does not suppress default world layout for ordinary loaded robots", () => {
    expect(
      shouldPreserveDemoWorldLayoutOnMotion({
        hasLoadedFiles: true,
        preserveDemoWorldLayoutOnMotion: false,
      })
    ).toBe(false);
  });
});
