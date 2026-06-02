import { describe, expect, it } from "vitest";

import type { JointMapping } from "@/shared/types/feature";
import {
  buildHfDatasetMappingState,
  HF_DATASET_TARGET_ZERO_SOURCE,
  resolveHfDatasetEpisodeFps,
  shouldApplyHfDatasetUrdf,
} from "@/features/layout/sidebar/hfDatasetLoadHelpers";

const HF_DATASET_LOAD_HELPER_TEST_FIXTURES = {
  noTargetRobotJointCount: 0,
  loadedTargetRobotJointCount: 6,
};

describe("resolveHfDatasetEpisodeFps", () => {
  it("uses measured duration when timing is valid", () => {
    expect(
      resolveHfDatasetEpisodeFps({
        frameCount: 31,
        durationMs: 1000,
      })
    ).toBe(30);
  });

  it("falls back when timing is not usable", () => {
    expect(
      resolveHfDatasetEpisodeFps({
        frameCount: 1,
        durationMs: 0,
      })
    ).toBe(30);
  });
});

describe("buildHfDatasetMappingState", () => {
  it("extracts mapping, offsets, inversions, and limit modes from valid URDF mappings", () => {
    const mappings: JointMapping[] = [
      {
        datasetJoint: "joint_a",
        urdfJoint: "shoulder",
        offset: 0.5,
        inverted: true,
        limitMode: "clamp",
      },
      {
        datasetJoint: "joint_b",
        urdfJoint: "?",
      },
      {
        datasetJoint: "joint_c",
        urdfJoint: "wrist",
      },
    ];

    expect(buildHfDatasetMappingState(mappings)).toEqual({
      jointMapping: {
        joint_a: "shoulder",
        joint_c: "wrist",
      },
      jointOffsets: {
        joint_a: 0.5,
      },
      jointInversions: {
        joint_a: true,
      },
      limitModesByJoint: {
        shoulder: "clamp",
      },
    });
  });
});

describe("HF dataset target robot policy", () => {
  it("keeps replay on the loaded target robot zero pose by default", () => {
    expect(HF_DATASET_TARGET_ZERO_SOURCE).toBe("auto");
  });

  it("applies a dataset URDF only when no target robot joints are loaded", () => {
    expect(
      shouldApplyHfDatasetUrdf({
        availableJointCount: HF_DATASET_LOAD_HELPER_TEST_FIXTURES.noTargetRobotJointCount,
        hasUrdfLoadHandler: true,
      })
    ).toBe(true);

    expect(
      shouldApplyHfDatasetUrdf({
        availableJointCount: HF_DATASET_LOAD_HELPER_TEST_FIXTURES.loadedTargetRobotJointCount,
        hasUrdfLoadHandler: true,
      })
    ).toBe(false);
  });

  it("does not apply a dataset URDF without a viewer load handler", () => {
    expect(
      shouldApplyHfDatasetUrdf({
        availableJointCount: HF_DATASET_LOAD_HELPER_TEST_FIXTURES.noTargetRobotJointCount,
        hasUrdfLoadHandler: false,
      })
    ).toBe(false);
  });
});
