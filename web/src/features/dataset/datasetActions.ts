import type { Dispatch, SetStateAction } from "react";
import type { Episode } from "@/features/dataset/episodes";
import type { DatasetConstraintSettings } from "@/features/dataset/episode-viewer/constraintSettings";
import type { JointLimitMode } from "@/shared/types/feature";
import type { CredentialGate } from "@/shared/config/credentials";
import type {
  DatasetSessionEpisodeListResponse,
  DatasetSessionEpisodeListOptions,
  DatasetSessionEpisodeSummary,
  DatasetSessionFlagEpisodesResponse,
  DatasetSessionFlagUpdate,
  DatasetSessionReviewResponse,
  DatasetSessionSummary,
} from "@/features/dataset/datasetSessionTypes";

export type DatasetReviewDeleteTarget = Pick<
  DatasetSessionEpisodeSummary,
  "episode_id" | "source_id" | "content_fingerprint"
>;

export type DatasetOpsLocalExportResult = {
  datasetPaths: string[];
  exportedCount: number;
  skippedCount: number;
};

export type DatasetActions = {
  loadFromLocal: () => void;
  loadFromHuggingFace: () => void;
  loadPendingHfRemainder?: () => void;
  loadNextEpisodes?: (count?: number) => void;
  abortEpisodeLoading?: () => void;
  materializeEpisode?: (episodeId: string) => Promise<Episode | null>;
  exportToLocal: () => void;
  exportRecordedEpisodesToOps?: () => Promise<DatasetOpsLocalExportResult>;
  exportToHuggingFace: () => void;
  loadDemoEpisodes: (episodes: Episode[]) => void;
  isImportingFromHF: boolean;
  hasPendingHfRemainderLoad?: boolean;
  pendingHfRemainderLabel?: string;
  isLoadingPendingHfRemainder?: boolean;
  isExportingDataset: boolean;
  isUploadingToHF: boolean;
  hasEpisodes: boolean;
  limitCorrectionMode: JointLimitMode;
  setLimitCorrectionMode: (mode: JointLimitMode) => void;
  constraintSettings: DatasetConstraintSettings;
  setConstraintSettings: Dispatch<SetStateAction<DatasetConstraintSettings>>;
  huggingFaceExportGate: CredentialGate;
  episodes: Episode[];
  currentEpisodeId: string | null;
  selectEpisode: (episodeId: string) => void;
  playEpisodeById: (episodeId: string) => Promise<void>;
  playReviewEpisode?: (episodeId: string) => Promise<void>;
  deleteEpisodes: (episodes: readonly DatasetReviewDeleteTarget[]) => Promise<void>;
  datasetSessionSummary?: DatasetSessionSummary | null;
  datasetSessionStatus?: "idle" | "syncing" | "ready" | "error";
  datasetSessionError?: string | null;
  listReviewEpisodes: (
    options?: DatasetSessionEpisodeListOptions
  ) => Promise<DatasetSessionEpisodeListResponse | null>;
  getReviewState: () => Promise<DatasetSessionReviewResponse | null>;
  updateReviewFlags: (
    updates: DatasetSessionFlagUpdate[]
  ) => Promise<DatasetSessionFlagEpisodesResponse | null>;
};
