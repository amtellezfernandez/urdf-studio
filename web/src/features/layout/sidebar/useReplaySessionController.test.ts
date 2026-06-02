import { describe, expect, it } from "vitest";

import { createEpisode } from "@/features/dataset";
import {
  episodeHasPlayableFramesOrLazyRef,
  hasReplayReachedEpisodeEnd,
  resolveNextPlayableOrLazyEpisodeIndex,
  resolveReplayEpisodeForFrameLoad,
  shouldReloadReplayEpisode,
  type LoadedReplayEpisode,
} from "@/features/layout/sidebar/useReplaySessionController";

const TEST_EPISODE_INDEX = 0;
const OTHER_EPISODE_INDEX = 1;
const LAZY_EPISODE_REF = { source: "hf" };
const REPLAY_FIXTURE = {
  episodeNumber: 1,
  otherEpisodeNumber: 2,
  frame: {
    timestamp: 25,
    jointPositions: { joint_a: 0.75 },
  },
} as const;

const getLazyEpisodeRef = (episode: { id: string }) =>
  episode.id === "lazy-episode" ? LAZY_EPISODE_REF : null;

const createPlaybackFrame = () => ({
  timestamp: REPLAY_FIXTURE.frame.timestamp,
  jointPositions: { ...REPLAY_FIXTURE.frame.jointPositions },
});

describe("resolveReplayEpisodeForFrameLoad", () => {
  it("uses a materialized lazy episode when the indexed placeholder still has no frames", () => {
    const placeholderEpisode = createEpisode(
      "lazy-episode",
      REPLAY_FIXTURE.episodeNumber,
      [],
      undefined
    );
    const materializedEpisode = {
      ...placeholderEpisode,
      frames: [createPlaybackFrame()],
    };

    expect(
      resolveReplayEpisodeForFrameLoad({
        episodes: [placeholderEpisode],
        episodeIndex: TEST_EPISODE_INDEX,
        materializedEpisode,
      })
    ).toBe(materializedEpisode);
  });

  it("does not use a materialized episode for a different indexed id", () => {
    const placeholderEpisode = createEpisode(
      "lazy-episode",
      REPLAY_FIXTURE.episodeNumber,
      [],
      undefined
    );
    const unrelatedEpisode = createEpisode(
      "other-episode",
      REPLAY_FIXTURE.otherEpisodeNumber,
      [createPlaybackFrame()],
      undefined
    );

    expect(
      resolveReplayEpisodeForFrameLoad({
        episodes: [placeholderEpisode],
        episodeIndex: TEST_EPISODE_INDEX,
        materializedEpisode: unrelatedEpisode,
      })
    ).toBeNull();
  });

  it("uses the indexed frame buffer when the episode is already loaded", () => {
    const indexedEpisode = createEpisode(
      "episode-with-frames",
      REPLAY_FIXTURE.episodeNumber,
      [createPlaybackFrame()],
      undefined
    );

    expect(
      resolveReplayEpisodeForFrameLoad({
        episodes: [indexedEpisode],
        episodeIndex: TEST_EPISODE_INDEX,
      })
    ).toBe(indexedEpisode);
  });
});

describe("shouldReloadReplayEpisode", () => {
  it("does not reload when the same episode and frame buffer are still loaded", () => {
    const episode = createEpisode(
      "episode-a",
      1,
      [{ timestamp: 0, jointPositions: { joint_a: 0 } }],
      undefined
    );
    const currentLoadedEpisode: LoadedReplayEpisode = {
      index: TEST_EPISODE_INDEX,
      episodeId: episode.id,
      framesRef: episode.frames,
    };

    expect(
      shouldReloadReplayEpisode({
        currentLoadedEpisode,
        episodeIndex: TEST_EPISODE_INDEX,
        episode,
      })
    ).toBe(false);
  });

  it("reloads when the selected index changes", () => {
    const episode = createEpisode(
      "episode-b",
      1,
      [{ timestamp: 0, jointPositions: { joint_b: 0 } }],
      undefined
    );
    const currentLoadedEpisode: LoadedReplayEpisode = {
      index: TEST_EPISODE_INDEX,
      episodeId: episode.id,
      framesRef: episode.frames,
    };

    expect(
      shouldReloadReplayEpisode({
        currentLoadedEpisode,
        episodeIndex: OTHER_EPISODE_INDEX,
        episode,
      })
    ).toBe(true);
  });

  it("reloads when the episode frames reference changes", () => {
    const originalEpisode = createEpisode(
      "episode-c",
      1,
      [{ timestamp: 0, jointPositions: { joint_c: 0 } }],
      undefined
    );
    const updatedEpisode = {
      ...originalEpisode,
      frames: [
        ...originalEpisode.frames,
        { timestamp: 10, jointPositions: { joint_c: 1 } },
      ],
    };
    const currentLoadedEpisode: LoadedReplayEpisode = {
      index: TEST_EPISODE_INDEX,
      episodeId: originalEpisode.id,
      framesRef: originalEpisode.frames,
    };

    expect(
      shouldReloadReplayEpisode({
        currentLoadedEpisode,
        episodeIndex: TEST_EPISODE_INDEX,
        episode: updatedEpisode,
      })
    ).toBe(true);
  });

  it("reloads when replay explicitly requests a fresh load", () => {
    const episode = createEpisode(
      "episode-d",
      1,
      [{ timestamp: 0, jointPositions: { joint_d: 0 } }],
      undefined
    );
    const currentLoadedEpisode: LoadedReplayEpisode = {
      index: TEST_EPISODE_INDEX,
      episodeId: episode.id,
      framesRef: episode.frames,
    };

    expect(
      shouldReloadReplayEpisode({
        currentLoadedEpisode,
        episodeIndex: TEST_EPISODE_INDEX,
        episode,
        forceReload: true,
      })
    ).toBe(true);
  });

  it("reloads when the viewer playback store does not currently hold episode frames", () => {
    const episode = createEpisode(
      "episode-e",
      1,
      [{ timestamp: 0, jointPositions: { joint_e: 0 } }],
      undefined
    );
    const currentLoadedEpisode: LoadedReplayEpisode = {
      index: TEST_EPISODE_INDEX,
      episodeId: episode.id,
      framesRef: episode.frames,
    };

    expect(
      shouldReloadReplayEpisode({
        currentLoadedEpisode,
        episodeIndex: TEST_EPISODE_INDEX,
        episode,
        hasPlaybackFrames: false,
        playbackEpisodeId: null,
      })
    ).toBe(true);
  });

  it("reloads when the viewer playback store points at a different episode", () => {
    const episode = createEpisode(
      "episode-f",
      1,
      [{ timestamp: 0, jointPositions: { joint_f: 0 } }],
      undefined
    );
    const currentLoadedEpisode: LoadedReplayEpisode = {
      index: TEST_EPISODE_INDEX,
      episodeId: episode.id,
      framesRef: episode.frames,
    };

    expect(
      shouldReloadReplayEpisode({
        currentLoadedEpisode,
        episodeIndex: TEST_EPISODE_INDEX,
        episode,
        hasPlaybackFrames: true,
        playbackEpisodeId: "other-episode",
      })
    ).toBe(true);
  });
});

describe("episodeHasPlayableFramesOrLazyRef", () => {
  it("returns true when the episode already has frames", () => {
    const episode = createEpisode(
      "episode-with-frames",
      1,
      [{ timestamp: 0, jointPositions: { joint_a: 0 } }],
      undefined
    );

    expect(
      episodeHasPlayableFramesOrLazyRef({
        episode,
        getLazyEpisodeRef,
      })
    ).toBe(true);
  });

  it("returns true when the episode is lazy-loadable", () => {
    const lazyEpisode = createEpisode("lazy-episode", 2, [], undefined);

    expect(
      episodeHasPlayableFramesOrLazyRef({
        episode: lazyEpisode,
        getLazyEpisodeRef,
      })
    ).toBe(true);
  });

  it("returns false when the episode has no frames and no lazy reference", () => {
    const emptyEpisode = createEpisode("empty-episode", 3, [], undefined);

    expect(
      episodeHasPlayableFramesOrLazyRef({
        episode: emptyEpisode,
        getLazyEpisodeRef,
      })
    ).toBe(false);
  });
});

describe("resolveNextPlayableOrLazyEpisodeIndex", () => {
  it("skips empty episodes and returns the next playable index", () => {
    const episodes = [
      createEpisode("empty-episode", 1, [], undefined),
      createEpisode("lazy-episode", 2, [], undefined),
      createEpisode(
        "episode-with-frames",
        3,
        [{ timestamp: 0, jointPositions: { joint_a: 1 } }],
        undefined
      ),
    ];

    expect(
      resolveNextPlayableOrLazyEpisodeIndex({
        episodes,
        startIndex: 0,
        getLazyEpisodeRef,
      })
    ).toBe(1);
  });

  it("wraps the search index across the episode list", () => {
    const episodes = [
      createEpisode("empty-episode", 1, [], undefined),
      createEpisode(
        "episode-with-frames",
        2,
        [{ timestamp: 0, jointPositions: { joint_a: 1 } }],
        undefined
      ),
      createEpisode("another-empty-episode", 3, [], undefined),
    ];

    expect(
      resolveNextPlayableOrLazyEpisodeIndex({
        episodes,
        startIndex: -1,
        getLazyEpisodeRef,
      })
    ).toBe(1);
  });

  it("returns null when no episode can be played or materialized", () => {
    const episodes = [
      createEpisode("empty-episode-a", 1, [], undefined),
      createEpisode("empty-episode-b", 2, [], undefined),
    ];

    expect(
      resolveNextPlayableOrLazyEpisodeIndex({
        episodes,
        startIndex: 0,
        getLazyEpisodeRef,
      })
    ).toBeNull();
  });
});

describe("hasReplayReachedEpisodeEnd", () => {
  it("returns false when playback is not on the last frame yet", () => {
    expect(
      hasReplayReachedEpisodeEnd({
        currentFrame: 2,
        totalFrames: 5,
      })
    ).toBe(false);
  });

  it("returns true when playback reaches the last frame", () => {
    expect(
      hasReplayReachedEpisodeEnd({
        currentFrame: 4,
        totalFrames: 5,
      })
    ).toBe(true);
  });

  it("returns false when frame information is incomplete", () => {
    expect(
      hasReplayReachedEpisodeEnd({
        currentFrame: undefined,
        totalFrames: 5,
      })
    ).toBe(false);
    expect(
      hasReplayReachedEpisodeEnd({
        currentFrame: 0,
        totalFrames: 0,
      })
    ).toBe(false);
  });
});
