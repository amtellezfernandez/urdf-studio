import { describe, expect, it } from "vitest";

import {
  resolveDatasetSignalBaseMode,
  resolveDatasetSignalProfile,
} from "@/features/dataset/profiles/semanticDetection";

describe("resolveDatasetSignalProfile", () => {
  it("detects LeKiwi-style mixed semantics", () => {
    const profile = resolveDatasetSignalProfile({
      featureNames: [
        "arm_shoulder_pan.pos",
        "arm_shoulder_lift.pos",
        "arm_elbow_flex.pos",
        "arm_wrist_flex.pos",
        "arm_wrist_roll.pos",
        "arm_gripper.pos",
        "x.vel",
        "y.vel",
        "theta.vel",
      ],
      robotTypeHint: "lekiwi_client",
    });

    expect(profile.profileId).toBe("lekiwi_client");
    expect(profile.jointChannels).toHaveLength(6);
    expect(profile.planarTwistChannels.complete).toBe(true);
    expect(profile.planarTwistChannels.x?.index).toBe(6);
    expect(profile.planarTwistChannels.y?.index).toBe(7);
    expect(profile.planarTwistChannels.theta?.index).toBe(8);
    expect(resolveDatasetSignalBaseMode(profile)).toBe("twist");
  });

  it("detects LeKiwi planar base-pose channels in millimeters/degrees", () => {
    const profile = resolveDatasetSignalProfile({
      featureNames: [
        "shoulder_pan",
        "shoulder_lift",
        "elbow_flex",
        "wrist_flex",
        "wrist_roll",
        "gripper",
        "x_mm",
        "y_mm",
        "theta",
      ],
      robotTypeHint: "lekiwi",
    });

    expect(profile.profileId).toBe("lekiwi_client");
    expect(profile.jointChannels).toHaveLength(6);
    expect(profile.planarTwistChannels.complete).toBe(false);
    expect(profile.planarBasePoseChannels.complete).toBe(true);
    expect(profile.planarBasePoseChannels.xMm?.index).toBe(6);
    expect(profile.planarBasePoseChannels.yMm?.index).toBe(7);
    expect(profile.planarBasePoseChannels.thetaDeg?.index).toBe(8);
    expect(resolveDatasetSignalBaseMode(profile)).toBe("pose");
  });

  it("falls back to generated joint channels when names are missing", () => {
    const profile = resolveDatasetSignalProfile({
      featureNames: [],
      fallbackChannelCount: 3,
    });

    expect(profile.profileId).toBe("urdf_native");
    expect(profile.jointChannels.map((channel) => channel.normalizedName)).toEqual([
      "joint_0",
      "joint_1",
      "joint_2",
    ]);
  });

  it("does not reclassify standalone theta channels as base pose", () => {
    const profile = resolveDatasetSignalProfile({
      featureNames: ["theta", "joint_a.pos"],
    });

    expect(profile.planarBasePoseChannels.complete).toBe(false);
    expect(profile.jointChannels.map((channel) => channel.normalizedName)).toEqual([
      "theta",
      "joint_a",
    ]);
    expect(resolveDatasetSignalBaseMode(profile)).toBe("none");
  });
});
