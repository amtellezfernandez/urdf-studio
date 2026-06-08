import { describe, expect, it } from "vitest";

import type { Episode } from "@/features/dataset";
import {
  buildDatasetEpisodeMjlabRecording,
  resolveDatasetMjlabValidationIssues,
  resolveDatasetEpisodeMjlabValidation,
  upsertDatasetEpisodeMjlabValidation,
  withDatasetEpisodeMjlabValidation,
} from "@/features/layout/sidebar/datasetMjlabValidation";

const TEST_EPISODE: Episode = {
  id: "recording-episode-1",
  number: 1,
  createdAt: 1_000,
  frames: [
    {
      timestamp: 0,
      jointPositions: {
        shoulder: 0.1,
        elbow: 0.2,
      },
    },
    {
      timestamp: 33.3,
      jointPositions: {
        shoulder: 0.15,
        elbow: Number.NaN,
      },
    },
  ],
  metadata: {
    tasks: ["fold a t-shirt"],
    fps: 30,
  },
};

describe("buildDatasetEpisodeMjlabRecording", () => {
  it("converts recorded dataset frames into MJLab joint target samples", () => {
    const recording = buildDatasetEpisodeMjlabRecording(TEST_EPISODE);

    expect(recording).toMatchObject({
      recordingId: TEST_EPISODE.id,
      taskLanguage: "fold a t-shirt",
      sampleCount: TEST_EPISODE.frames.length,
      samples: [
        {
          sampleIndex: 0,
          command: {
            kind: "joint_targets",
            jointTargets: {
              shoulder: 0.1,
              elbow: 0.2,
            },
          },
          metadata: {
            command_kind: "joint_targets",
            sequence: 1,
            source_ts_ms: 0,
          },
        },
        {
          sampleIndex: 1,
          command: {
            kind: "joint_targets",
            jointTargets: {
              shoulder: 0.15,
            },
          },
          metadata: {
            source_ts_ms: 33,
          },
        },
      ],
    });
  });
});

describe("dataset episode MJLab validation metadata", () => {
  it("stores and resolves MJLab validation on the episode metadata", () => {
    const validation = {
      phase: "rejected" as const,
      episodeId: TEST_EPISODE.id,
      message: "Episode rejected by MJLab.",
      issueSummaries: ["joint_velocity_limit: too fast"],
      issues: [
        {
          severity: "error" as const,
          code: "joint_velocity_limit",
          reason: "too fast",
          sampleIndex: 4,
          jointName: "joint_a",
          value: 4.2,
          limit: 2,
        },
      ],
    };
    const episode = withDatasetEpisodeMjlabValidation(
      TEST_EPISODE,
      validation,
    );

    expect(resolveDatasetEpisodeMjlabValidation(episode)).toEqual(validation);
  });

  it("parses MJLab issue summaries into structured markers", () => {
    const validation = {
      phase: "rejected" as const,
      episodeId: TEST_EPISODE.id,
      message: "Episode rejected by MJLab.",
      issueSummaries: [
        "joint_acceleration_limit (joint openarm_left_joint3, sample 2): MJLab trajectory exceeds joint acceleration limit. value 194.892 > limit 120.000",
      ],
    };

    expect(resolveDatasetMjlabValidationIssues(validation)).toEqual([
      {
        severity: "error",
        code: "joint_acceleration_limit",
        reason: "MJLab trajectory exceeds joint acceleration limit.",
        sampleIndex: 2,
        jointName: "openarm_left_joint3",
        value: 194.892,
        limit: 120,
      },
    ]);
  });

  it("updates only the matching episode in a dataset", () => {
    const otherEpisode = {
      ...TEST_EPISODE,
      id: "recording-episode-2",
      number: 2,
    };
    const validation = {
      phase: "passed" as const,
      episodeId: TEST_EPISODE.id,
      message: "Episode passed MJLab.",
    };

    const episodes = upsertDatasetEpisodeMjlabValidation(
      [TEST_EPISODE, otherEpisode],
      TEST_EPISODE.id,
      validation,
    );

    expect(resolveDatasetEpisodeMjlabValidation(episodes[0])).toEqual(
      validation,
    );
    expect(resolveDatasetEpisodeMjlabValidation(episodes[1])).toBeNull();
  });
});
