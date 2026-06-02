export const EPISODE_PIPELINE_PARAMS = {
  retryInSecondsPattern: /retry(?:\sin)?\s+(\d+)(?:\s*s|\s*sec|\s*seconds)?/i,
  defaultThrottledRetryMs: 2500,
} as const;
