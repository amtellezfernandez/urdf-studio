import { describe, expect, it } from "vitest";

import type { RecordedFrame } from "@/features/dataset";
import {
  buildRecordedEpisodeInsertResult,
  computeRecordedEpisodeFps,
  prepareRecordedFramesForPersistence,
  trimTrailingIdleFrames,
} from "@/features/layout/sidebar/recordingHelpers";
import type { JointLimits } from "@/shared/lib/urdfBrowser";

const FIXED_NOW = 1_700_000_000_000;
const TEST_RECORDING_JOINT_LIMITS = {
  joint_a: {
    type: "revolute",
    lower: -10,
    upper: 10,
    velocity: 12,
  },
} satisfies JointLimits;
const TEST_UNSAFE_RECORDING_JOINT_LIMITS = {
  joint_a: {
    type: "revolute",
    lower: -10,
    upper: 10,
    velocity: 20,
  },
} satisfies JointLimits;

const createFrame = (
  timestamp: number,
  jointValue: number,
  baseX = 0
): RecordedFrame => ({
  timestamp,
  jointPositions: { joint_a: jointValue },
  basePose: {
    position: { x: baseX, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  },
});

describe("trimTrailingIdleFrames", () => {
  it("trims a long static tail but keeps one settle frame", () => {
    const frames = [
      createFrame(0, 0),
      createFrame(100, 1),
      createFrame(200, 2),
      createFrame(300, 2),
      createFrame(400, 2),
      createFrame(500, 2),
    ];

    expect(trimTrailingIdleFrames(frames)).toEqual({
      frames: frames.slice(0, 4),
      trimmedCount: 2,
      keepUntil: 3,
    });
  });

  it("does not trim when the idle tail still drifts beyond tolerance", () => {
    const frames = [
      createFrame(0, 0),
      createFrame(100, 1),
      createFrame(200, 1),
      createFrame(300, 1.0004),
      createFrame(400, 1.0004),
      createFrame(500, 1.0004),
    ];

    expect(trimTrailingIdleFrames(frames)).toEqual({
      frames,
      trimmedCount: 0,
      keepUntil: frames.length - 1,
    });
  });
});

describe("prepareRecordedFramesForPersistence", () => {
  it("preserves exact joint samples for safe recordings", () => {
    const frames = [
      createFrame(0.4, 0),
      createFrame(100.6, 0.1),
      createFrame(201.1, 0),
    ];

    const result = prepareRecordedFramesForPersistence({
      frames,
      jointLimits: TEST_RECORDING_JOINT_LIMITS,
    });

    expect(result.status).toBe("ok");
    expect(result.frames.map((frame) => frame.timestamp)).toEqual([0, 101, 201]);
    expect(result.frames.map((frame) => frame.jointPositions.joint_a)).toEqual([
      0,
      0.1,
      0,
    ]);
  });

  it("flags unsafe motion without clamping the recorded samples", () => {
    const frames = [
      createFrame(0, 0),
      createFrame(100, -0.1),
      createFrame(200, 1.08),
    ];

    const result = prepareRecordedFramesForPersistence({
      frames,
      jointLimits: TEST_UNSAFE_RECORDING_JOINT_LIMITS,
    });

    expect(result.status).toBe("motion-limit-exceeded");
    expect(result.frames[2]?.jointPositions.joint_a).toBe(1.08);
  });
});

describe("buildRecordedEpisodeInsertResult", () => {
  it("inserts a recorded retake at the requested position and sanitizes metadata", () => {
    const previousEpisodes = [
      {
        id: "episode-1",
        number: 1,
        createdAt: FIXED_NOW - 1000,
        frames: [createFrame(0, 0)],
      },
      {
        id: "episode-2",
        number: 2,
        createdAt: FIXED_NOW - 500,
        frames: [createFrame(0, 2)],
      },
    ];
    const recordedFrames = [createFrame(0, 0), createFrame(100, 1)];

    const result = buildRecordedEpisodeInsertResult({
      previousEpisodes,
      episodeId: "retake-episode",
      frames: recordedFrames,
      metadataSnapshot: {
        episodeId: "retake-episode",
        insertPosition: 1,
        metadata: {
          episode_index: 4,
          additional: {
            hfLazy: { chunk: 1 },
            inherited: true,
          },
        },
      },
      robotBaseName: "warbot",
      recordingFps: 30,
      getJointOrderForFrames: () => ["joint_a"],
      now: FIXED_NOW,
    });

    expect(result.recordedEpisodeNumber).toBe(2);
    expect(result.sourceName).toBe("Recording 2");
    expect(result.episodes.map((episode) => episode.id)).toEqual([
      "episode-1",
      "retake-episode",
      "episode-2",
    ]);
    expect(result.episodes[1]?.metadata).toMatchObject({
      episodeNumber: 2,
      episode_index: 4,
      robot_type: "warbot",
      joint_names: ["joint_a"],
      num_frames: 2,
      additional: {
        inherited: true,
        isRecorded: true,
        sourceType: "recorded",
        sourceName: "Recording 2",
        sourceId: "retake-episode",
      },
    });
    expect(result.episodes[1]?.metadata?.additional).not.toHaveProperty("hfLazy");
  });
});

describe("computeRecordedEpisodeFps", () => {
  it("computes fps from frame timestamps", () => {
    expect(
      computeRecordedEpisodeFps([
        createFrame(0, 0),
        createFrame(100, 1),
        createFrame(200, 2),
      ])
    ).toBe(10);
  });
});
