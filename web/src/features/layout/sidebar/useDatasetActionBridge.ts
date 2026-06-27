import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import type {
  DatasetActions,
  DatasetOpsLocalExportResult,
  DatasetReviewDeleteTarget,
} from "@/features/dataset/datasetActions";
import type {
  DatasetSessionEpisodeListResponse,
  DatasetSessionEpisodeListOptions,
  DatasetSessionFlagEpisodesResponse,
  DatasetSessionFlagUpdate,
  DatasetSessionReviewResponse,
  DatasetSessionSummary,
} from "@/features/dataset/datasetSessionTypes";
import type { DatasetConstraintSettings } from "@/features/dataset/episode-viewer/constraintSettings";
import { renumberEpisodes, type Episode } from "@/features/dataset";
import { openLocalDatasetFilePicker } from "@/features/layout/sidebar/datasetActionHelpers";
import type { CredentialGate } from "@/shared/config/credentials";
import type { JointLimitMode } from "@/shared/types/feature";

type UseDatasetActionBridgeParams = {
  onDatasetActionsReady?: (actions: DatasetActions) => void;
  episodes: Episode[];
  episodesRef: MutableRefObject<Episode[]>;
  setEpisodes: Dispatch<SetStateAction<Episode[]>>;
  currentPlayingEpisodeIndex: number | null;
  setCurrentPlayingEpisodeIndex: Dispatch<SetStateAction<number | null>>;
  loadEpisodesFromHuggingFaceDataset: () => void;
  loadPendingHfRemainder: () => void;
  abortPendingHfRemainderLoad: () => void;
  materializeHfLazyEpisode: (episode: Episode) => Promise<Episode | null>;
  exportDatasetToLeRobotFormat: () => void;
  exportRecordedEpisodesForOps?: () => Promise<DatasetOpsLocalExportResult>;
  uploadEpisodesToHuggingFace: () => void;
  clearPendingHfRemainderUi: () => void;
  resetPipelineProgress: () => void;
  setPipelineStage: (stage: "idle", stageMessage?: string) => void;
  stopReplayPlaybackState: (options?: { clearLoadedEpisode?: boolean }) => void;
  resetReplayFrameToStart: () => void;
  isImportingFromHFDataset: boolean;
  pendingHfRemainderLabel: string | null;
  isLoadingPendingHfRemainder: boolean;
  isExportingDataset: boolean;
  isUploadingToHF: boolean;
  exportLimitMode: JointLimitMode;
  setExportLimitMode: (mode: JointLimitMode) => void;
  constraintSettings: DatasetConstraintSettings;
  setConstraintSettings: Dispatch<SetStateAction<DatasetConstraintSettings>>;
  hfTokenGate: CredentialGate;
  playEpisodeById: (episodeId: string) => Promise<void>;
  playReviewEpisode?: (episodeId: string) => Promise<void>;
  selectEpisodeById: (episodeId: string) => void;
  deleteEpisodesFromReview: (
    episodes: readonly DatasetReviewDeleteTarget[]
  ) => Promise<void>;
  datasetSessionSummary: DatasetSessionSummary | null;
  datasetSessionStatus: "idle" | "syncing" | "ready" | "error";
  datasetSessionError: string | null;
  listReviewEpisodes: (
    options?: DatasetSessionEpisodeListOptions
  ) => Promise<DatasetSessionEpisodeListResponse | null>;
  getReviewState: () => Promise<DatasetSessionReviewResponse | null>;
  updateReviewFlags: (
    updates: DatasetSessionFlagUpdate[]
  ) => Promise<DatasetSessionFlagEpisodesResponse | null>;
};

export const useDatasetActionBridge = ({
  onDatasetActionsReady,
  episodes,
  episodesRef,
  setEpisodes,
  currentPlayingEpisodeIndex,
  setCurrentPlayingEpisodeIndex,
  loadEpisodesFromHuggingFaceDataset,
  loadPendingHfRemainder,
  abortPendingHfRemainderLoad,
  materializeHfLazyEpisode,
  exportDatasetToLeRobotFormat,
  exportRecordedEpisodesForOps,
  uploadEpisodesToHuggingFace,
  clearPendingHfRemainderUi,
  resetPipelineProgress,
  setPipelineStage,
  stopReplayPlaybackState,
  resetReplayFrameToStart,
  isImportingFromHFDataset,
  pendingHfRemainderLabel,
  isLoadingPendingHfRemainder,
  isExportingDataset,
  isUploadingToHF,
  exportLimitMode,
  setExportLimitMode,
  constraintSettings,
  setConstraintSettings,
  hfTokenGate,
  playEpisodeById,
  playReviewEpisode,
  selectEpisodeById,
  deleteEpisodesFromReview,
  datasetSessionSummary,
  datasetSessionStatus,
  datasetSessionError,
  listReviewEpisodes,
  getReviewState,
  updateReviewFlags,
}: UseDatasetActionBridgeParams) => {
  const loadDemoEpisodes = useCallback(
    (episodesToLoad: Episode[]) => {
      if (!Array.isArray(episodesToLoad) || episodesToLoad.length === 0) {
        toast.error("No demo episodes available");
        return;
      }
      const normalizedEpisodes = renumberEpisodes(episodesToLoad);
      episodesRef.current = normalizedEpisodes;
      setEpisodes(normalizedEpisodes);
      clearPendingHfRemainderUi();
      resetPipelineProgress();
      setPipelineStage("idle", undefined);
      // Demo playback is orchestrated directly by the demo flow.
      // Forcing replay selection/reset here snaps the main viewer back to frame 0
      // and immediately pauses the autoplay we just queued.
      setCurrentPlayingEpisodeIndex(null);
    },
    [
      clearPendingHfRemainderUi,
      episodesRef,
      resetPipelineProgress,
      setCurrentPlayingEpisodeIndex,
      setEpisodes,
      setPipelineStage,
    ]
  );

  useEffect(() => {
    if (!onDatasetActionsReady) {
      return;
    }

    onDatasetActionsReady({
      loadFromLocal: () => {
        openLocalDatasetFilePicker(document);
      },
      loadFromHuggingFace: loadEpisodesFromHuggingFaceDataset,
      loadPendingHfRemainder,
      loadNextEpisodes: () => {
        loadPendingHfRemainder();
      },
      abortEpisodeLoading: abortPendingHfRemainderLoad,
      materializeEpisode: async (episodeId: string) => {
        const targetEpisode = episodesRef.current.find(
          (episode) => episode.id === episodeId
        );
        if (!targetEpisode) {
          return null;
        }
        return materializeHfLazyEpisode(targetEpisode);
      },
      exportToLocal: exportDatasetToLeRobotFormat,
      exportRecordedEpisodesToOps: exportRecordedEpisodesForOps,
      exportToHuggingFace: uploadEpisodesToHuggingFace,
      loadDemoEpisodes,
      isImportingFromHF: isImportingFromHFDataset,
      hasPendingHfRemainderLoad: Boolean(pendingHfRemainderLabel),
      pendingHfRemainderLabel: pendingHfRemainderLabel ?? undefined,
      isLoadingPendingHfRemainder,
      isExportingDataset,
      isUploadingToHF,
      hasEpisodes: episodes.length > 0,
      limitCorrectionMode: exportLimitMode,
      setLimitCorrectionMode: setExportLimitMode,
      constraintSettings,
      setConstraintSettings,
      huggingFaceExportGate: hfTokenGate,
      episodes,
      currentEpisodeId:
        currentPlayingEpisodeIndex === null
          ? null
          : episodes[currentPlayingEpisodeIndex]?.id ?? null,
      selectEpisode: selectEpisodeById,
      playEpisodeById,
      playReviewEpisode,
      deleteEpisodes: deleteEpisodesFromReview,
      datasetSessionSummary,
      datasetSessionStatus,
      datasetSessionError,
      listReviewEpisodes,
      getReviewState,
      updateReviewFlags,
    });
  }, [
    abortPendingHfRemainderLoad,
    constraintSettings,
    currentPlayingEpisodeIndex,
    episodes,
    episodesRef,
    exportDatasetToLeRobotFormat,
    exportRecordedEpisodesForOps,
    exportLimitMode,
    hfTokenGate,
    isExportingDataset,
    isImportingFromHFDataset,
    isLoadingPendingHfRemainder,
    isUploadingToHF,
    datasetSessionError,
    datasetSessionStatus,
    datasetSessionSummary,
    deleteEpisodesFromReview,
    loadDemoEpisodes,
    getReviewState,
    loadEpisodesFromHuggingFaceDataset,
    loadPendingHfRemainder,
    listReviewEpisodes,
    materializeHfLazyEpisode,
    onDatasetActionsReady,
    pendingHfRemainderLabel,
    playEpisodeById,
    playReviewEpisode,
    selectEpisodeById,
    setConstraintSettings,
    setExportLimitMode,
    updateReviewFlags,
    uploadEpisodesToHuggingFace,
  ]);

  return {
    loadDemoEpisodes,
  };
};
