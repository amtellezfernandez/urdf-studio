import { describe, expect, it } from "vitest";

import {
  buildHfEpisodeCollectionContentSignature,
  type DatasetSignalProfileResolution,
} from "@/features/dataset";
import {
  buildHfMappingDialogData,
  computeHfJointRanges,
  parseHfDatasetTargetInput,
  toHfDatasetNumericRows,
} from "@/features/layout/sidebar/hfDatasetImportHelpers";

const TEST_SIGNAL_PROFILE: DatasetSignalProfileResolution = {
  profileId: "mixed",
  profileVersion: "test",
  channels: [
    {
      index: 0,
      sourceName: "joint_a",
      normalizedName: "joint_a",
      semantic: "joint_position",
      confidence: "high",
    },
    {
      index: 1,
      sourceName: "base_vel_x",
      normalizedName: "base_vel_x",
      semantic: "base_twist_planar_x",
      confidence: "high",
    },
  ],
  jointChannels: [
    {
      index: 0,
      sourceName: "joint_a",
      normalizedName: "joint_a",
      semantic: "joint_position",
      confidence: "high",
    },
  ],
  planarTwistChannels: {
    x: {
      index: 1,
      sourceName: "base_vel_x",
      normalizedName: "base_vel_x",
      semantic: "base_twist_planar_x",
      confidence: "high",
    },
    y: null,
    theta: null,
    complete: false,
  },
  planarBasePoseChannels: {
    xMm: null,
    yMm: null,
    thetaDeg: null,
    complete: false,
  },
  report: {
    mappedChannels: 1,
    unmappedChannels: 1,
    unmappedNames: ["base_vel_x"],
    confidence: "medium",
  },
};

describe("parseHfDatasetTargetInput", () => {
  it("parses repository ids directly", () => {
    expect(parseHfDatasetTargetInput("openai/demo")).toEqual({
      owner: "openai",
      name: "demo",
      repoId: "openai/demo",
    });
  });

  it("parses full dataset URLs and ignores extra suffixes", () => {
    expect(
      parseHfDatasetTargetInput(
        "https://huggingface.co/datasets/openai/demo/tree/main?foo=bar"
      )
    ).toEqual({
      owner: "openai",
      name: "demo",
      repoId: "openai/demo",
    });
  });

  it("uses the default owner for short names", () => {
    expect(parseHfDatasetTargetInput("demo", "openai")).toEqual({
      owner: "openai",
      name: "demo",
      repoId: "openai/demo",
    });
  });
});

describe("HF dataset row helpers", () => {
  const sampleRows = [
    {
      timestamp: 1.25,
      "observation.state": [1.5, 7],
    },
    {
      timestamp: 2,
      "observation.state": [-0.5, 9],
    },
  ];

  it("converts rows to numeric rows with millisecond timestamps", () => {
    expect(toHfDatasetNumericRows(sampleRows, "observation.state")).toEqual([
      {
        timestampMs: 1250,
        values: [1.5, 7],
      },
      {
        timestampMs: 2000,
        values: [-0.5, 9],
      },
    ]);
  });

  it("computes joint ranges from mapped joint channels only", () => {
    expect(
      computeHfJointRanges(sampleRows, TEST_SIGNAL_PROFILE, "observation.state")
    ).toEqual({
      joint_a: { min: -0.5, max: 1.5 },
    });
  });

  it("builds stable content signatures from HF rows", () => {
    const first = buildHfEpisodeCollectionContentSignature({
      rows: [
        {
          episode_index: 1,
          frame_index: 1,
          timestamp: 2,
          "observation.state": [0.3, 9],
        },
        {
          episode_index: 0,
          frame_index: 0,
          timestamp: 1.25,
          "observation.state": [1.5, 7],
        },
      ],
      signalProfile: TEST_SIGNAL_PROFILE,
      preferredField: "observation.state",
    });
    const second = buildHfEpisodeCollectionContentSignature({
      rows: [
        {
          episode_index: 0,
          frame_index: 0,
          timestamp: 1.25,
          "observation.state": [1.5, 7],
        },
        {
          episode_index: 1,
          frame_index: 1,
          timestamp: 2,
          "observation.state": [0.3, 9],
        },
      ],
      signalProfile: TEST_SIGNAL_PROFILE,
      preferredField: "observation.state",
    });

    expect(first).toStrictEqual(second);
  });

  it("builds mapping dialog data with excluded non-joint channels", () => {
    expect(
      buildHfMappingDialogData({
        datasetJoints: ["joint_a"],
        jointRanges: { joint_a: { min: -0.5, max: 1.5 } },
        source: "hf:openai/demo:train",
        datasetPath: "openai/demo",
        signalField: "observation.state",
        signalProfile: TEST_SIGNAL_PROFILE,
      })
    ).toEqual({
      datasetJoints: ["joint_a"],
      jointRanges: { joint_a: { min: -0.5, max: 1.5 } },
      source: "hf:openai/demo:train",
      datasetPath: "openai/demo",
      signalField: "observation.state",
      signalProfileId: "mixed",
      excludedChannels: [
        {
          name: "base_vel_x",
          semantic: "base_twist_planar_x",
        },
      ],
    });
  });
});
