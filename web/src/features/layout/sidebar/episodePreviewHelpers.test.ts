import { describe, expect, it } from "vitest";

import { createEpisode } from "@/features/dataset";
import {
  buildEpisodeRecordedVideoStreams,
  collectEpisodeRecordedVideoCameras,
  resolveEpisodePreviewState,
  resolveEpisodeReplayTimeSec,
} from "@/features/layout/sidebar/episodePreviewHelpers";

describe("resolveEpisodeReplayTimeSec", () => {
  it("clamps the requested frame and returns time relative to the first frame", () => {
    const episode = createEpisode(
      "episode-1",
      1,
      [
        { timestamp: 100, jointPositions: { joint_a: 0 } },
        { timestamp: 450, jointPositions: { joint_a: 1 } },
        { timestamp: 900, jointPositions: { joint_a: 2 } },
      ],
      undefined
    );

    expect(
      resolveEpisodeReplayTimeSec({
        episode,
        currentFrame: 99,
      })
    ).toBeCloseTo(0.8);
  });
});

describe("collectEpisodeRecordedVideoCameras", () => {
  it("trims and sorts recorded camera names", () => {
    const episode = createEpisode(
      "episode-2",
      1,
      [{ timestamp: 0, jointPositions: { joint_a: 0 } }],
      {
        videos: {
          " rear ": "https://example.com/rear.mp4",
          front: "https://example.com/front.mp4",
          "": "https://example.com/ignored.mp4",
        },
      }
    );

    expect(collectEpisodeRecordedVideoCameras(episode)).toEqual([
      "front",
      "rear",
    ]);
  });
});

describe("buildEpisodeRecordedVideoStreams", () => {
  it("resolves recorded streams with clip bounds and stable sort order", () => {
    const episode = createEpisode(
      "episode-3",
      7,
      [{ timestamp: 0, jointPositions: { joint_a: 0 } }],
      {
        episode_index: 12,
        videos: {
          cam_b: "https://example.com/b.mp4",
          cam_a: {
            path: "videos/cam_a/chunk-000/file-012.mp4",
          },
        },
        additional: {
          hfDatasetRepo: "acme/warbot",
          video_clip_start_sec: 1.25,
          video_clip_end_sec: 4.5,
        },
      }
    );

    expect(buildEpisodeRecordedVideoStreams(episode)).toEqual([
      {
        cameraName: "cam_a",
        url: "https://huggingface.co/datasets/acme/warbot/resolve/main/videos/cam_a/chunk-000/file-012.mp4",
        fallbackUrls: [
          "https://huggingface.co/datasets/acme/warbot/resolve/main/videos/cam_a/chunk-000/file-000.mp4",
          "https://huggingface.co/datasets/acme/warbot/resolve/main/videos/cam_a/episode_000012.mp4",
        ],
        episodeNumber: 7,
        episodeId: "episode-3",
        clipStartSec: 1.25,
        clipEndSec: 4.5,
      },
      {
        cameraName: "cam_b",
        url: "https://example.com/b.mp4",
        fallbackUrls: [],
        episodeNumber: 7,
        episodeId: "episode-3",
        clipStartSec: 1.25,
        clipEndSec: 4.5,
      },
    ]);
  });
});

describe("resolveEpisodePreviewState", () => {
  it("prefers the live playback draft for preview derivation when ids match", () => {
    const savedEpisode = createEpisode(
      "episode-4",
      1,
      [{ timestamp: 0, jointPositions: { joint_a: 0 } }],
      undefined
    );
    const playbackDraft = {
      ...savedEpisode,
      metadata: {
        ...savedEpisode.metadata,
        videos: {
          front: "https://example.com/front.mp4",
        },
      },
    };

    const state = resolveEpisodePreviewState({
      episodes: [savedEpisode],
      currentPlayingEpisodeIndex: 0,
      playbackEpisode: playbackDraft,
      currentFrame: 0,
    });

    expect(state.activeReplayEpisode).toBe(playbackDraft);
    expect(state.recordedVideoCameras).toEqual(["front"]);
  });
});
