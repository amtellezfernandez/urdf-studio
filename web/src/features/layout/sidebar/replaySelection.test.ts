import { describe, expect, it } from "vitest";

import { createEpisode } from "@/features/dataset";
import {
  resolveReplaySelectionIndexAfterEpisodeMutation,
  resolveSelectedReplayEpisodeId,
} from "@/features/layout/sidebar/replaySelection";

const FIRST_EPISODE_NUMBER = 1;
const SECOND_EPISODE_NUMBER = 2;
const THIRD_EPISODE_NUMBER = 3;
const FIRST_EPISODE_INDEX = 0;
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
    undefined
  ),
  createEpisode(
    "episode-c",
    THIRD_EPISODE_NUMBER,
    [{ timestamp: 0, jointPositions: { joint_c: 0 } }],
    undefined
  ),
];

describe("resolveSelectedReplayEpisodeId", () => {
  it("prefers the loaded episode id over the current index", () => {
    const episodes = buildEpisodes();

    expect(
      resolveSelectedReplayEpisodeId({
        episodes,
        currentPlayingEpisodeIndex: FIRST_EPISODE_INDEX,
        loadedEpisodeId: "episode-c",
      })
    ).toBe("episode-c");
  });

  it("falls back to the selected episode index when there is no loaded override", () => {
    const episodes = buildEpisodes();

    expect(
      resolveSelectedReplayEpisodeId({
        episodes,
        currentPlayingEpisodeIndex: SECOND_EPISODE_INDEX,
        loadedEpisodeId: null,
      })
    ).toBe("episode-b");
  });
});

describe("resolveReplaySelectionIndexAfterEpisodeMutation", () => {
  it("preserves the same selected episode across reorder", () => {
    const episodes = buildEpisodes();
    const reorderedEpisodes = [episodes[SECOND_EPISODE_INDEX], episodes[THIRD_EPISODE_INDEX], episodes[FIRST_EPISODE_INDEX]];

    expect(
      resolveReplaySelectionIndexAfterEpisodeMutation({
        episodes: reorderedEpisodes,
        selectedEpisodeId: "episode-c",
      })
    ).toBe(SECOND_EPISODE_INDEX);
  });

  it("recomputes the selection index when an earlier episode is removed", () => {
    const episodes = buildEpisodes();
    const filteredEpisodes = [
      episodes[SECOND_EPISODE_INDEX],
      episodes[THIRD_EPISODE_INDEX],
    ];

    expect(
      resolveReplaySelectionIndexAfterEpisodeMutation({
        episodes: filteredEpisodes,
        selectedEpisodeId: "episode-c",
        removedEpisodeId: "episode-a",
      })
    ).toBe(SECOND_EPISODE_INDEX);
  });

  it("clears the selection when the selected episode is removed", () => {
    const episodes = buildEpisodes();

    expect(
      resolveReplaySelectionIndexAfterEpisodeMutation({
        episodes: [episodes[FIRST_EPISODE_INDEX], episodes[SECOND_EPISODE_INDEX]],
        selectedEpisodeId: "episode-c",
        removedEpisodeId: "episode-c",
      })
    ).toBeNull();
  });
});
