import { EPISODE_PIPELINE_PARAMS } from "@/features/dataset/episode-pipeline/episodePipelineParams";
import type {
  EpisodeFetchError,
  EpisodeMaterializationState,
  EpisodeMaterializationStatus,
} from "@/features/dataset/episode-pipeline/types";

const RETRY_IN_SECONDS_PATTERN = EPISODE_PIPELINE_PARAMS.retryInSecondsPattern;
export const DEFAULT_THROTTLED_RETRY_MS =
  EPISODE_PIPELINE_PARAMS.defaultThrottledRetryMs;

const STATUS_TRANSITIONS: Record<
  EpisodeMaterializationStatus,
  ReadonlySet<EpisodeMaterializationStatus>
> = {
  indexed: new Set(["indexed", "loading", "ready", "error"]),
  loading: new Set(["loading", "ready", "indexed", "throttled", "error"]),
  ready: new Set(["ready", "loading", "indexed", "error"]),
  throttled: new Set(["throttled", "loading", "indexed", "ready", "error"]),
  error: new Set(["error", "loading", "indexed", "ready"]),
};

const IS_DEV = Boolean(
  (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV
);

export const isEpisodeStateTransitionAllowed = (
  previousStatus: EpisodeMaterializationStatus | undefined,
  nextStatus: EpisodeMaterializationStatus
): boolean => {
  if (!previousStatus) return true;
  const allowedTargets = STATUS_TRANSITIONS[previousStatus];
  return allowedTargets.has(nextStatus);
};

export const resolveEpisodeStateTransition = (
  previousStatus: EpisodeMaterializationStatus | undefined,
  nextStatus: EpisodeMaterializationStatus,
  episodeId?: string
): EpisodeMaterializationStatus => {
  if (isEpisodeStateTransitionAllowed(previousStatus, nextStatus)) {
    return nextStatus;
  }

  if (IS_DEV) {
    const episodeSuffix = episodeId ? ` for ${episodeId}` : "";
    console.warn(
      `[EpisodePipeline] Ignored invalid transition${episodeSuffix}: ${String(previousStatus)} -> ${nextStatus}`
    );
  }
  return previousStatus ?? nextStatus;
};

export const classifyEpisodeFetchError = (error: unknown): EpisodeFetchError => {
  const message =
    error instanceof Error ? error.message : "Failed to load episode";
  const normalized = message.toLowerCase();

  if (
    normalized.includes("rate-limit") ||
    normalized.includes("rate limit") ||
    normalized.includes("throttle")
  ) {
    const retryMatch = message.match(RETRY_IN_SECONDS_PATTERN);
    const retrySeconds = retryMatch ? Number(retryMatch[1]) : Number.NaN;
    return {
      kind: "throttled",
      message,
      retryAfterMs:
        Number.isFinite(retrySeconds) && retrySeconds > 0
          ? retrySeconds * 1000
          : DEFAULT_THROTTLED_RETRY_MS,
    };
  }

  if (normalized.includes("indexed") && normalized.includes("not ready")) {
    return {
      kind: "not_ready",
      message,
    };
  }

  if (normalized.includes("no rows") || normalized.includes("no frames")) {
    return {
      kind: "empty",
      message,
    };
  }

  if (
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("connection")
  ) {
    return {
      kind: "network",
      message,
    };
  }

  return {
    kind: "fatal",
    message,
  };
};

export const isEpisodeThrottleWindowActive = (
  state: EpisodeMaterializationState | undefined,
  nowMs: number = Date.now()
): boolean => {
  if (!state || state.status !== "throttled") return false;
  const retryAfterMs = state.retryAfterMs ?? 0;
  if (!(retryAfterMs > 0)) return false;
  return nowMs - state.updatedAt < retryAfterMs;
};
