export type EpisodePipelineStage =
  | "idle"
  | "indexing"
  | "indexed"
  | "loading_episode"
  | "ready"
  | "error";

export type EpisodeMaterializationStatus =
  | "indexed"
  | "loading"
  | "ready"
  | "throttled"
  | "error";

export type EpisodeMaterializationState = {
  status: EpisodeMaterializationStatus;
  message?: string;
  retryAfterMs?: number;
  updatedAt: number;
};

export type EpisodePipelineProgress = {
  partitionLabel: string | null;
  currentOffset: number;
  loadedEpisodes: number;
  deferredRetryCount: number;
};

export type EpisodeFetchErrorKind =
  | "throttled"
  | "network"
  | "not_ready"
  | "empty"
  | "fatal";

export type EpisodeFetchError = {
  kind: EpisodeFetchErrorKind;
  message: string;
  retryAfterMs?: number;
};
