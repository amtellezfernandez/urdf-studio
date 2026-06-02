import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { DatasetReviewPage } from "@/features/dataset/DatasetReviewPage";
import {
  deleteDatasetSessionEpisodes,
  fetchDatasetSessionSummary,
  listDatasetSessionEpisodes,
  updateDatasetSessionFlags,
} from "@/features/dataset/datasetSessionApi";
import type { DatasetReviewDeleteTarget } from "@/features/dataset/datasetActions";
import {
  DATASET_REVIEW_SESSION_PARAMS,
  DATASET_SESSION_SCHEMA_VERSION,
} from "@/features/dataset/datasetSessionParams";
import type {
  DatasetSessionEpisodeSummary,
  DatasetSessionEpisodeListOptions,
  DatasetSessionFlagUpdate,
  DatasetSessionReviewReason,
  DatasetSessionSummary,
} from "@/features/dataset/datasetSessionTypes";
import {
  DATASET_REVIEW_SNAPSHOT_SESSION_ID,
  DATASET_REVIEW_SNAPSHOT_STORAGE_KEY,
  buildDatasetReviewSnapshotSummary,
  readDatasetReviewSnapshot,
  writeDatasetReviewSnapshot,
  type DatasetReviewSnapshot,
} from "@/features/dataset/datasetReviewSnapshot";
import {
  DATASET_REVIEW_QUERY_PARAMS,
  DATASET_REVIEW_SESSION_STORAGE_KEY,
  readLatestDatasetReviewSessionId,
  writeLatestDatasetReviewSessionId,
} from "@/shared/config/datasetReviewRoutes";
import { URDF_OPS_QUERY_PARAMS } from "@/shared/config/urdfOpsRoutes";

type DatasetReviewWorkspaceProps = {
  embedded?: boolean;
};

const applyLocalSnapshotFlagUpdates = (
  episodes: DatasetSessionEpisodeSummary[],
  updates: DatasetSessionFlagUpdate[]
): DatasetSessionEpisodeSummary[] => {
  const updateByEpisodeId = new Map(
    updates.map((update) => [update.episode_id, update])
  );
  return episodes.map((episode) => {
    const update = updateByEpisodeId.get(episode.episode_id);
    if (!update) {
      return episode;
    }
    return {
      ...episode,
      flagged: update.flagged,
      manual_reasons: update.flagged ? update.reasons ?? [] : [],
      review_reasons: update.flagged
        ? update.reasons ?? []
        : episode.detected_reasons,
      review_note: update.flagged ? update.note : undefined,
    };
  });
};

const buildLocalSnapshotReviewCounts = (
  episodes: DatasetSessionEpisodeSummary[]
) => {
  const reviewCounts = new Map<DatasetSessionReviewReason, number>();
  episodes.forEach((episode) => {
    episode.review_reasons.forEach((reviewReason) => {
      reviewCounts.set(reviewReason, (reviewCounts.get(reviewReason) ?? 0) + 1);
    });
  });
  return Array.from(reviewCounts.entries()).map(
    ([reviewReason, episode_count]) => ({
      reason: reviewReason,
      episode_count,
    })
  );
};

export const DatasetReviewWorkspace = ({
  embedded = false,
}: DatasetReviewWorkspaceProps) => {
  const [searchParams] = useSearchParams();
  const containerHeightClass = embedded ? "h-full" : "h-screen";
  const querySessionId =
    searchParams.get(DATASET_REVIEW_QUERY_PARAMS.session) ??
    searchParams.get(URDF_OPS_QUERY_PARAMS.session);
  const [activeSessionId, setActiveSessionId] = useState(
    () => querySessionId ?? readLatestDatasetReviewSessionId()
  );
  const [localSnapshot, setLocalSnapshot] = useState<DatasetReviewSnapshot | null>(
    () => readDatasetReviewSnapshot()
  );
  const sessionId = activeSessionId;
  const [summary, setSummary] = useState<DatasetSessionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const syncStoredReviewState = useCallback(() => {
    const nextSessionId = readLatestDatasetReviewSessionId();
    const nextSnapshot = readDatasetReviewSnapshot();
    if (!querySessionId) {
      setActiveSessionId(nextSessionId);
    }
    setLocalSnapshot(nextSnapshot);
  }, [querySessionId]);

  useEffect(() => {
    if (querySessionId) {
      writeLatestDatasetReviewSessionId(querySessionId);
      setActiveSessionId(querySessionId);
    } else {
      syncStoredReviewState();
    }
  }, [querySessionId, syncStoredReviewState]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === DATASET_REVIEW_SESSION_STORAGE_KEY ||
        event.key === DATASET_REVIEW_SNAPSHOT_STORAGE_KEY
      ) {
        syncStoredReviewState();
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", syncStoredReviewState);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", syncStoredReviewState);
    };
  }, [syncStoredReviewState]);

  const refreshSummary = useCallback(
    async (signal?: AbortSignal) => {
      if (!sessionId) {
        setSummary(null);
        return null;
      }
      const nextSummary = await fetchDatasetSessionSummary(sessionId, signal);
      setSummary(nextSummary);
      return nextSummary;
    },
    [sessionId]
  );

  useEffect(() => {
    if (!sessionId) {
      setSummary(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void refreshSummary(controller.signal)
      .catch((nextError) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Failed to load dataset review session"
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [refreshSummary, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void refreshSummary().catch((nextError) => {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Failed to load dataset review session"
        );
      });
    }, DATASET_REVIEW_SESSION_PARAMS.refreshIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [refreshSummary, sessionId]);

  const datasetActions = useMemo(() => {
    if (sessionId && summary) {
      return {
        datasetSessionSummary: summary,
        datasetSessionStatus: "ready" as const,
        datasetSessionError: null,
        listReviewEpisodes: ({
          flaggedOnly = false,
          limit,
          offset = 0,
          reason,
        }: DatasetSessionEpisodeListOptions = {}) =>
          listDatasetSessionEpisodes({
            sessionId,
            flaggedOnly,
            limit,
            offset,
            reason,
          }),
        updateReviewFlags: async (updates: DatasetSessionFlagUpdate[]) => {
          const response = await updateDatasetSessionFlags({
            sessionId,
            request: {
              schema_version: DATASET_SESSION_SCHEMA_VERSION,
              updates,
            },
          });
          await refreshSummary();
          return response;
        },
        deleteEpisodes: async (episodes: readonly DatasetReviewDeleteTarget[]) => {
          await deleteDatasetSessionEpisodes({
            sessionId,
            request: {
              schema_version: DATASET_SESSION_SCHEMA_VERSION,
              episode_ids: episodes.map((episode) => episode.episode_id),
            },
          });
          await refreshSummary();
        },
      };
    }

    if (!localSnapshot) {
      return null;
    }

    const updateLocalSnapshot = (
      updater: (episodes: DatasetSessionEpisodeSummary[]) => DatasetSessionEpisodeSummary[]
    ) => {
      setLocalSnapshot((currentSnapshot) => {
        if (!currentSnapshot) {
          return currentSnapshot;
        }
        const nextSnapshot = {
          ...currentSnapshot,
          episodes: updater(currentSnapshot.episodes),
          updated_at_ms: Date.now(),
        };
        writeDatasetReviewSnapshot(nextSnapshot);
        return nextSnapshot;
      });
    };

    return {
      datasetSessionSummary: buildDatasetReviewSnapshotSummary(localSnapshot),
      datasetSessionStatus: "ready" as const,
      datasetSessionError: null,
      listReviewEpisodes: async ({
        flaggedOnly = false,
        limit = localSnapshot.episodes.length,
        offset = 0,
        reason,
      }: DatasetSessionEpisodeListOptions = {}) => {
        const filteredEpisodes = localSnapshot.episodes.filter((episode) => {
          if (flaggedOnly && !episode.flagged) {
            return false;
          }
          return reason ? episode.review_reasons.includes(reason) : true;
        });
        return {
          schema_version: localSnapshot.schema_version,
          session_id: DATASET_REVIEW_SNAPSHOT_SESSION_ID,
          total: filteredEpisodes.length,
          offset,
          limit,
          episodes: filteredEpisodes.slice(offset, offset + limit),
        };
      },
      updateReviewFlags: async (updates: DatasetSessionFlagUpdate[]) => {
        const applyUpdates = (episodes: DatasetSessionEpisodeSummary[]) =>
          applyLocalSnapshotFlagUpdates(episodes, updates);
        updateLocalSnapshot(applyUpdates);
        const nextEpisodes = applyUpdates(localSnapshot.episodes);
        return {
          schema_version: localSnapshot.schema_version,
          session_id: DATASET_REVIEW_SNAPSHOT_SESSION_ID,
          flagged_episode_count: nextEpisodes.filter((episode) => episode.flagged).length,
          review_counts: buildLocalSnapshotReviewCounts(nextEpisodes),
          updated_episode_ids: updates.map((update) => update.episode_id),
        };
      },
      deleteEpisodes: async (episodesToDelete: readonly DatasetReviewDeleteTarget[]) => {
        const deletedIds = new Set(
          episodesToDelete.map((episode) => episode.episode_id)
        );
        updateLocalSnapshot((episodes) =>
          episodes.filter((episode) => !deletedIds.has(episode.episode_id))
        );
      },
    };
  }, [localSnapshot, refreshSummary, sessionId, summary]);

  if (loading) {
    return (
      <main className={`${containerHeightClass} flex items-center justify-center bg-background px-6 text-sm text-muted-foreground`}>
        Loading dataset review...
      </main>
    );
  }

  if (!sessionId && !localSnapshot) {
    return (
      <main className={`${containerHeightClass} flex items-center justify-center bg-background px-6 text-center`}>
        <div className="max-w-xl space-y-2">
          <div className="text-sm font-medium text-foreground">Waiting for dataset review session</div>
          <div className="text-xs text-muted-foreground">
            No dataset review session is available.
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className={`${containerHeightClass} flex items-center justify-center bg-background px-6 text-center`}>
        <div className="max-w-xl space-y-2">
          <div className="text-sm font-medium text-foreground">Dataset review unavailable</div>
          <div className="text-xs text-red-400">{error}</div>
        </div>
      </main>
    );
  }

  return (
    <main className={`${containerHeightClass} bg-background`}>
      <DatasetReviewPage datasetActions={datasetActions} />
    </main>
  );
};

export const DatasetReviewStandalonePage = () => (
  <DatasetReviewWorkspace embedded={false} />
);
