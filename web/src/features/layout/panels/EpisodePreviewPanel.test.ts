import { describe, expect, it } from "vitest";

import { shouldShowOperatorLiveCameraInEpisodePreviewMode } from "@/features/layout/panels/episodePreviewPanelParams";

describe("shouldShowOperatorLiveCameraInEpisodePreviewMode", () => {
  it("keeps teleop live video in recorded mode only", () => {
    expect(shouldShowOperatorLiveCameraInEpisodePreviewMode("all")).toBe(false);
    expect(shouldShowOperatorLiveCameraInEpisodePreviewMode("focus")).toBe(false);
    expect(shouldShowOperatorLiveCameraInEpisodePreviewMode("list")).toBe(false);
    expect(shouldShowOperatorLiveCameraInEpisodePreviewMode("recorded")).toBe(true);
  });
});
