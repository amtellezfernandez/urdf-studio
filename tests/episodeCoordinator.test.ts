import { describe, expect, it } from "vitest";
import {
  findNextPlayableEpisodeIndex,
  getPlaybackEndAction,
  type PlaybackMode,
} from "@/features/playback/episodeCoordinator";

const makeEpisodes = (frameCounts: number[]) =>
  frameCounts.map((count) => ({
    frames: Array.from({ length: count }, (_, index) => ({ index })),
  }));

describe("episode playback coordinator", () => {
  it("finds next playable episode with wrap-around", () => {
    const episodes = makeEpisodes([0, 2, 0, 3]);
    expect(findNextPlayableEpisodeIndex(episodes, 0)).toBe(1);
    expect(findNextPlayableEpisodeIndex(episodes, 2)).toBe(3);
    expect(findNextPlayableEpisodeIndex(episodes, 3)).toBe(3);
    expect(findNextPlayableEpisodeIndex(episodes, 4)).toBe(1);
  });

  it("returns stop for single-mode playback end", () => {
    const episodes = makeEpisodes([2]);
    const action = getPlaybackEndAction({
      mode: "single",
      currentFrame: 1,
      totalFrames: 2,
      currentEpisodeIndex: 0,
      episodes,
    });
    expect(action).toEqual({ type: "stop" });
  });

  it("returns advance for all-mode playback end", () => {
    const episodes = makeEpisodes([2, 0, 4]);
    const action = getPlaybackEndAction({
      mode: "all",
      currentFrame: 1,
      totalFrames: 2,
      currentEpisodeIndex: 0,
      episodes,
    });
    expect(action).toEqual({ type: "advance", nextIndex: 2 });
  });

  it("returns none when playback did not finish", () => {
    const episodes = makeEpisodes([3]);
    const modes: PlaybackMode[] = ["all", "single"];
    modes.forEach((mode) => {
      const action = getPlaybackEndAction({
        mode,
        currentFrame: 0,
        totalFrames: 3,
        currentEpisodeIndex: 0,
        episodes,
      });
      expect(action).toEqual({ type: "none" });
    });
  });
});
