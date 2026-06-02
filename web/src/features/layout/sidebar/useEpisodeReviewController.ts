import { useCallback, useEffect } from "react";
import { toast } from "sonner";

import { toAnimationFrames, type Episode, type RecordedFrame } from "@/features/dataset";
import { EPISODE_VELOCITY_LIMIT_TOLERANCE } from "@/features/dataset/episodeReviewParams";
import {
  applyTargetFpsToEpisodes,
  applyEpisodeLimitCorrections,
  buildEpisodeDataExport,
  buildEpisodeSaveResult,
  computeEpisodeFps,
} from "@/features/layout/sidebar/episodeReviewHelpers";
import { computeVelocityStatusForFrames } from "@/features/layout/sidebar/sidebarHelpers";
import { viewerPlayback } from "@/features/viewer/playback/viewerPlayback";
import type { LoadedReplayEpisode } from "@/features/layout/sidebar/useReplaySessionController";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { JointLimitMode } from "@/shared/types/feature";
import type { EpisodeSaveHandler } from "@/shared/types/feature";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

type UseEpisodeReviewControllerParams = {
  jointLimits: JointLimits;
  robotBaseName: string;
  targetFps: number;
  currentFrame?: number;
  episodesRef: MutableRefObject<Episode[]>;
  setEpisodes: Dispatch<SetStateAction<Episode[]>>;
  setCurrentPlayingEpisodeIndex: Dispatch<SetStateAction<number | null>>;
  currentLoadedEpisodeRef: MutableRefObject<LoadedReplayEpisode | null>;
  isPlayingAllRef: MutableRefObject<boolean>;
  getJointOrderForFrames: (frames: RecordedFrame[]) => string[];
  onEpisodeSaveHandlerChange?: (handler: EpisodeSaveHandler | undefined) => void;
  onViewerEpisodeChange?: (episode: Episode | null) => void;
  onViewerOpenChange?: (open: boolean) => void;
  onViewerSplitViewChange?: (splitView: boolean) => void;
};

export const useEpisodeReviewController = ({
  jointLimits,
  robotBaseName,
  targetFps,
  currentFrame,
  episodesRef,
  setEpisodes,
  setCurrentPlayingEpisodeIndex,
  currentLoadedEpisodeRef,
  isPlayingAllRef,
  getJointOrderForFrames,
  onEpisodeSaveHandlerChange,
  onViewerEpisodeChange,
  onViewerOpenChange,
  onViewerSplitViewChange,
}: UseEpisodeReviewControllerParams) => {
  const getEpisodeVelocityStatus = useCallback(
    (episode: Episode) =>
      computeVelocityStatusForFrames(
        episode.frames,
        jointLimits,
        EPISODE_VELOCITY_LIMIT_TOLERANCE
      ),
    [jointLimits]
  );

  const syncEpisodePlayback = useCallback(
    (episode: Episode, episodeIndex: number) => {
      onViewerSplitViewChange?.(true);
      onViewerOpenChange?.(true);
      onViewerEpisodeChange?.(episode);

      const resumeFrame = Math.max(
        0,
        Math.min(currentFrame ?? 0, episode.frames.length - 1)
      );
      viewerPlayback.playEpisode(toAnimationFrames(episode), {
        autoplay: isPlayingAllRef.current,
        startFrame: resumeFrame,
        playbackEpisode: episode,
      });
      currentLoadedEpisodeRef.current = {
        index: episodeIndex,
        episodeId: episode.id,
        framesRef: episode.frames,
      };
    },
    [
      currentFrame,
      currentLoadedEpisodeRef,
      isPlayingAllRef,
      onViewerEpisodeChange,
      onViewerOpenChange,
      onViewerSplitViewChange,
    ]
  );

  const handleEpisodeSave = useCallback<EpisodeSaveHandler>(
    (episodeToSave: Episode, saveAsNew: boolean, newName?: string) => {
      if (!episodeToSave || episodeToSave.frames.length === 0) {
        toast.error("Episode has no frames to save");
        return;
      }

      const now = Date.now();
      const trimmedName = newName?.trim();

      const saveResult = buildEpisodeSaveResult({
        previousEpisodes: episodesRef.current,
        episodeToSave,
        saveAsNew,
        newName,
        now,
      });

      if (saveResult.errorMessage) {
        toast.error(saveResult.errorMessage);
        return;
      }

      const savedEpisode = saveResult.savedEpisode;
      if (!savedEpisode) {
        return;
      }

      const savedEpisodeIndex = saveResult.episodes.findIndex(
        (candidate) => candidate.id === savedEpisode.id
      );
      if (savedEpisodeIndex < 0) {
        toast.error("Saved episode could not be selected");
        return;
      }

      episodesRef.current = saveResult.episodes;
      setEpisodes(saveResult.episodes);
      syncEpisodePlayback(savedEpisode, savedEpisodeIndex);
      setCurrentPlayingEpisodeIndex(savedEpisodeIndex);

      toast.success(
        saveAsNew
          ? `Saved ${trimmedName || `Episode ${savedEpisode.number}`}`
          : `Episode ${savedEpisode.number} updated`
      );
    },
    [
      episodesRef,
      setCurrentPlayingEpisodeIndex,
      setEpisodes,
      syncEpisodePlayback,
    ]
  );

  useEffect(() => {
    if (!onEpisodeSaveHandlerChange) return;
    onEpisodeSaveHandlerChange(handleEpisodeSave);
    return () => onEpisodeSaveHandlerChange(undefined);
  }, [handleEpisodeSave, onEpisodeSaveHandlerChange]);

  const applyTargetFps = useCallback(() => {
    if (!Number.isFinite(targetFps) || targetFps <= 0) {
      toast.error("Enter a valid target FPS");
      return;
    }

    const result = applyTargetFpsToEpisodes({
      episodes: episodesRef.current,
      targetFps,
    });

    if (result.updatedCount === 0) {
      toast.info("All episodes already match target FPS");
      return;
    }

    const loadedEpisode = currentLoadedEpisodeRef.current;
    episodesRef.current = result.episodes;
    setEpisodes(result.episodes);

    if (loadedEpisode) {
      const reloadedEpisode = result.episodes[loadedEpisode.index];
      if (
        reloadedEpisode &&
        reloadedEpisode.id === loadedEpisode.episodeId &&
        reloadedEpisode.frames !== loadedEpisode.framesRef
      ) {
        syncEpisodePlayback(reloadedEpisode, loadedEpisode.index);
      }
    }

    toast.success(`Applied ${targetFps} FPS to ${result.updatedCount} episode(s)`);
  }, [
    currentLoadedEpisodeRef,
    episodesRef,
    setEpisodes,
    syncEpisodePlayback,
    targetFps,
  ]);

  const applyLimitCorrections = useCallback(
    (
      frames: RecordedFrame[],
      modeByJoint: Record<string, JointLimitMode | undefined> = {},
      limitsOverride?: JointLimits
    ) =>
      applyEpisodeLimitCorrections(
        frames,
        jointLimits,
        modeByJoint,
        limitsOverride
      ),
    [jointLimits]
  );

  const exportEpisodeToDataFile = useCallback(
    (episode: Episode) => {
      if (episode.frames.length === 0) {
        toast.error("No recorded data to export");
        return;
      }

      const { filename, content } = buildEpisodeDataExport({
        episode,
        robotBaseName,
        getJointOrderForFrames,
      });
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported Episode ${episode.number} to ${filename}`);
    },
    [getJointOrderForFrames, robotBaseName]
  );

  return {
    computeEpisodeFps,
    getEpisodeVelocityStatus,
    applyTargetFps,
    applyLimitCorrections,
    exportEpisodeToDataFile,
  };
};
