export const GITHUB_API_BASE_URL = "https://api.github.com";
export const GITHUB_API_DEV_PROXY_PREFIX = "/__github_api";
export const GITHUB_API_PROXY_RETRY_HEADER = "x-urdf-github-proxy-retry";
export const GITHUB_API_PROXY_RETRY_HEADER_VALUE = "1";
export const GITHUB_API_PROXY_FALLBACK_ENABLED_MODES = ["development", "test"] as const;
export const GITHUB_NETWORK_ERROR_PREFIX = "Network error reaching GitHub source";


export const GITHUB_REPO_RUNTIME_PARAMS = {
  apiAcceptHeader: "application/vnd.github.v3+json",
  jsDelivrDataBaseUrl: "https://data.jsdelivr.com/v1",
  jsDelivrCdnBaseUrl: "https://cdn.jsdelivr.net",
  abuseMaxRetries: 3,
  abuseBaseDelayMs: 1000,
  abuseMaxDelayMs: 12000,
  maxXacroDependencyRecoveryPasses: 8,
  repoContentsCacheTtlMs: 5 * 60 * 1000,
  repoContentsCacheMaxJsonBytes: 4_200_000,
  repoContentsCachePrefix: "urdfstudio:ghRepoContents:v1",
  fileContentCacheTtlMs: 5 * 60 * 1000,
  fileContentCacheMaxEntries: 128,
  fileFetchBatchSize: 15,
  fileFetchBatchDelayMs: 50,
  wrapperCandidateLimit: 8,
} as const;
