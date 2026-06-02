import type { HfDatasetServerRow } from "@/features/layout/sidebar/sidebarHelpers";
import { toFiniteNumber, unwrapHfDatasetServerRow } from "@/features/layout/sidebar/sidebarHelpers";

export type HfDatasetIndexedEpisodeEntry = {
  episodeIndex: number;
  startOffset: number;
  endOffset: number;
  ranges: Array<{ startOffset: number; endOffset: number }>;
  frameCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
};

export type HfLazyChunkCursor = {
  nextOffset: number;
  bufferedRows: Array<Record<string, unknown>>;
  bufferedStartOffset: number;
  bufferedConsumed: boolean;
  done: boolean;
  loadedEpisodeIndices: Set<number>;
  deferredRetryOffsets: number[];
};

export const createHfLazyChunkCursor = ({
  nextOffset,
  bufferedRows,
}: {
  nextOffset: number;
  bufferedRows: Array<Record<string, unknown>>;
}): HfLazyChunkCursor => {
  const bufferedStartOffset = Math.max(0, nextOffset - bufferedRows.length);
  return {
    nextOffset,
    bufferedRows: [...bufferedRows],
    bufferedStartOffset,
    bufferedConsumed: bufferedRows.length === 0,
    done: false,
    loadedEpisodeIndices: new Set<number>(),
    deferredRetryOffsets: [],
  };
};

export const enqueueDeferredRetryOffset = (
  deferredRetryOffsets: number[],
  offsetToRetry: number
) => {
  if (
    !Number.isFinite(offsetToRetry) ||
    offsetToRetry < 0 ||
    deferredRetryOffsets.includes(offsetToRetry)
  ) {
    return;
  }
  deferredRetryOffsets.push(offsetToRetry);
};

export const consumeHfDatasetIndexRows = ({
  rows,
  batchOffset,
  loadedEpisodeIndices,
  selectedEpisodeIndices,
  entriesByEpisode,
  chunkEpisodeLimit,
  selectedRowsByEpisode,
}: {
  rows: HfDatasetServerRow[];
  batchOffset: number;
  loadedEpisodeIndices: Set<number>;
  selectedEpisodeIndices: Set<number>;
  entriesByEpisode: Map<number, HfDatasetIndexedEpisodeEntry>;
  chunkEpisodeLimit: number;
  selectedRowsByEpisode?: Map<number, Array<Record<string, unknown>>>;
}): { stopped: boolean; resumeOffset: number | null } => {
  for (let index = 0; index < rows.length; index += 1) {
    const wrapper = rows[index] as {
      row?: Record<string, unknown>;
      row_idx?: number;
    };
    const rowData = unwrapHfDatasetServerRow(rows[index]);
    if (!rowData) {
      continue;
    }
    const rowOffset =
      typeof wrapper.row_idx === "number" && Number.isFinite(wrapper.row_idx)
        ? Math.trunc(wrapper.row_idx)
        : batchOffset + index;
    const episodeIndex = Math.trunc(toFiniteNumber(rowData.episode_index, 0));
    if (loadedEpisodeIndices.has(episodeIndex)) {
      continue;
    }
    if (!selectedEpisodeIndices.has(episodeIndex)) {
      if (selectedEpisodeIndices.size >= chunkEpisodeLimit) {
        return { stopped: true, resumeOffset: rowOffset };
      }
      selectedEpisodeIndices.add(episodeIndex);
    }
    if (selectedRowsByEpisode) {
      const selectedRows = selectedRowsByEpisode.get(episodeIndex) ?? [];
      selectedRows.push(rowData);
      selectedRowsByEpisode.set(episodeIndex, selectedRows);
    }
    const timestampRaw = toFiniteNumber(rowData.timestamp, Number.NaN);
    const timestampValue = Number.isFinite(timestampRaw) ? timestampRaw * 1000 : null;
    const entry = entriesByEpisode.get(episodeIndex);
    if (!entry) {
      entriesByEpisode.set(episodeIndex, {
        episodeIndex,
        startOffset: rowOffset,
        endOffset: rowOffset,
        ranges: [{ startOffset: rowOffset, endOffset: rowOffset }],
        frameCount: 1,
        firstTimestamp: timestampValue,
        lastTimestamp: timestampValue,
      });
      continue;
    }

    entry.startOffset = Math.min(entry.startOffset, rowOffset);
    entry.endOffset = Math.max(entry.endOffset, rowOffset);
    entry.frameCount += 1;
    if (
      timestampValue !== null &&
      (entry.firstTimestamp === null || timestampValue < entry.firstTimestamp)
    ) {
      entry.firstTimestamp = timestampValue;
    }
    if (
      timestampValue !== null &&
      (entry.lastTimestamp === null || timestampValue > entry.lastTimestamp)
    ) {
      entry.lastTimestamp = timestampValue;
    }
    const lastRange = entry.ranges[entry.ranges.length - 1];
    if (!lastRange || rowOffset > lastRange.endOffset + 1) {
      entry.ranges.push({ startOffset: rowOffset, endOffset: rowOffset });
    } else {
      lastRange.endOffset = Math.max(lastRange.endOffset, rowOffset);
    }
  }
  return { stopped: false, resumeOffset: null };
};

export const normalizeHfDatasetIndexedEpisodeEntries = (
  entries: Iterable<HfDatasetIndexedEpisodeEntry>
) =>
  Array.from(entries)
    .map((entry) => {
      const sortedRanges = [...entry.ranges].sort(
        (left, right) => left.startOffset - right.startOffset
      );
      const mergedRanges: Array<{ startOffset: number; endOffset: number }> = [];
      sortedRanges.forEach((range) => {
        const lastRange = mergedRanges[mergedRanges.length - 1];
        if (!lastRange || range.startOffset > lastRange.endOffset + 1) {
          mergedRanges.push({
            startOffset: range.startOffset,
            endOffset: range.endOffset,
          });
          return;
        }
        lastRange.endOffset = Math.max(lastRange.endOffset, range.endOffset);
      });
      const firstRange = mergedRanges[0];
      const lastRange = mergedRanges[mergedRanges.length - 1];
      return {
        ...entry,
        startOffset: firstRange?.startOffset ?? entry.startOffset,
        endOffset: lastRange?.endOffset ?? entry.endOffset,
        ranges: mergedRanges,
      };
    })
    .sort((left, right) => left.startOffset - right.startOffset);
