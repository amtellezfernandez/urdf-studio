import { useCallback, useEffect, useMemo, useState } from "react";

import { listUnavailableBackends } from "@/shared/config/backends";
import {
  createDatasetSession,
  deleteDatasetSessionEpisodes,
  fetchDatasetSessionEpisode,
  fetchDatasetSessionReview,
  fetchDatasetSessionSummary,
  listDatasetSessionEpisodes,
  updateDatasetSessionFlags,
} from "@/features/dataset/datasetSessionApi";
import { hydrateDatasetSessionEpisode } from "@/features/dataset/datasetSessionEpisodeHydration";
import {
  resolveDatasetSessionSyncPlan,
} from "@/features/dataset/datasetSessionBridge";
import {
  DATASET_SESSION_SCHEMA_VERSION,
  DATASET_SESSION_SYNC_DEBOUNCE_MS,
} from "@/features/dataset/datasetSessionParams";
import type {
  DatasetSessionEpisodeListResponse,
  DatasetSessionEpisodeListOptions,
  DatasetSessionFlagEpisodesResponse,
  DatasetSessionFlagUpdate,
  DatasetSessionReviewResponse,
  DatasetSessionSummary,
} from "@/features/dataset/datasetSessionTypes";
import type { Episode } from "@/features/dataset/episodes";
import type { DatasetSourceRecord } from "@/features/layout/sidebar/datasetSourceHelpers";

type UseDatasetSessionControllerParams = {
  episodes: readonly Episode[];
  datasetSources: readonly DatasetSourceRecord[];
};

export const useDatasetSessionController = ({
  episodes,
  datasetSources,
}: UseDatasetSessionControllerParams) => {
  const isDatasetSessionBackendAvailable = listUnavailableBackends(["ikd"]).length === 0;
  const [summary, setSummary] = useState<DatasetSessionSummary | null>(null);
  const [status, setStatus] = useState<"idle" | "syncing" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const syncPlan = useMemo(
    () => resolveDatasetSessionSyncPlan({ episodes, datasetSources }),
    [datasetSources, episodes]
  );
  const sessionId = summary?.session_id ?? null;

  useEffect(() => {
    if (!isDatasetSessionBackendAvailable || !syncPlan.request) {
      setSummary(null);
      setStatus("idle");
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setStatus("syncing");
      setError(null);
      void createDatasetSession(syncPlan.request, controller.signal)
        .then((nextSummary) => {
          setSummary(nextSummary);
          setStatus("ready");
        })
        .catch((nextError) => {
          if (controller.signal.aborted) {
            return;
          }
          setStatus("error");
          setError(nextError instanceof Error ? nextError.message : "Dataset review sync failed");
        });
    }, DATASET_SESSION_SYNC_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [isDatasetSessionBackendAvailable, syncPlan.fingerprint, syncPlan.request]);

  const refreshDatasetSessionSummary = useCallback(async () => {
    if (!sessionId) {
      return null;
    }
    const nextSummary = await fetchDatasetSessionSummary(sessionId);
    setSummary(nextSummary);
    return nextSummary;
  }, [sessionId]);

  const listReviewEpisodes = useCallback(
    async ({
      flaggedOnly = false,
      limit,
      offset,
      reason,
    }: DatasetSessionEpisodeListOptions = {}): Promise<
      DatasetSessionEpisodeListResponse | null
    > => {
      if (!sessionId) {
        return null;
      }
      return listDatasetSessionEpisodes({
        sessionId,
        flaggedOnly,
        limit,
        offset,
        reason,
      });
    },
    [sessionId]
  );

  const getReviewState = useCallback(async (): Promise<DatasetSessionReviewResponse | null> => {
    if (!sessionId) {
      return null;
    }
    return fetchDatasetSessionReview(sessionId);
  }, [sessionId]);

  const fetchReviewEpisode = useCallback(
    async (episodeId: string): Promise<Episode | null> => {
      if (!sessionId) {
        return null;
      }
      const detail = await fetchDatasetSessionEpisode({
        sessionId,
        episodeId,
      });
      return hydrateDatasetSessionEpisode(detail);
    },
    [sessionId]
  );

  const updateReviewFlags = useCallback(
    async (
      updates: DatasetSessionFlagUpdate[]
    ): Promise<DatasetSessionFlagEpisodesResponse | null> => {
      if (!sessionId || updates.length === 0) {
        return null;
      }
      const response = await updateDatasetSessionFlags({
        sessionId,
        request: {
          schema_version: DATASET_SESSION_SCHEMA_VERSION,
          updates,
        },
      });
      await refreshDatasetSessionSummary();
      return response;
    },
    [refreshDatasetSessionSummary, sessionId]
  );

  const deleteReviewEpisodes = useCallback(
    async (episodeIds: string[]) => {
      if (!sessionId || episodeIds.length === 0) {
        return false;
      }
      await deleteDatasetSessionEpisodes({
        sessionId,
        request: {
          schema_version: DATASET_SESSION_SCHEMA_VERSION,
          episode_ids: episodeIds,
        },
      });
      await refreshDatasetSessionSummary();
      return true;
    },
    [refreshDatasetSessionSummary, sessionId]
  );

  return {
    datasetSessionSummary: summary,
    datasetSessionStatus: status,
    datasetSessionError: error,
    datasetSessionId: sessionId,
    refreshDatasetSessionSummary,
    fetchReviewEpisode,
    listReviewEpisodes,
    getReviewState,
    updateReviewFlags,
    deleteReviewEpisodes,
  };
};
