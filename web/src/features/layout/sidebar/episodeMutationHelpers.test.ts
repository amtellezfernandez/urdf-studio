import { describe, expect, it } from "vitest";

import { createEpisode } from "@/features/dataset";
import {
  buildDeleteEpisodeMutation,
  buildMoveEpisodeMutation,
  buildRetakeEpisodeMutation,
} from "@/features/layout/sidebar/episodeMutationHelpers";

const FIRST_EPISODE_NUMBER = 1;
const SECOND_EPISODE_NUMBER = 2;
const THIRD_EPISODE_NUMBER = 3;
const SECOND_EPISODE_INDEX = 1;
const THIRD_EPISODE_INDEX = 2;

const buildEpisodes = () => [
  createEpisode(
    "episode-a",
    FIRST_EPISODE_NUMBER,
    [{ timestamp: 0, jointPositions: { joint_a: 0 } }],
    undefined
  ),
  createEpisode(
    "episode-b",
    SECOND_EPISODE_NUMBER,
    [{ timestamp: 0, jointPositions: { joint_b: 0 } }],
    {
      episode_index: 7,
      additional: {
        sourceType: "recorded",
      },
    }
  ),
  createEpisode(
    "episode-c",
    THIRD_EPISODE_NUMBER,
    [{ timestamp: 0, jointPositions: { joint_c: 0 } }],
    undefined
  ),
];

describe("buildDeleteEpisodeMutation", () => {
  it("clears selection and resets replay when deleting the last remaining episode", () => {
    const episodes = [buildEpisodes()[0]];

    expect(
      buildDeleteEpisodeMutation({
        episodes,
        episodeId: "episode-a",
        selectedEpisodeId: "episode-a",
        isPlayingAll: false,
      })
    ).toEqual({
      nextEpisodes: [],
      nextSelectionIndex: null,
      shouldStopPlayback: true,
      shouldResetFrame: true,
      shouldNotifyPlaybackStopped: true,
    });
  });

  it("keeps the selected replay target stable when deleting an earlier episode", () => {
    const episodes = buildEpisodes();
    const result = buildDeleteEpisodeMutation({
      episodes,
      episodeId: "episode-a",
      selectedEpisodeId: "episode-c",
      isPlayingAll: false,
    });

    expect(result?.nextEpisodes.map((episode) => episode.id)).toEqual([
      "episode-b",
      "episode-c",
    ]);
    expect(result?.nextEpisodes.map((episode) => episode.number)).toEqual([
      FIRST_EPISODE_NUMBER,
      SECOND_EPISODE_NUMBER,
    ]);
    expect(result?.nextEpisodes[0]?.metadata?.episodeNumber).toBe(
      FIRST_EPISODE_NUMBER
    );
    expect(result?.nextEpisodes[0]?.metadata?.episode_index).toBe(7);
    expect(result).toMatchObject({
      nextSelectionIndex: SECOND_EPISODE_INDEX,
      shouldStopPlayback: false,
      shouldResetFrame: false,
      shouldNotifyPlaybackStopped: false,
    });
  });
});

describe("buildRetakeEpisodeMutation", () => {
  it("preserves the retake slot and inherited metadata", () => {
    const episodes = buildEpisodes();

    const result = buildRetakeEpisodeMutation({
      episodes,
      episodeId: "episode-b",
      selectedEpisodeId: "episode-c",
      isPlayingAll: false,
    });

    expect(result).toMatchObject({
      nextSelectionIndex: SECOND_EPISODE_INDEX,
      shouldStopPlayback: false,
      recordingRequest: {
        episodeNumber: SECOND_EPISODE_NUMBER,
        insertPosition: SECOND_EPISODE_INDEX,
        metadata: episodes[SECOND_EPISODE_INDEX]?.metadata,
      },
    });
    expect(result?.nextEpisodes.map((episode) => episode.id)).toEqual([
      "episode-a",
      "episode-c",
    ]);
  });
});

describe("buildMoveEpisodeMutation", () => {
  it("reorders episodes while preserving the same selected episode id", () => {
    const episodes = buildEpisodes();

    const result = buildMoveEpisodeMutation({
      episodes,
      episodeId: "episode-a",
      direction: "down",
      selectedEpisodeId: "episode-c",
      isPlayingAll: true,
    });

    expect(result?.nextEpisodes.map((episode) => episode.id)).toEqual([
      "episode-b",
      "episode-a",
      "episode-c",
    ]);
    expect(result?.nextSelectionIndex).toBe(THIRD_EPISODE_INDEX);
    expect(result?.shouldStopPlayback).toBe(true);
    expect(result?.shouldNotifyPlaybackStopped).toBe(true);
  });

  it("returns null when the requested reorder would leave the list bounds", () => {
    const episodes = buildEpisodes();

    expect(
      buildMoveEpisodeMutation({
        episodes,
        episodeId: "episode-a",
        direction: "up",
        selectedEpisodeId: "episode-a",
        isPlayingAll: false,
      })
    ).toBeNull();
  });
});
