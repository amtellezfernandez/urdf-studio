export const DATASET_SESSION_SCHEMA_VERSION = "1";
export const DATASET_SESSION_DEFAULT_PAGE_LIMIT = 50;
export const DATASET_SESSION_SYNC_DEBOUNCE_MS = 400;

export const DATASET_REVIEW_FORMAT_PARAMS = {
  durationFractionDigits: 2,
  fpsFractionDigits: 2,
  percentFractionDigits: 0,
  percentMultiplier: 100,
} as const;

export const DATASET_REVIEW_SESSION_PARAMS = {
  refreshIntervalMs: 5_000,
  pageLimit: DATASET_SESSION_DEFAULT_PAGE_LIMIT,
} as const;

export const DATASET_REVIEW_INSIGHT_PARAMS = {
  fullBarRatio: 1,
  visibleReasonLimit: 4,
  visibleSourceLimit: 4,
} as const;

export const DATASET_SESSION_SOURCE_KIND_PARAMS = {
  mixed: "mixed",
  unknown: "unknown",
  recorded: "recorded",
  sourceKindMap: {
    hf: "hf",
    local: "local",
    recorded: "recorded",
    github: "derived",
    edited: "derived",
  },
} as const;
