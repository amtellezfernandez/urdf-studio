import { describe, expect, it } from "vitest";

import { createEpisode } from "@/features/dataset";
import {
  buildHfLazyFetchWindows,
  groupHfLazyFetchWindows,
  type HfLazyFetchWindow,
  resolveHfLazyEpisodeRef,
  type HfLazyEpisodeRef,
} from "@/features/layout/sidebar/useHfLazyEpisodeLoader";

const TEST_FETCH_BATCH_SIZE = 4;

describe("resolveHfLazyEpisodeRef", () => {
  it("normalizes and sorts lazy ranges from episode metadata", () => {
    const episode = createEpisode("hf-lazy-episode", 1, [], {
      additional: {
        hfLazy: {
          contextKey: "ctx",
          episodeIndex: 7,
          startOffset: 10,
          endOffset: 29,
          frameCount: 12,
          firstTimestamp: 100,
          lastTimestamp: 220,
          ranges: [
            { startOffset: 20, endOffset: 29 },
            { startOffset: 10, endOffset: 19 },
          ],
        },
      },
    });

    expect(resolveHfLazyEpisodeRef(episode)).toEqual({
      contextKey: "ctx",
      episodeIndex: 7,
      startOffset: 10,
      endOffset: 29,
      frameCount: 12,
      firstTimestamp: 100,
      lastTimestamp: 220,
      ranges: [
        { startOffset: 10, endOffset: 19 },
        { startOffset: 20, endOffset: 29 },
      ],
    });
  });

  it("returns null when lazy metadata is incomplete", () => {
    const episode = createEpisode("invalid-hf-lazy-episode", 1, [], {
      additional: {
        hfLazy: {
          episodeIndex: 3,
          startOffset: 10,
          endOffset: 9,
        },
      },
    });

    expect(resolveHfLazyEpisodeRef(episode)).toBeNull();
  });
});

describe("buildHfLazyFetchWindows", () => {
  it("merges adjacent ranges before chunking windows", () => {
    const lazyRef: HfLazyEpisodeRef = {
      contextKey: "ctx",
      episodeIndex: 1,
      startOffset: 0,
      endOffset: 11,
      ranges: [
        { startOffset: 0, endOffset: 3 },
        { startOffset: 4, endOffset: 5 },
        { startOffset: 10, endOffset: 11 },
      ],
      frameCount: 0,
      firstTimestamp: null,
      lastTimestamp: null,
    };

    expect(
      buildHfLazyFetchWindows({
        lazyRef,
        batchSize: TEST_FETCH_BATCH_SIZE,
      })
    ).toEqual([
      { offset: 0, length: 4 },
      { offset: 4, length: 2 },
      { offset: 10, length: 2 },
    ]);
  });

  it("falls back to the episode start and end offsets when ranges are absent", () => {
    const lazyRef: HfLazyEpisodeRef = {
      contextKey: "ctx",
      episodeIndex: 2,
      startOffset: 8,
      endOffset: 10,
      frameCount: 0,
      firstTimestamp: null,
      lastTimestamp: null,
    };

    expect(
      buildHfLazyFetchWindows({
        lazyRef,
        batchSize: TEST_FETCH_BATCH_SIZE,
      })
    ).toEqual([{ offset: 8, length: 3 }]);
  });
});

describe("groupHfLazyFetchWindows", () => {
  it("chunks lazy fetch windows with bounded concurrency", () => {
    const windows: HfLazyFetchWindow[] = [
      { offset: 0, length: 4 },
      { offset: 4, length: 4 },
      { offset: 8, length: 4 },
      { offset: 12, length: 2 },
      { offset: 14, length: 2 },
    ];

    expect(
      groupHfLazyFetchWindows({
        windows,
        maxConcurrentWindows: 2,
      })
    ).toEqual([
      [
        { offset: 0, length: 4 },
        { offset: 4, length: 4 },
      ],
      [
        { offset: 8, length: 4 },
        { offset: 12, length: 2 },
      ],
      [{ offset: 14, length: 2 }],
    ]);
  });

  it("falls back to serial groups when concurrency is invalid", () => {
    const windows: HfLazyFetchWindow[] = [
      { offset: 0, length: 4 },
      { offset: 4, length: 2 },
    ];

    expect(
      groupHfLazyFetchWindows({
        windows,
        maxConcurrentWindows: 0,
      })
    ).toEqual([[{ offset: 0, length: 4 }], [{ offset: 4, length: 2 }]]);
  });
});
