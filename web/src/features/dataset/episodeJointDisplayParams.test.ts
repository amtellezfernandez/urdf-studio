import { describe, expect, it } from "vitest";

import {
  EPISODE_BASE_SIGNAL_SUGGESTION_ORDER,
  hasDifferentEpisodeSignalMapping,
  getEpisodeSignalRelationDescription,
  getEpisodeSignalRelationLabel,
  isEpisodeBaseSignalName,
  normalizeEpisodeSignalName,
  resolveEpisodeSignalRelation,
} from "@/features/dataset/episodeJointDisplayParams";

describe("episodeJointDisplayParams", () => {
  it("keeps canonical base-signal suggestion order stable", () => {
    expect(EPISODE_BASE_SIGNAL_SUGGESTION_ORDER).toEqual([
      "x_mm",
      "y_mm",
      "theta",
    ]);
  });

  it("normalizes episode signal names for cross-episode matching", () => {
    expect(normalizeEpisodeSignalName("  Theta  ")).toBe("theta");
  });

  it("detects canonical base channels and aliases", () => {
    expect(isEpisodeBaseSignalName("x_mm")).toBe(true);
    expect(isEpisodeBaseSignalName("base_theta")).toBe(true);
    expect(isEpisodeBaseSignalName("wheel_left_joint")).toBe(false);
  });

  it("classifies signal relation for base, mapped, and auxiliary channels", () => {
    expect(
      resolveEpisodeSignalRelation({
        signalName: "x_mm",
        mappedJointName: null,
      })
    ).toBe("base-planar");
    expect(
      resolveEpisodeSignalRelation({
        signalName: "shoulder_pan",
        mappedJointName: "shoulder_pan",
      })
    ).toBe("mapped-joint");
    expect(
      resolveEpisodeSignalRelation({
        signalName: "custom_score",
        mappedJointName: null,
      })
    ).toBe("aux-unmapped");
  });

  it("provides stable relation labels and descriptions", () => {
    expect(getEpisodeSignalRelationLabel("base-planar")).toBe("base");
    expect(getEpisodeSignalRelationDescription("mapped-joint")).toContain(
      "URDF joint"
    );
  });

  it("detects when signal mapping differs from same-name joint mapping", () => {
    expect(
      hasDifferentEpisodeSignalMapping({
        signalName: "shoulder_pan",
        mappedJointName: "shoulder_pan",
      })
    ).toBe(false);
    expect(
      hasDifferentEpisodeSignalMapping({
        signalName: "left_wheel",
        mappedJointName: "left_wheel_joint",
      })
    ).toBe(true);
    expect(
      hasDifferentEpisodeSignalMapping({
        signalName: "x_mm",
        mappedJointName: null,
      })
    ).toBe(true);
  });
});
