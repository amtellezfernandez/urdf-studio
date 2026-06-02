import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import {
  buildDatasetTreatmentAdditionalFields,
  DEFAULT_SEMANTIC_REPRESENTATION_ID,
  deriveNamingStatus,
  type DatasetNumericRow,
  type DatasetSignalProfileResolution,
  type Episode,
  type EpisodeMetadata,
  type RecordedFrame,
} from "@/features/dataset";
import { classifyEpisodeFetchError } from "@/features/dataset/episode-pipeline/episodePipelineController";
import type { EpisodeMaterializationState } from "@/features/dataset/episode-pipeline/types";
import type { HfSignalField } from "@/features/layout/sidebar/hfSignalSelection";
import { fetchHfResource } from "@/features/layout/sidebar/hfFetch";
import {
  buildHfEpisodeVideosMetadata,
  computeGlobalVideoClipBoundsFromRows,
  fetchJsonWithRetry,
  sleep,
  toFiniteNumber,
  unwrapHfDatasetServerRow,
  type HfDatasetServerRow,
} from "@/features/layout/sidebar/sidebarHelpers";
import {
  HF_LAZY_EPISODE_CACHE_LIMIT,
  HF_DATASET_DEFAULT_FPS,
  HF_DATASET_ROWS_BATCH_SIZE,
  HF_LAZY_EPISODE_FETCH_INTER_WINDOW_DELAY_MS,
  HF_LAZY_EPISODE_FETCH_MAX_CONCURRENT_WINDOWS,
  HF_LAZY_EPISODE_FETCH_MAX_FAILED_WINDOWS,
  HF_LAZY_EPISODE_FETCH_RETRY_BASE_DELAY_MS,
  HF_LAZY_EPISODE_FETCH_RETRY_MAX_ATTEMPTS,
  HF_LAZY_EPISODE_FETCH_RETRY_MAX_DELAY_MS,
  HF_LAZY_EPISODE_FETCH_RUNTIME_MS,
} from "@/features/layout/sidebar/hfLazyEpisodeParams";
import { materializeHfEpisodeFramesAsync } from "@/features/layout/sidebar/hfEpisodeMaterialization";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { JointLimitMode } from "@/shared/types/feature";

type HfLazyOffsetRange = {
  startOffset: number;
  endOffset: number;
};

export type HfLazyFetchWindow = {
  offset: number;
  length: number;
};

export type HfLazyEpisodeRef = {
  contextKey: string;
  episodeIndex: number;
  startOffset: number;
  endOffset: number;
  ranges?: HfLazyOffsetRange[];
  frameCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
};

export type HfLazyLoadContext = {
  datasetPath: string;
  config: string;
  split: string;
  sourceDisplayName: string;
  signalField: HfSignalField | null;
  signalProfile: DatasetSignalProfileResolution;
  signalBaseMode: EpisodeMetadata["signal_base_mode"];
  jointMapping: Record<string, string>;
  jointOffsets: Record<string, number>;
  jointInversions: Record<string, boolean>;
  degToRad: boolean;
  jointLimitsSnapshot: JointLimits;
  limitModesByJoint: Record<string, JointLimitMode | undefined>;
  videoCameraKeys: string[];
  videoPathTemplate?: string;
};

type PipelineLoadStart = (
  episodeId: string,
  message: string
) => boolean;

type PipelineLoadFinish = (
  episodeId: string,
  nextState: {
    status: EpisodeMaterializationState["status"];
    message?: string;
    retryAfterMs?: number;
  }
) => void;

type UseHfLazyEpisodeLoaderParams = {
  episodes: Episode[];
  episodesRef: MutableRefObject<Episode[]>;
  setEpisodes: Dispatch<SetStateAction<Episode[]>>;
  effectiveHfToken: string | null;
  toNumericRows: (
    rows: Array<Record<string, unknown>>,
    signalField: HfSignalField | null
  ) => DatasetNumericRow[];
  setEpisodePipelineState: (
    episodeId: string,
    nextState: Partial<EpisodeMaterializationState>
  ) => void;
  beginPipelineEpisodeLoad: PipelineLoadStart;
  finishPipelineEpisodeLoad: PipelineLoadFinish;
  syncEpisodePipelineReadiness: (
    episodeStates: Array<{ id: string; hasFrames: boolean; isLazy: boolean }>
  ) => void;
  clearMissingPipelineEpisodes: (episodeIds: string[]) => void;
};

const normalizeHfLazyRanges = (lazyRef: HfLazyEpisodeRef): HfLazyOffsetRange[] => {
  const rawRanges = lazyRef.ranges ?? [
    { startOffset: lazyRef.startOffset, endOffset: lazyRef.endOffset },
  ];
  return rawRanges
    .filter(
      (range) =>
        Number.isFinite(range.startOffset) &&
        Number.isFinite(range.endOffset) &&
        range.endOffset >= range.startOffset
    )
    .map((range) => ({
      startOffset: Math.trunc(range.startOffset),
      endOffset: Math.trunc(range.endOffset),
    }))
    .sort((a, b) => a.startOffset - b.startOffset);
};

export const resolveHfLazyEpisodeRef = (
  episode: Episode
): HfLazyEpisodeRef | null => {
  const additional = episode.metadata?.additional;
  if (!additional || typeof additional !== "object") return null;
  const lazyRaw = (additional as Record<string, unknown>).hfLazy;
  if (!lazyRaw || typeof lazyRaw !== "object") return null;
  const lazy = lazyRaw as Record<string, unknown>;
  const contextKey = typeof lazy.contextKey === "string" ? lazy.contextKey : "";
  const episodeIndex =
    typeof lazy.episodeIndex === "number" ? lazy.episodeIndex : Number.NaN;
  const startOffset =
    typeof lazy.startOffset === "number" ? lazy.startOffset : Number.NaN;
  const endOffset =
    typeof lazy.endOffset === "number" ? lazy.endOffset : Number.NaN;
  const frameCount =
    typeof lazy.frameCount === "number" ? lazy.frameCount : 0;
  const firstTimestamp =
    typeof lazy.firstTimestamp === "number" ? lazy.firstTimestamp : null;
  const lastTimestamp =
    typeof lazy.lastTimestamp === "number" ? lazy.lastTimestamp : null;
  const rawRanges = Array.isArray(lazy.ranges)
    ? (lazy.ranges as Array<Record<string, unknown>>)
    : null;
  const parsedRanges =
    rawRanges
      ?.map((entry) => {
        const parsedStart =
          typeof entry.startOffset === "number"
            ? entry.startOffset
            : Number.NaN;
        const parsedEnd =
          typeof entry.endOffset === "number"
            ? entry.endOffset
            : Number.NaN;
        if (
          !Number.isFinite(parsedStart) ||
          !Number.isFinite(parsedEnd) ||
          parsedEnd < parsedStart
        ) {
          return null;
        }
        return {
          startOffset: Math.trunc(parsedStart),
          endOffset: Math.trunc(parsedEnd),
        };
      })
      .filter((entry): entry is HfLazyOffsetRange => entry !== null) ?? [];
  const normalizedRanges =
    parsedRanges.length > 0
      ? parsedRanges
      : Number.isFinite(startOffset) &&
        Number.isFinite(endOffset) &&
        endOffset >= startOffset
      ? [{ startOffset: Math.trunc(startOffset), endOffset: Math.trunc(endOffset) }]
      : [];
  normalizedRanges.sort((a, b) => a.startOffset - b.startOffset);
  if (!contextKey || !Number.isFinite(episodeIndex) || normalizedRanges.length === 0) {
    return null;
  }
  const firstRange = normalizedRanges[0];
  const lastRange = normalizedRanges[normalizedRanges.length - 1];
  return {
    contextKey,
    episodeIndex,
    startOffset: firstRange.startOffset,
    endOffset: lastRange.endOffset,
    ranges: normalizedRanges,
    frameCount: Math.max(0, frameCount),
    firstTimestamp,
    lastTimestamp,
  };
};

export const buildHfLazyFetchWindows = ({
  lazyRef,
  batchSize = HF_DATASET_ROWS_BATCH_SIZE,
}: {
  lazyRef: HfLazyEpisodeRef;
  batchSize?: number;
}) => {
  const mergedRanges: HfLazyOffsetRange[] = [];
  normalizeHfLazyRanges(lazyRef).forEach((range) => {
    const lastRange = mergedRanges[mergedRanges.length - 1];
    if (!lastRange || range.startOffset > lastRange.endOffset + 1) {
      mergedRanges.push({ ...range });
      return;
    }
    lastRange.endOffset = Math.max(lastRange.endOffset, range.endOffset);
  });

  const windowsToFetch: HfLazyFetchWindow[] = [];
  mergedRanges.forEach((range) => {
    for (
      let cursor = range.startOffset;
      cursor <= range.endOffset;
      cursor += batchSize
    ) {
      windowsToFetch.push({
        offset: cursor,
        length: Math.min(batchSize, range.endOffset - cursor + 1),
      });
    }
  });
  return windowsToFetch;
};

export const groupHfLazyFetchWindows = ({
  windows,
  maxConcurrentWindows = HF_LAZY_EPISODE_FETCH_MAX_CONCURRENT_WINDOWS,
}: {
  windows: readonly HfLazyFetchWindow[];
  maxConcurrentWindows?: number;
}) => {
  const normalizedConcurrency = Math.max(
    1,
    Number.isFinite(maxConcurrentWindows)
      ? Math.trunc(maxConcurrentWindows)
      : 1
  );
  const groups: HfLazyFetchWindow[][] = [];
  for (let index = 0; index < windows.length; index += normalizedConcurrency) {
    groups.push(windows.slice(index, index + normalizedConcurrency));
  }
  return groups;
};

export const useHfLazyEpisodeLoader = ({
  episodes,
  episodesRef,
  setEpisodes,
  effectiveHfToken,
  toNumericRows,
  setEpisodePipelineState,
  beginPipelineEpisodeLoad,
  finishPipelineEpisodeLoad,
  syncEpisodePipelineReadiness,
  clearMissingPipelineEpisodes,
}: UseHfLazyEpisodeLoaderParams) => {
  const lazyLoadContextsRef = useRef<Map<string, HfLazyLoadContext>>(new Map());
  const materializingPromisesRef = useRef<Map<string, Promise<Episode | null>>>(
    new Map()
  );
  const loadedEpisodeQueueRef = useRef<string[]>([]);

  const getLazyEpisodeRef = useCallback(
    (episode: Episode) => resolveHfLazyEpisodeRef(episode),
    []
  );

  const registerLazyLoadContext = useCallback(
    (contextKey: string, context: HfLazyLoadContext) => {
      lazyLoadContextsRef.current.set(contextKey, context);
    },
    []
  );

  const materializeEpisode = useCallback(
    async (episode: Episode): Promise<Episode | null> => {
      if (episode.frames.length > 0) {
        setEpisodePipelineState(episode.id, {
          status: "ready",
        });
        return episode;
      }

      const lazyRef = getLazyEpisodeRef(episode);
      if (!lazyRef) {
        setEpisodePipelineState(episode.id, {
          status: "error",
          message: "Episode is missing lazy-load metadata.",
        });
        return null;
      }

      const context = lazyLoadContextsRef.current.get(lazyRef.contextKey);
      if (!context) {
        const message = "Missing lazy episode context. Reload the dataset partition.";
        setEpisodePipelineState(episode.id, {
          status: "error",
          message,
        });
        toast.error(message);
        return null;
      }

      const existingMaterialization = materializingPromisesRef.current.get(episode.id);
      if (existingMaterialization) {
        return existingMaterialization;
      }

      const started = beginPipelineEpisodeLoad(
        episode.id,
        `Loading episode ${lazyRef.episodeIndex}`
      );
      if (!started) {
        return null;
      }

      const materializePromise = (async () => {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (effectiveHfToken) {
          headers.Authorization = `Bearer ${effectiveHfToken}`;
        }

        const loadingToastId = toast.loading(
          `Loading episode ${lazyRef.episodeIndex}...`,
          { duration: Infinity }
        );

        try {
          const rawRowsWithOffset: Array<{
            row: Record<string, unknown>;
            rowOffset: number;
          }> = [];
          const windowsToFetch = buildHfLazyFetchWindows({ lazyRef });
          if (windowsToFetch.length === 0) {
            throw new Error("Episode has no indexed row windows");
          }

          const episodeFetchDeadline = Date.now() + HF_LAZY_EPISODE_FETCH_RUNTIME_MS;
          const fetchBatch = async (windowToFetch: { offset: number; length: number }) => {
            const rowsUrl = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(
              context.datasetPath
            )}&config=${encodeURIComponent(context.config)}&split=${encodeURIComponent(
              context.split
            )}&offset=${windowToFetch.offset}&length=${windowToFetch.length}`;
            const data = await fetchJsonWithRetry<{ rows?: HfDatasetServerRow[] }>(
              rowsUrl,
              { headers },
              {
                maxAttempts: HF_LAZY_EPISODE_FETCH_RETRY_MAX_ATTEMPTS,
                baseDelayMs: HF_LAZY_EPISODE_FETCH_RETRY_BASE_DELAY_MS,
                maxDelayMs: HF_LAZY_EPISODE_FETCH_RETRY_MAX_DELAY_MS,
                fetcher: fetchHfResource,
                label: `Episode rows offset ${windowToFetch.offset}`,
              }
            );
            const rows = (data.rows || []) as HfDatasetServerRow[];
            rows.forEach((rowWrapper, index) => {
              const wrapper = rowWrapper as {
                row?: Record<string, unknown>;
                row_idx?: number;
              };
              const row = unwrapHfDatasetServerRow(rowWrapper);
              if (!row || typeof row !== "object") return;
              const episodeIndex = toFiniteNumber(
                (row as Record<string, unknown>).episode_index,
                0
              );
              if (episodeIndex !== lazyRef.episodeIndex) {
                return;
              }
              rawRowsWithOffset.push({
                row: row as Record<string, unknown>,
                rowOffset:
                  typeof wrapper.row_idx === "number" &&
                  Number.isFinite(wrapper.row_idx)
                    ? Math.trunc(wrapper.row_idx)
                    : windowToFetch.offset + index,
              });
            });
          };

          const failedWindows: HfLazyFetchWindow[] = [];
          const windowGroups = groupHfLazyFetchWindows({
            windows: windowsToFetch,
          });
          let nextWindowGroupIndex = 0;
          for (const [groupIndex, windowGroup] of windowGroups.entries()) {
            if (Date.now() >= episodeFetchDeadline) {
              break;
            }
            const groupResults = await Promise.allSettled(
              windowGroup.map(async (windowToFetch) => {
                await fetchBatch(windowToFetch);
                return windowToFetch;
              })
            );
            nextWindowGroupIndex = groupIndex + 1;
            groupResults.forEach((result, resultIndex) => {
              if (result.status === "fulfilled") {
                return;
              }
              const failedWindow = windowGroup[resultIndex];
              if (failedWindow) {
                failedWindows.push(failedWindow);
              }
            });
            if (failedWindows.length >= HF_LAZY_EPISODE_FETCH_MAX_FAILED_WINDOWS) {
              break;
            }
            if (nextWindowGroupIndex < windowGroups.length) {
              await sleep(HF_LAZY_EPISODE_FETCH_INTER_WINDOW_DELAY_MS);
            }
          }

          const unresolvedWindows = [
            ...failedWindows,
            ...windowGroups.slice(nextWindowGroupIndex).flat(),
          ];
          if (unresolvedWindows.length > 0 && rawRowsWithOffset.length === 0) {
            throw new Error(
              "Episode fetch is rate-limited right now. Wait a few seconds, then retry this episode."
            );
          }

          rawRowsWithOffset.sort((left, right) => {
            const leftFrame = toFiniteNumber(left.row.frame_index, 0);
            const rightFrame = toFiniteNumber(right.row.frame_index, 0);
            if (leftFrame !== rightFrame) {
              return leftFrame - rightFrame;
            }
            return left.rowOffset - right.rowOffset;
          });

          const rawRows = rawRowsWithOffset.map((entry) => entry.row);
          if (rawRows.length === 0) {
            throw new Error("No rows found for selected episode");
          }

          const materialized = await materializeHfEpisodeFramesAsync({
            numericRows: toNumericRows(rawRows, context.signalField),
            signalProfile: context.signalProfile,
            jointMapping: context.jointMapping,
            jointOffsets: context.jointOffsets,
            jointInversions: context.jointInversions,
            degToRad: context.degToRad,
            jointLimitsSnapshot: context.jointLimitsSnapshot,
            limitModesByJoint: context.limitModesByJoint,
            fallbackFps: HF_DATASET_DEFAULT_FPS,
          });
          if (materialized.error) {
            throw new Error(materialized.error);
          }
          const {
            frames: correctedFrames,
            report,
            fps,
            durationSec,
            mappedJointNames,
          } = materialized;

          const videoClipBounds = computeGlobalVideoClipBoundsFromRows(rawRows, fps);
          const videos = buildHfEpisodeVideosMetadata(
            rawRows,
            context.videoCameraKeys,
            context.videoPathTemplate
          );

          const updatedEpisode: Episode = {
            ...episode,
            frames: correctedFrames,
            metadata: {
              ...(episode.metadata ?? {}),
              fps,
              num_frames: correctedFrames.length,
              episode_length_sec: durationSec,
              joint_names: mappedJointNames,
              naming_status: deriveNamingStatus({ joint_names: mappedJointNames }),
              representation_id: DEFAULT_SEMANTIC_REPRESENTATION_ID,
              signal_profile_id:
                episode.metadata?.signal_profile_id ??
                context.signalProfile.profileId,
              signal_profile_version:
                episode.metadata?.signal_profile_version ??
                context.signalProfile.profileVersion,
              signal_base_mode:
                episode.metadata?.signal_base_mode ?? context.signalBaseMode,
              signal_mapping_report:
                episode.metadata?.signal_mapping_report ??
                context.signalProfile.report,
              videos:
                Object.keys(videos).length > 0
                  ? videos
                  : (episode.metadata?.videos ?? {}),
              ...(context.videoPathTemplate
                ? { video_path: context.videoPathTemplate }
                : {}),
              additional: buildDatasetTreatmentAdditionalFields({
                sourceType: "hf",
                sourceName: context.sourceDisplayName,
                hfDatasetRepo: context.datasetPath,
                canonicalSource: context.datasetPath,
                sourceId: `hf:${context.datasetPath}:${context.config}:${context.split}:${lazyRef.episodeIndex}`,
                baseAdditional: episode.metadata?.additional,
                extraAdditional: {
                  hfConfig: context.config,
                  hfSplit: context.split,
                  hfSignalField: context.signalField ?? undefined,
                  ...(videoClipBounds
                    ? {
                        video_clip_start_sec: videoClipBounds.startSec,
                        video_clip_end_sec: videoClipBounds.endSec,
                      }
                    : {}),
                  ...(report ? { limitCorrections: report } : {}),
                },
              }),
            },
          };

          loadedEpisodeQueueRef.current = [
            ...loadedEpisodeQueueRef.current.filter((id) => id !== episode.id),
            episode.id,
          ];
          const overflow =
            loadedEpisodeQueueRef.current.length - HF_LAZY_EPISODE_CACHE_LIMIT;
          const toEvictIds =
            overflow > 0 ? loadedEpisodeQueueRef.current.slice(0, overflow) : [];
          if (overflow > 0) {
            loadedEpisodeQueueRef.current = loadedEpisodeQueueRef.current.slice(overflow);
          }
          const toEvictSet = new Set(toEvictIds);

          const nextEpisodes = episodesRef.current.map((candidate) => {
            if (candidate.id === episode.id) {
              return updatedEpisode;
            }
            if (toEvictSet.has(candidate.id) && getLazyEpisodeRef(candidate)) {
              return {
                ...candidate,
                frames: [],
              };
            }
            return candidate;
          });
          episodesRef.current = nextEpisodes;
          setEpisodes(nextEpisodes);
          finishPipelineEpisodeLoad(episode.id, {
            status: "ready",
            message: undefined,
          });

          return updatedEpisode;
        } catch (error) {
          console.error("Failed to stream episode:", error);
          const classified = classifyEpisodeFetchError(error);
          finishPipelineEpisodeLoad(episode.id, {
            status:
              classified.kind === "throttled"
                ? "throttled"
                : classified.kind === "fatal" ||
                    classified.kind === "network" ||
                    classified.kind === "empty"
                  ? "error"
                  : "indexed",
            message: classified.message,
            retryAfterMs: classified.retryAfterMs,
          });
          toast.error(classified.message);
          return null;
        } finally {
          toast.dismiss(loadingToastId);
        }
      })();

      materializingPromisesRef.current.set(episode.id, materializePromise);
      try {
        return await materializePromise;
      } finally {
        materializingPromisesRef.current.delete(episode.id);
      }
    },
    [
      beginPipelineEpisodeLoad,
      effectiveHfToken,
      episodesRef,
      finishPipelineEpisodeLoad,
      getLazyEpisodeRef,
      setEpisodePipelineState,
      setEpisodes,
      toNumericRows,
    ]
  );

  useEffect(() => {
    const liveEpisodeIds = new Set(episodes.map((episode) => episode.id));
    loadedEpisodeQueueRef.current = loadedEpisodeQueueRef.current.filter((id) =>
      liveEpisodeIds.has(id)
    );
    materializingPromisesRef.current.forEach((_promise, id) => {
      if (!liveEpisodeIds.has(id)) {
        materializingPromisesRef.current.delete(id);
      }
    });

    const activeContextKeys = new Set<string>();
    episodes.forEach((episode) => {
      const lazyRef = getLazyEpisodeRef(episode);
      if (lazyRef) {
        activeContextKeys.add(lazyRef.contextKey);
      }
    });

    for (const key of lazyLoadContextsRef.current.keys()) {
      if (!activeContextKeys.has(key)) {
        lazyLoadContextsRef.current.delete(key);
      }
    }

    syncEpisodePipelineReadiness(
      episodes.map((episode) => ({
        id: episode.id,
        hasFrames: episode.frames.length > 0,
        isLazy: Boolean(getLazyEpisodeRef(episode)),
      }))
    );
    clearMissingPipelineEpisodes(episodes.map((episode) => episode.id));
  }, [
    clearMissingPipelineEpisodes,
    episodes,
    getLazyEpisodeRef,
    syncEpisodePipelineReadiness,
  ]);

  return {
    getLazyEpisodeRef,
    registerLazyLoadContext,
    materializeEpisode,
  };
};
