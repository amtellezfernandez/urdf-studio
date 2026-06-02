import { useCallback, type MutableRefObject } from "react";
import { toast } from "sonner";

import type { Episode } from "@/features/dataset";
import {
  buildDeleteEpisodeMutation,
  buildMoveEpisodeMutation,
  buildRetakeEpisodeMutation,
  type EpisodeMoveDirection,
  type RetakeEpisodeRecordingRequest,
} from "@/features/layout/sidebar/episodeMutationHelpers";
import { resolveSelectedReplayEpisodeId } from "@/features/layout/sidebar/replaySelection";
import type { LoadedReplayEpisode } from "@/features/layout/sidebar/useReplaySessionController";

type UseEpisodeMutationControllerParams = {
  episodesRef: MutableRefObject<Episode[]>;
  currentPlayingEpisodeIndex: number | null;
  currentLoadedEpisodeRef: MutableRefObject<LoadedReplayEpisode | null>;
  isPlayingAllRef: MutableRefObject<boolean>;
  applyEpisodeMutationSelection: (
    nextEpisodes: Episode[],
    nextSelectionIndex: number | null
  ) => void;
  stopReplayPlaybackState: (options?: { clearLoadedEpisode?: boolean }) => void;
  resetReplayFrameToStart: () => void;
  beginRecording: (options?: RetakeEpisodeRecordingRequest) => unknown;
  setIsAnimating: (value: boolean) => void;
};

export const useEpisodeMutationController = ({
  episodesRef,
  currentPlayingEpisodeIndex,
  currentLoadedEpisodeRef,
  isPlayingAllRef,
  applyEpisodeMutationSelection,
  stopReplayPlaybackState,
  resetReplayFrameToStart,
  beginRecording,
  setIsAnimating,
}: UseEpisodeMutationControllerParams) => {
  const resolveSelectedEpisodeId = useCallback(
    () =>
      resolveSelectedReplayEpisodeId({
        episodes: episodesRef.current,
        currentPlayingEpisodeIndex,
        loadedEpisodeId: currentLoadedEpisodeRef.current?.episodeId ?? null,
      }),
    [currentLoadedEpisodeRef, currentPlayingEpisodeIndex, episodesRef]
  );

  const runLockedMutation = useCallback(
    <T,>(mutation: () => T): T => {
      setIsAnimating(true);
      try {
        return mutation();
      } finally {
        setIsAnimating(false);
      }
    },
    [setIsAnimating]
  );

  const deleteEpisode = useCallback(
    (episodeId: string) => {
      const result = runLockedMutation(() => {
        const mutation = buildDeleteEpisodeMutation({
          episodes: episodesRef.current,
          episodeId,
          selectedEpisodeId: resolveSelectedEpisodeId(),
          isPlayingAll: isPlayingAllRef.current,
        });
        if (!mutation) {
          return null;
        }

        if (mutation.shouldStopPlayback) {
          stopReplayPlaybackState();
          if (mutation.shouldResetFrame) {
            resetReplayFrameToStart();
          }
        }

        applyEpisodeMutationSelection(
          mutation.nextEpisodes,
          mutation.nextSelectionIndex
        );
        return mutation;
      });

      if (!result) {
        return;
      }

      if (result.shouldNotifyPlaybackStopped) {
        toast.info("Stopped playback - episode deleted");
      }
      toast.success("Episode deleted");
    },
    [
      applyEpisodeMutationSelection,
      episodesRef,
      isPlayingAllRef,
      resetReplayFrameToStart,
      resolveSelectedEpisodeId,
      runLockedMutation,
      stopReplayPlaybackState,
    ]
  );

  const deleteEpisodes = useCallback(
    (episodeIds: string[]) => {
      const normalizedEpisodeIds = Array.from(
        new Set(episodeIds.filter((episodeId) => episodeId.trim().length > 0))
      );
      if (normalizedEpisodeIds.length === 0) {
        return false;
      }

      const result = runLockedMutation(() => {
        let workingEpisodes = episodesRef.current;
        let selectedEpisodeId = resolveSelectedEpisodeId();
        let nextSelectionIndex = currentPlayingEpisodeIndex;
        let shouldStopPlayback = false;
        let shouldResetFrame = false;
        let shouldNotifyPlaybackStopped = false;

        normalizedEpisodeIds.forEach((episodeId) => {
          const mutation = buildDeleteEpisodeMutation({
            episodes: workingEpisodes,
            episodeId,
            selectedEpisodeId,
            isPlayingAll: isPlayingAllRef.current,
          });
          if (!mutation) {
            return;
          }
          workingEpisodes = mutation.nextEpisodes;
          nextSelectionIndex = mutation.nextSelectionIndex;
          shouldStopPlayback = shouldStopPlayback || mutation.shouldStopPlayback;
          shouldResetFrame = shouldResetFrame || mutation.shouldResetFrame;
          shouldNotifyPlaybackStopped =
            shouldNotifyPlaybackStopped || mutation.shouldNotifyPlaybackStopped;
          selectedEpisodeId =
            nextSelectionIndex === null
              ? null
              : workingEpisodes[nextSelectionIndex]?.id ?? null;
        });

        if (workingEpisodes === episodesRef.current) {
          return null;
        }

        if (shouldStopPlayback) {
          stopReplayPlaybackState();
          if (shouldResetFrame) {
            resetReplayFrameToStart();
          }
        }

        applyEpisodeMutationSelection(workingEpisodes, nextSelectionIndex);
        return {
          shouldNotifyPlaybackStopped,
        };
      });

      if (!result) {
        return false;
      }

      if (result.shouldNotifyPlaybackStopped) {
        toast.info("Stopped playback - episode deleted");
      }
      return true;
    },
    [
      applyEpisodeMutationSelection,
      currentPlayingEpisodeIndex,
      episodesRef,
      isPlayingAllRef,
      resetReplayFrameToStart,
      resolveSelectedEpisodeId,
      runLockedMutation,
      stopReplayPlaybackState,
    ]
  );

  const retakeEpisode = useCallback(
    (episodeId: string) => {
      const result = runLockedMutation(() => {
        const mutation = buildRetakeEpisodeMutation({
          episodes: episodesRef.current,
          episodeId,
          selectedEpisodeId: resolveSelectedEpisodeId(),
          isPlayingAll: isPlayingAllRef.current,
        });
        if (!mutation) {
          return null;
        }

        if (mutation.shouldStopPlayback) {
          stopReplayPlaybackState();
        }

        applyEpisodeMutationSelection(
          mutation.nextEpisodes,
          mutation.nextSelectionIndex
        );
        return mutation;
      });

      if (!result) {
        return;
      }

      beginRecording(result.recordingRequest);
      toast.info(`Recording Episode ${result.recordingRequest.episodeNumber} (retake)`);
    },
    [
      applyEpisodeMutationSelection,
      beginRecording,
      episodesRef,
      isPlayingAllRef,
      resolveSelectedEpisodeId,
      runLockedMutation,
      stopReplayPlaybackState,
    ]
  );

  const moveEpisode = useCallback(
    (episodeId: string, direction: EpisodeMoveDirection) => {
      const result = runLockedMutation(() => {
        const mutation = buildMoveEpisodeMutation({
          episodes: episodesRef.current,
          episodeId,
          direction,
          selectedEpisodeId: resolveSelectedEpisodeId(),
          isPlayingAll: isPlayingAllRef.current,
        });
        if (!mutation) {
          return null;
        }

        if (mutation.shouldStopPlayback) {
          stopReplayPlaybackState();
        }

        applyEpisodeMutationSelection(
          mutation.nextEpisodes,
          mutation.nextSelectionIndex
        );
        return mutation;
      });

      if (result?.shouldNotifyPlaybackStopped) {
        toast.info("Stopped playback - episode order changed");
      }
    },
    [
      applyEpisodeMutationSelection,
      episodesRef,
      isPlayingAllRef,
      resolveSelectedEpisodeId,
      runLockedMutation,
      stopReplayPlaybackState,
    ]
  );

  return {
    deleteEpisode,
    deleteEpisodes,
    retakeEpisode,
    moveEpisode,
  };
};
