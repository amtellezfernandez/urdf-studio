import { describe, expect, it } from "vitest";

import {
  consumeHfDatasetIndexRows,
  createHfLazyChunkCursor,
  enqueueDeferredRetryOffset,
  normalizeHfDatasetIndexedEpisodeEntries,
} from "@/features/layout/sidebar/hfDatasetIndexing";

describe("createHfLazyChunkCursor", () => {
  it("derives buffered start offset from the buffered row count", () => {
    expect(
      createHfLazyChunkCursor({
        nextOffset: 12,
        bufferedRows: [{}, {}, {}],
      })
    ).toMatchObject({
      nextOffset: 12,
      bufferedStartOffset: 9,
      bufferedConsumed: false,
      done: false,
      deferredRetryOffsets: [],
    });
  });
});

describe("enqueueDeferredRetryOffset", () => {
  it("adds a unique valid retry offset only once", () => {
    const deferredRetryOffsets = [4];

    enqueueDeferredRetryOffset(deferredRetryOffsets, 8);
    enqueueDeferredRetryOffset(deferredRetryOffsets, 8);
    enqueueDeferredRetryOffset(deferredRetryOffsets, -1);

    expect(deferredRetryOffsets).toEqual([4, 8]);
  });
});

describe("consumeHfDatasetIndexRows", () => {
  it("builds episode entries and stops once the chunk limit would be exceeded", () => {
    const entriesByEpisode = new Map();
    const selectedEpisodeIndices = new Set<number>();
    const loadedEpisodeIndices = new Set<number>();
    const selectedRowsByEpisode = new Map();

    const result = consumeHfDatasetIndexRows({
      rows: [
        { row: { episode_index: 1, timestamp: 1 }, row_idx: 10 },
        { row: { episode_index: 1, timestamp: 2 }, row_idx: 11 },
        { row: { episode_index: 2, timestamp: 3 }, row_idx: 12 },
      ],
      batchOffset: 10,
      loadedEpisodeIndices,
      selectedEpisodeIndices,
      entriesByEpisode,
      chunkEpisodeLimit: 1,
      selectedRowsByEpisode,
    });

    expect(result).toEqual({
      stopped: true,
      resumeOffset: 12,
    });
    expect(selectedEpisodeIndices).toEqual(new Set([1]));
    expect(entriesByEpisode.get(1)).toEqual({
      episodeIndex: 1,
      startOffset: 10,
      endOffset: 11,
      ranges: [{ startOffset: 10, endOffset: 11 }],
      frameCount: 2,
      firstTimestamp: 1000,
      lastTimestamp: 2000,
    });
    expect(selectedRowsByEpisode.get(1)).toEqual([
      { episode_index: 1, timestamp: 1 },
      { episode_index: 1, timestamp: 2 },
    ]);
    expect(selectedRowsByEpisode.has(2)).toBe(false);
  });
});

describe("normalizeHfDatasetIndexedEpisodeEntries", () => {
  it("merges adjacent ranges and sorts entries by start offset", () => {
    expect(
      normalizeHfDatasetIndexedEpisodeEntries([
        {
          episodeIndex: 2,
          startOffset: 20,
          endOffset: 24,
          ranges: [
            { startOffset: 22, endOffset: 24 },
            { startOffset: 20, endOffset: 21 },
          ],
          frameCount: 5,
          firstTimestamp: null,
          lastTimestamp: null,
        },
        {
          episodeIndex: 1,
          startOffset: 5,
          endOffset: 7,
          ranges: [{ startOffset: 5, endOffset: 7 }],
          frameCount: 3,
          firstTimestamp: null,
          lastTimestamp: null,
        },
      ])
    ).toEqual([
      {
        episodeIndex: 1,
        startOffset: 5,
        endOffset: 7,
        ranges: [{ startOffset: 5, endOffset: 7 }],
        frameCount: 3,
        firstTimestamp: null,
        lastTimestamp: null,
      },
      {
        episodeIndex: 2,
        startOffset: 20,
        endOffset: 24,
        ranges: [{ startOffset: 20, endOffset: 24 }],
        frameCount: 5,
        firstTimestamp: null,
        lastTimestamp: null,
      },
    ]);
  });
});
