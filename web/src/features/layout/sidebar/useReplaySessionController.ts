import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import type { Episode } from "@/features/dataset";
import { toAnimationFrames } from "@/features/dataset";
import type { EpisodeMaterializationState } from "@/features/dataset/episode-pipeline/types";
import { viewerPlayback } from "@/features/viewer/playback/viewerPlayback";
import type { PlaybackMode } from "@/features/viewer/playback/episodeCoordinator";
import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";

export type LoadedReplayEpisode = {
  index: number;
  episodeId: string;
  framesRef: Episode["frames"];
};

export const resolveReplayEpisodeForFrameLoad = ({
  episodes,
  episodeIndex,
  materializedEpisode,
}: {
  episodes: readonly Episode[];
  episodeIndex: number;
  materializedEpisode?: Episode | null;
}) => {
  if (episodeIndex < 0 || episodeIndex >= episodes.length) {
    return null;
  }

  const indexedEpisode = episodes[episodeIndex];
  if (!indexedEpisode) {
    return null;
  }

  if (
    materializedEpisode &&
    materializedEpisode.id === indexedEpisode.id &&
    materializedEpisode.frames.length > 0
  ) {
    return materializedEpisode;
  }

  return indexedEpisode.frames.length > 0 ? indexedEpisode : null;
};

export const shouldReloadReplayEpisode = ({
  currentLoadedEpisode,
  episodeIndex,
  episode,
  forceReload = false,
  hasPlaybackFrames = true,
  playbackEpisodeId = episode.id,
}: {
  currentLoadedEpisode: LoadedReplayEpisode | null;
  episodeIndex: number;
  episode: Episode;
  forceReload?: boolean;
  hasPlaybackFrames?: boolean;
  playbackEpisodeId?: string | null;
}) => {
  if (forceReload) {
    return true;
  }
  const isSameEpisode =
    currentLoadedEpisode?.index === episodeIndex &&
    currentLoadedEpisode?.episodeId === episode.id;
  const hasSameFrames = currentLoadedEpisode?.framesRef === episode.frames;
  const hasMatchingPlaybackEpisode = playbackEpisodeId === episode.id;
  return !isSameEpisode || !hasSameFrames || !hasPlaybackFrames || !hasMatchingPlaybackEpisode;
};

export const episodeHasPlayableFramesOrLazyRef = ({
  episode,
  getLazyEpisodeRef,
}: {
  episode: Episode | undefined | null;
  getLazyEpisodeRef: (episode: Episode) => unknown;
}) => {
  if (!episode) return false;
  return episode.frames.length > 0 || Boolean(getLazyEpisodeRef(episode));
};

export const resolveNextPlayableOrLazyEpisodeIndex = ({
  episodes,
  startIndex,
  getLazyEpisodeRef,
}: {
  episodes: readonly Episode[];
  startIndex: number;
  getLazyEpisodeRef: (episode: Episode) => unknown;
}) => {
  if (episodes.length === 0) return null;
  const normalizedStart =
    ((startIndex % episodes.length) + episodes.length) % episodes.length;
  for (let offset = 0; offset < episodes.length; offset += 1) {
    const candidate = (normalizedStart + offset) % episodes.length;
    if (
      episodeHasPlayableFramesOrLazyRef({
        episode: episodes[candidate],
        getLazyEpisodeRef,
      })
    ) {
      return candidate;
    }
  }
  return null;
};

export const hasReplayReachedEpisodeEnd = ({
  currentFrame,
  totalFrames,
}: {
  currentFrame?: number;
  totalFrames?: number;
}) => {
  if (!Number.isFinite(currentFrame) || !Number.isFinite(totalFrames) || (totalFrames ?? 0) <= 0) {
    return false;
  }
  return (currentFrame as number) >= (totalFrames as number) - 1;
};

type UseReplaySessionControllerParams = {
  episodesRef: MutableRefObject<Episode[]>;
  isPlayingAllRef: MutableRefObject<boolean>;
  currentPlayingEpisodeIndex: number | null;
  currentFrame?: number;
  totalFrames?: number;
  isPlaying: boolean;
  isPlayingAll: boolean;
  playbackMode: PlaybackMode | null;
  episodePipelineStates: Record<string, EpisodeMaterializationState | undefined>;
  getLazyEpisodeRef: (episode: Episode) => unknown;
  materializeEpisode: (episode: Episode) => Promise<Episode | null>;
  setEpisodes: Dispatch<SetStateAction<Episode[]>>;
  setCurrentPlayingEpisodeIndex: (index: number | null) => void;
  setIsPlayingAll: (value: boolean) => void;
  setPlaybackMode: Dispatch<SetStateAction<PlaybackMode | null>>;
  onFrameChange?: (frame: number) => void;
  onViewerOpenChange?: (open: boolean) => void;
  onViewerEpisodeChange?: (episode: Episode | null) => void;
  onViewerSplitViewChange?: (open: boolean) => void;
};

export const useReplaySessionController = ({
  episodesRef,
  isPlayingAllRef,
  currentPlayingEpisodeIndex,
  currentFrame,
  totalFrames,
  isPlaying,
  isPlayingAll,
  playbackMode,
  episodePipelineStates,
  getLazyEpisodeRef,
  materializeEpisode,
  setEpisodes,
  setCurrentPlayingEpisodeIndex,
  setIsPlayingAll,
  setPlaybackMode,
  onFrameChange,
  onViewerOpenChange,
  onViewerEpisodeChange,
  onViewerSplitViewChange,
}: UseReplaySessionControllerParams) => {
  const currentLoadedEpisodeRef = useRef<LoadedReplayEpisode | null>(null);
  const previousViewerPlayingRef = useRef<boolean>(false);

  const applyEpisodeMutationSelection = useCallback(
    (nextEpisodes: Episode[], nextSelectionIndex: number | null) => {
      episodesRef.current = nextEpisodes;
      setEpisodes(nextEpisodes);

      if (nextSelectionIndex === null) {
        currentLoadedEpisodeRef.current = null;
        setCurrentPlayingEpisodeIndex(null);
        return;
      }

      const nextSelectedEpisode = nextEpisodes[nextSelectionIndex] ?? null;
      if (!nextSelectedEpisode) {
        currentLoadedEpisodeRef.current = null;
        setCurrentPlayingEpisodeIndex(null);
        return;
      }

      setCurrentPlayingEpisodeIndex(nextSelectionIndex);
      if (currentLoadedEpisodeRef.current?.episodeId === nextSelectedEpisode.id) {
        currentLoadedEpisodeRef.current = {
          index: nextSelectionIndex,
          episodeId: nextSelectedEpisode.id,
          framesRef: nextSelectedEpisode.frames,
        };
      }
    },
    [episodesRef, setCurrentPlayingEpisodeIndex, setEpisodes]
  );

  const stopReplayPlaybackState = useCallback(
    ({
      clearLoadedEpisode = false,
    }: {
      clearLoadedEpisode?: boolean;
    } = {}) => {
      isPlayingAllRef.current = false;
      setIsPlayingAll(false);
      setPlaybackMode(null);
      viewerPlayback.stopAnimation();
      if (clearLoadedEpisode) {
        currentLoadedEpisodeRef.current = null;
      }
    },
    [isPlayingAllRef, setIsPlayingAll, setPlaybackMode]
  );

  const resetReplayFrameToStart = useCallback(() => {
    viewerPlayback.setFrame(0);
    onFrameChange?.(0);
  }, [onFrameChange]);

  const stopAllPlayback = useCallback(
    (options?: { clearLoadedEpisode?: boolean }) => {
      const clearLoadedEpisode = options?.clearLoadedEpisode ?? true;
      stopReplayPlaybackState({ clearLoadedEpisode });
    },
    [stopReplayPlaybackState]
  );

  const setEpisodeAndFrame = useCallback(
    (
      episodeIndex: number,
      frameIndex: number,
      options?: {
        forceReload?: boolean;
        materializedEpisode?: Episode | null;
      }
    ) => {
      const liveEpisodes = episodesRef.current;
      const episode = resolveReplayEpisodeForFrameLoad({
        episodes: liveEpisodes,
        episodeIndex,
        materializedEpisode: options?.materializedEpisode,
      });
      if (!episode) return;

      const clampedFrame = Math.max(
        0,
        Math.min(frameIndex, episode.frames.length - 1)
      );
      const shouldAutoplay = isPlayingAllRef.current;
      const playbackState = useViewerPlaybackStore.getState();

      if (
        shouldReloadReplayEpisode({
          currentLoadedEpisode: currentLoadedEpisodeRef.current,
          episodeIndex,
          episode,
          forceReload: options?.forceReload ?? false,
          hasPlaybackFrames: playbackState.hasFrames,
          playbackEpisodeId: playbackState.playbackEpisode?.id ?? null,
        })
      ) {
        viewerPlayback.playEpisode(toAnimationFrames(episode), {
          autoplay: shouldAutoplay,
          startFrame: clampedFrame,
          playbackEpisode: episode,
        });
        onFrameChange?.(clampedFrame);
        currentLoadedEpisodeRef.current = {
          index: episodeIndex,
          episodeId: episode.id,
          framesRef: episode.frames,
        };
      } else {
        viewerPlayback.setFrame(clampedFrame);
        onFrameChange?.(clampedFrame);
      }

      if (shouldAutoplay) {
        viewerPlayback.playAnimation(true);
      }

      setCurrentPlayingEpisodeIndex(episodeIndex);
    },
    [episodesRef, isPlayingAllRef, onFrameChange, setCurrentPlayingEpisodeIndex]
  );

  const findNextPlayableOrLazyEpisodeIndex = useCallback(
    (startIndex: number) =>
      resolveNextPlayableOrLazyEpisodeIndex({
        episodes: episodesRef.current,
        startIndex,
        getLazyEpisodeRef,
      }),
    [episodesRef, getLazyEpisodeRef]
  );

  const ensureEpisodeReadyAtIndex = useCallback(
    async (episodeIndex: number): Promise<{ episode: Episode; index: number } | null> => {
      const liveEpisodes = episodesRef.current;
      if (episodeIndex < 0 || episodeIndex >= liveEpisodes.length) return null;
      const episode = liveEpisodes[episodeIndex];
      if (!episode) return null;

      if (!episode.frames || episode.frames.length === 0) {
        if (!getLazyEpisodeRef(episode)) {
          return null;
        }
        const materializedEpisode = await materializeEpisode(episode);
        if (!materializedEpisode || materializedEpisode.frames.length === 0) {
          return null;
        }
        const refreshedIndex = episodesRef.current.findIndex(
          (candidate) => candidate.id === materializedEpisode.id
        );
        return {
          episode: materializedEpisode,
          index: refreshedIndex >= 0 ? refreshedIndex : episodeIndex,
        };
      }

      return { episode, index: episodeIndex };
    },
    [episodesRef, getLazyEpisodeRef, materializeEpisode]
  );

  const reportEpisodePlaybackUnavailable = useCallback(
    (episodeIndex: number) => {
      const latestEpisode = episodesRef.current[episodeIndex];
      const latestLazyRef =
        latestEpisode && latestEpisode.frames.length === 0
          ? getLazyEpisodeRef(latestEpisode)
          : null;
      const latestState = latestEpisode
        ? episodePipelineStates[latestEpisode.id]
        : undefined;
      if (latestState?.message) {
        toast.error(latestState.message);
      } else if (!latestLazyRef) {
        toast.error("Episode has no frames");
      } else {
        toast.error("Episode is indexed but not ready yet. Try loading it again.");
      }
    },
    [episodePipelineStates, episodesRef, getLazyEpisodeRef]
  );

  const playEpisode = useCallback(
    async (episode: Episode) => {
      if (!episode) {
        toast.error("Episode no longer exists");
        stopAllPlayback();
        return;
      }

      const initialIndex = episodesRef.current.findIndex(
        (candidate) => candidate.id === episode.id
      );
      if (initialIndex === -1) {
        toast.info("Episode no longer exists - stopping playback");
        stopAllPlayback();
        return;
      }

      const readyEpisode = await ensureEpisodeReadyAtIndex(initialIndex);
      if (!readyEpisode) {
        reportEpisodePlaybackUnavailable(initialIndex);
        stopAllPlayback();
        return;
      }
      if (!readyEpisode.episode.frames || readyEpisode.episode.frames.length === 0) {
        toast.error("Episode has no frames");
        stopAllPlayback();
        return;
      }

      const episodeToPlay = readyEpisode.episode;
      const episodeIndex = readyEpisode.index;
      const isCurrentlyPlaying =
        currentPlayingEpisodeIndex === episodeIndex && isPlayingAll;

      if (isCurrentlyPlaying) {
        stopReplayPlaybackState();
        return;
      }

      onViewerSplitViewChange?.(true);
      onViewerOpenChange?.(true);
      onViewerEpisodeChange?.(episodeToPlay);

      setPlaybackMode("single");
      setIsPlayingAll(true);
      isPlayingAllRef.current = true;

      const lastFrameIndex = episodeToPlay.frames.length - 1;
      const resumeFrame =
        currentPlayingEpisodeIndex === episodeIndex && currentFrame !== undefined
          ? Math.min(currentFrame, lastFrameIndex)
          : 0;
      const startFrame = resumeFrame >= lastFrameIndex ? 0 : resumeFrame;
      const shouldForceReload = currentPlayingEpisodeIndex === episodeIndex && startFrame === 0;
      setEpisodeAndFrame(
        episodeIndex,
        Math.min(startFrame, Math.max(0, episodeToPlay.frames.length - 1)),
        {
          forceReload: shouldForceReload,
          materializedEpisode: episodeToPlay,
        }
      );
    },
    [
      currentFrame,
      currentPlayingEpisodeIndex,
      ensureEpisodeReadyAtIndex,
      episodesRef,
      isPlayingAll,
      isPlayingAllRef,
      onViewerEpisodeChange,
      onViewerOpenChange,
      onViewerSplitViewChange,
      reportEpisodePlaybackUnavailable,
      setEpisodeAndFrame,
      setIsPlayingAll,
      setPlaybackMode,
      stopAllPlayback,
      stopReplayPlaybackState,
    ]
  );

  const playAllEpisodes = useCallback(
    (overrideFrame?: number) => {
      const liveEpisodes = episodesRef.current;
      if (liveEpisodes.length === 0) {
        toast.error("No episodes to play");
        return;
      }

      if (isPlayingAll) {
        stopAllPlayback({ clearLoadedEpisode: false });
        return;
      }

      setPlaybackMode("all");
      setIsPlayingAll(true);
      isPlayingAllRef.current = true;

      const startIndex =
        currentPlayingEpisodeIndex !== null ? currentPlayingEpisodeIndex : 0;
      const startFrame =
        overrideFrame !== undefined ? overrideFrame : (currentFrame ?? 0);
      const candidateIndex = findNextPlayableOrLazyEpisodeIndex(startIndex);
      if (candidateIndex === null) {
        toast.error("No playable episodes found");
        stopAllPlayback();
        return;
      }

      void (async () => {
        const readyEpisode = await ensureEpisodeReadyAtIndex(candidateIndex);
        if (!readyEpisode) {
          reportEpisodePlaybackUnavailable(candidateIndex);
          stopAllPlayback();
          return;
        }
        setEpisodeAndFrame(
          readyEpisode.index,
          Math.max(
            0,
            Math.min(startFrame, Math.max(readyEpisode.episode.frames.length - 1, 0))
          ),
          { materializedEpisode: readyEpisode.episode }
        );
      })();
    },
    [
      currentFrame,
      currentPlayingEpisodeIndex,
      ensureEpisodeReadyAtIndex,
      episodesRef,
      findNextPlayableOrLazyEpisodeIndex,
      isPlayingAll,
      isPlayingAllRef,
      reportEpisodePlaybackUnavailable,
      setEpisodeAndFrame,
      setIsPlayingAll,
      setPlaybackMode,
      stopAllPlayback,
    ]
  );

  useEffect(() => {
    const wasPlaying = previousViewerPlayingRef.current;
    previousViewerPlayingRef.current = isPlaying;

    if (!wasPlaying || isPlaying) {
      return;
    }
    if (!isPlayingAllRef.current) {
      return;
    }

    if (playbackMode === "single") {
      if (hasReplayReachedEpisodeEnd({ currentFrame, totalFrames })) {
        stopAllPlayback();
      }
      return;
    }

    if (playbackMode === "all") {
      if (!hasReplayReachedEpisodeEnd({ currentFrame, totalFrames })) {
        stopAllPlayback();
        return;
      }

      const startSearchFrom = (currentPlayingEpisodeIndex ?? -1) + 1;
      const nextIndex = findNextPlayableOrLazyEpisodeIndex(startSearchFrom);
      if (nextIndex === null) {
        stopAllPlayback();
        return;
      }

      void (async () => {
        const readyEpisode = await ensureEpisodeReadyAtIndex(nextIndex);
        if (!readyEpisode) {
          stopAllPlayback();
          return;
        }
        setPlaybackMode("all");
        setIsPlayingAll(true);
        isPlayingAllRef.current = true;
        setEpisodeAndFrame(readyEpisode.index, 0, {
          materializedEpisode: readyEpisode.episode,
        });
      })();
      return;
    }

    if (isPlayingAllRef.current) {
      stopReplayPlaybackState();
    }
  }, [
    currentFrame,
    currentPlayingEpisodeIndex,
    ensureEpisodeReadyAtIndex,
    findNextPlayableOrLazyEpisodeIndex,
    isPlaying,
    isPlayingAllRef,
    playbackMode,
    setEpisodeAndFrame,
    setIsPlayingAll,
    setPlaybackMode,
    stopReplayPlaybackState,
    stopAllPlayback,
    totalFrames,
  ]);

  return {
    currentLoadedEpisodeRef,
    applyEpisodeMutationSelection,
    stopReplayPlaybackState,
    resetReplayFrameToStart,
    stopAllPlayback,
    setEpisodeAndFrame,
    playEpisode,
    playAllEpisodes,
  };
};
