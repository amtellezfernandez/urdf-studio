export const DATASET_REVIEW_ROUTE = "/dataset-review";

export const DATASET_REVIEW_QUERY_PARAMS = {
  session: "session",
} as const;

export const DATASET_REVIEW_SESSION_STORAGE_KEY =
  "urdfstudio:datasetReview:lastSessionId";

export const buildDatasetReviewUrl = ({
  sessionId,
}: {
  sessionId?: string | null;
} = {}): string => {
  const params = new URLSearchParams();
  if (sessionId) {
    params.set(DATASET_REVIEW_QUERY_PARAMS.session, sessionId);
  }
  const query = params.toString();
  return query ? `${DATASET_REVIEW_ROUTE}?${query}` : DATASET_REVIEW_ROUTE;
};

const canAccessWindowStorage = (): boolean => typeof window !== "undefined";

export const readLatestDatasetReviewSessionId = (): string | null => {
  if (!canAccessWindowStorage()) {
    return null;
  }
  try {
    const sessionId = window.localStorage
      .getItem(DATASET_REVIEW_SESSION_STORAGE_KEY)
      ?.trim();
    return sessionId || null;
  } catch {
    return null;
  }
};

export const writeLatestDatasetReviewSessionId = (
  sessionId: string | null | undefined
): void => {
  if (!canAccessWindowStorage()) {
    return;
  }
  try {
    if (sessionId?.trim()) {
      window.localStorage.setItem(
        DATASET_REVIEW_SESSION_STORAGE_KEY,
        sessionId.trim()
      );
    } else {
      window.localStorage.removeItem(DATASET_REVIEW_SESSION_STORAGE_KEY);
    }
  } catch {
    // Storage can be blocked in private or embedded browser contexts.
  }
};
