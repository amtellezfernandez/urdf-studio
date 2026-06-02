import { describe, expect, it } from "vitest";

import {
  isGalleryJobActive,
  resolveGalleryStatusLabel,
  sanitizeGalleryErrorMessage,
} from "@/features/dataset/iluGalleryParams";

describe("isGalleryJobActive", () => {
  it("treats queued and running jobs as active", () => {
    expect(isGalleryJobActive("queued")).toBe(true);
    expect(isGalleryJobActive("running")).toBe(true);
  });

  it("treats completed and failed jobs as inactive", () => {
    expect(isGalleryJobActive("completed")).toBe(false);
    expect(isGalleryJobActive("failed")).toBe(false);
  });
});

describe("resolveGalleryStatusLabel", () => {
  it("returns the inspection label for an active scan", () => {
    expect(resolveGalleryStatusLabel("running", "inspect")).toBe("Scanning repository robots...");
  });
});

describe("sanitizeGalleryErrorMessage", () => {
  it("rewrites raw missing-target Playwright errors into a sane gallery message", () => {
    expect(
      sanitizeGalleryErrorMessage(
        "page.waitForFunction: Error: Unable to find the requested URDF target in the GitHub repository.",
        {
          owner: "google-deepmind",
          repo: "mujoco_menagerie",
        }
      )
    ).toBe(
      "The live GitHub source https://github.com/google-deepmind/mujoco_menagerie does not expose a loadable URDF/Xacro target for gallery rendering. This source may only contain MuJoCo MJCF/XML assets or other non-URDF files."
    );
  });
});
