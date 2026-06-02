import { DATASET_SESSION_DEFAULT_PAGE_LIMIT } from "@/features/dataset/datasetSessionParams";
import type {
  DatasetSessionCreateRequest,
  DatasetSessionDeleteEpisodesRequest,
  DatasetSessionDeleteEpisodesResponse,
  DatasetSessionEpisodeDetailResponse,
  DatasetSessionEpisodeListResponse,
  DatasetSessionEpisodeListOptions,
  DatasetSessionFlagEpisodesRequest,
  DatasetSessionFlagEpisodesResponse,
  DatasetSessionReviewResponse,
  DatasetSessionSummary,
} from "@/features/dataset/datasetSessionTypes";
import { IKD_BASE_URL } from "@/shared/config/runtime";
import { guardedFetch } from "@/shared/lib/backendGuard";

const JSON_HEADERS: HeadersInit = {
  "Content-Type": "application/json",
};

const IKD_API_OPTIONS = {
  requiredBackends: ["ikd"] as const,
};

const parseJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Dataset session API request failed (${response.status}): ${detail || response.statusText}`
    );
  }
  return (await response.json()) as T;
};

const buildEpisodesUrl = ({
  sessionId,
  limit = DATASET_SESSION_DEFAULT_PAGE_LIMIT,
  offset = 0,
  flaggedOnly = false,
  reason,
}: {
  sessionId: string;
} & DatasetSessionEpisodeListOptions) => {
  const url = new URL(
    `${IKD_BASE_URL}/datasets/sessions/${encodeURIComponent(sessionId)}/episodes`
  );
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(limit));
  if (flaggedOnly) {
    url.searchParams.set("flagged_only", "true");
  }
  if (reason) {
    url.searchParams.set("reason", reason);
  }
  return url.toString();
};

export const createDatasetSession = async (
  request: DatasetSessionCreateRequest,
  signal?: AbortSignal
): Promise<DatasetSessionSummary> => {
  const response = await guardedFetch(
    `${IKD_BASE_URL}/datasets/sessions`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
      signal,
    },
    {
      ...IKD_API_OPTIONS,
      context: "Dataset session creation",
    }
  );
  return parseJson<DatasetSessionSummary>(response);
};

export const fetchDatasetSessionSummary = async (
  sessionId: string,
  signal?: AbortSignal
): Promise<DatasetSessionSummary> => {
  const response = await guardedFetch(
    `${IKD_BASE_URL}/datasets/sessions/${encodeURIComponent(sessionId)}/summary`,
    {
      signal,
    },
    {
      ...IKD_API_OPTIONS,
      context: "Dataset session summary",
    }
  );
  return parseJson<DatasetSessionSummary>(response);
};

export const listDatasetSessionEpisodes = async ({
  sessionId,
  limit,
  offset,
  flaggedOnly,
  reason,
  signal,
}: {
  sessionId: string;
  signal?: AbortSignal;
} & DatasetSessionEpisodeListOptions): Promise<DatasetSessionEpisodeListResponse> => {
  const response = await guardedFetch(
    buildEpisodesUrl({ sessionId, limit, offset, flaggedOnly, reason }),
    { signal },
    {
      ...IKD_API_OPTIONS,
      context: "Dataset session episode listing",
    }
  );
  return parseJson<DatasetSessionEpisodeListResponse>(response);
};

export const fetchDatasetSessionEpisode = async ({
  sessionId,
  episodeId,
  signal,
}: {
  sessionId: string;
  episodeId: string;
  signal?: AbortSignal;
}): Promise<DatasetSessionEpisodeDetailResponse> => {
  const response = await guardedFetch(
    `${IKD_BASE_URL}/datasets/sessions/${encodeURIComponent(sessionId)}/episodes/${encodeURIComponent(episodeId)}`,
    { signal },
    {
      ...IKD_API_OPTIONS,
      context: "Dataset session episode detail",
    }
  );
  return parseJson<DatasetSessionEpisodeDetailResponse>(response);
};

export const fetchDatasetSessionReview = async (
  sessionId: string,
  signal?: AbortSignal
): Promise<DatasetSessionReviewResponse> => {
  const response = await guardedFetch(
    `${IKD_BASE_URL}/datasets/sessions/${encodeURIComponent(sessionId)}/review`,
    { signal },
    {
      ...IKD_API_OPTIONS,
      context: "Dataset session review",
    }
  );
  return parseJson<DatasetSessionReviewResponse>(response);
};

export const updateDatasetSessionFlags = async ({
  sessionId,
  request,
  signal,
}: {
  sessionId: string;
  request: DatasetSessionFlagEpisodesRequest;
  signal?: AbortSignal;
}): Promise<DatasetSessionFlagEpisodesResponse> => {
  const response = await guardedFetch(
    `${IKD_BASE_URL}/datasets/sessions/${encodeURIComponent(sessionId)}/flags`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
      signal,
    },
    {
      ...IKD_API_OPTIONS,
      context: "Dataset session flag update",
    }
  );
  return parseJson<DatasetSessionFlagEpisodesResponse>(response);
};

export const deleteDatasetSessionEpisodes = async ({
  sessionId,
  request,
  signal,
}: {
  sessionId: string;
  request: DatasetSessionDeleteEpisodesRequest;
  signal?: AbortSignal;
}): Promise<DatasetSessionDeleteEpisodesResponse> => {
  const response = await guardedFetch(
    `${IKD_BASE_URL}/datasets/sessions/${encodeURIComponent(sessionId)}/delete`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
      signal,
    },
    {
      ...IKD_API_OPTIONS,
      context: "Dataset session delete",
    }
  );
  return parseJson<DatasetSessionDeleteEpisodesResponse>(response);
};
