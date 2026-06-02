import { describe, expect, it } from "vitest";

import { createEpisode } from "@/features/dataset";
import {
  applyTargetFpsToEpisodes,
  buildEpisodeSaveResult,
  computeEpisodeFps,
  resampleEpisodeToFps,
} from "@/features/layout/sidebar/episodeReviewHelpers";

const FIXED_NOW = 1_700_000_000_000;
const TARGET_FPS = 2;
const MIDDLE_FRAME_INDEX = 1;

describe("resampleEpisodeToFps", () => {
  it("preserves and interpolates base pose when resampling", () => {
    const episode = createEpisode(
      "episode-1",
      1,
      [
        {
          timestamp: 0,
          jointPositions: { wheel_left_joint: 0 },
          basePose: {
            position: { x: 0, y: 0, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
          },
        },
        {
          timestamp: 1000,
          jointPositions: { wheel_left_joint: 1 },
          basePose: {
            position: { x: 1, y: 0, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
          },
        },
      ],
      undefined
    );

    const resampled = resampleEpisodeToFps(episode, TARGET_FPS);

    expect(resampled.frames).toHaveLength(3);
    expect(
      resampled.frames[MIDDLE_FRAME_INDEX]?.jointPositions.wheel_left_joint
    ).toBeCloseTo(0.5);
    expect(resampled.frames[MIDDLE_FRAME_INDEX]?.basePose?.position.x).toBeCloseTo(
      0.5
    );
  });
});

describe("buildEpisodeSaveResult", () => {
  it("creates a new edited episode and strips hfLazy metadata", () => {
    const originalEpisode = createEpisode(
      "episode-source",
      1,
      [{ timestamp: 0, jointPositions: { joint_a: 0 } }],
      {
        additional: {
          hfLazy: { chunk: 3 },
          sourceType: "recorded",
          sourceName: "Original recording",
        },
      }
    );

    const result = buildEpisodeSaveResult({
      previousEpisodes: [originalEpisode],
      episodeToSave: originalEpisode,
      saveAsNew: true,
      now: FIXED_NOW,
      createEpisodeId: () => "episode-edited",
    });

    expect(result.errorMessage).toBeNull();
    expect(result.savedEpisode?.id).toBe("episode-edited");
    expect(result.savedEpisode?.metadata?.additional).toMatchObject({
      sourceType: "recorded",
      sourceName: "Original recording",
      parentEpisodeId: "episode-source",
      isEdited: true,
      lastEditedAt: FIXED_NOW,
    });
    expect(result.savedEpisode?.metadata?.additional).not.toHaveProperty(
      "hfLazy"
    );
  });

  it("overwrites an episode while preserving persisted source index and createdAt", () => {
    const existingEpisode = createEpisode(
      "episode-keep",
      1,
      [{ timestamp: 0, jointPositions: { joint_a: 0 } }],
      {
        createdAt: FIXED_NOW - 500,
        episode_index: 41,
        additional: {
          sourceName: "Imported",
        },
      }
    );
    const editedEpisode = {
      ...existingEpisode,
      frames: [
        { timestamp: 0, jointPositions: { joint_a: 1 } },
        { timestamp: 100, jointPositions: { joint_a: 2 } },
      ],
      metadata: {
        ...existingEpisode.metadata,
        additional: {
          hfLazy: { chunk: 1 },
        },
      },
    };

    const result = buildEpisodeSaveResult({
      previousEpisodes: [existingEpisode],
      episodeToSave: editedEpisode,
      saveAsNew: false,
      now: FIXED_NOW,
    });

    expect(result.errorMessage).toBeNull();
    expect(result.savedEpisode?.metadata?.episode_index).toBe(41);
    expect(result.savedEpisode?.metadata?.createdAt).toBe(FIXED_NOW - 500);
    expect(result.savedEpisode?.metadata?.additional).toMatchObject({
      sourceName: "Imported",
      parentEpisodeId: "episode-keep",
      isEdited: true,
      lastEditedAt: FIXED_NOW,
    });
    expect(result.savedEpisode?.metadata?.additional).not.toHaveProperty(
      "hfLazy"
    );
  });
});

describe("applyTargetFpsToEpisodes", () => {
  it("updates only episodes whose fps differs from the target", () => {
    const offTargetEpisode = createEpisode(
      "episode-fast",
      1,
      [
        { timestamp: 0, jointPositions: { joint_a: 0 } },
        { timestamp: 250, jointPositions: { joint_a: 1 } },
        { timestamp: 500, jointPositions: { joint_a: 2 } },
        { timestamp: 750, jointPositions: { joint_a: 3 } },
        { timestamp: 1000, jointPositions: { joint_a: 4 } },
      ],
      undefined
    );
    const matchingEpisode = createEpisode(
      "episode-match",
      2,
      [
        { timestamp: 0, jointPositions: { joint_b: 0 } },
        { timestamp: 500, jointPositions: { joint_b: 0.5 } },
        { timestamp: 1000, jointPositions: { joint_b: 1 } },
      ],
      undefined
    );

    const result = applyTargetFpsToEpisodes({
      episodes: [offTargetEpisode, matchingEpisode],
      targetFps: TARGET_FPS,
    });

    expect(result.updatedCount).toBe(1);
    expect(result.episodes[0]?.frames).toHaveLength(3);
    expect(computeEpisodeFps(result.episodes[0]!)).toBe(TARGET_FPS);
    expect(result.episodes[1]).toBe(matchingEpisode);
  });
});
