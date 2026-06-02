/**
 * GitHub repository utility functions
 */

import {
  analyzeUrdf,
  buildDependencyRepositoryNameCandidates,
  buildPackageRootsFromRepositoryFiles,
  collectMeshReferencedPackageNamesFromUrdf,
  collectPackageNamesFromText,
  collectXacroSupportFilesFromRepository,
  extractMeshReferencesFromUrdf,
  findPackageXmlForPackageName,
  findRepositoryUrdfCandidates,
  hasRenderableUrdfGeometry,
  hasXacroSyntax,
  inspectRepositoryCandidates,
  isUrdfXacroPath,
  isXacroPath,
  normalizeExpandedUrdfPath,
  normalizeMeshPathForMatch,
  normalizeRepositoryPath,
  repositoryContainsPackage,
  repositoryDirname,
  resolveMeshPathInRepository,
  resolveRepositoryMeshReferences,
  resolveRepositoryXacroTargetPath as resolveRepositoryXacroTargetPathInCore,
  SUPPORTED_MESH_EXTENSIONS,
  type RepositoryUrdfCandidate,
  updateMeshPathsToAssetsInUrdf,
} from "./urdfCore";
import { expandXacro } from "./xacroClient";
import { API_BASE_URL } from "@/shared/config/runtime";
import {
  GITHUB_API_BASE_URL,
  GITHUB_API_DEV_PROXY_PREFIX,
  GITHUB_API_PROXY_FALLBACK_ENABLED_MODES,
  GITHUB_API_PROXY_RETRY_HEADER,
  GITHUB_API_PROXY_RETRY_HEADER_VALUE,
  GITHUB_NETWORK_ERROR_PREFIX,
  GITHUB_REPO_RUNTIME_PARAMS,
} from "./githubRepoParams";

interface GitHubRepoInfo {
  owner: string;
  repo: string;
  path?: string;
  branch?: string;
}

export interface GitHubFile {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
  content?: string; // Base64 encoded content (when from Contents API) OR blob SHA (when from Trees API)
  encoding?: string; // "base64" or "sha" (when from Trees API)
  size?: number;
  sha?: string; // Blob SHA from Trees API (preferred for content fetching)
  sourceOwner?: string; // Optional override for cross-repo dependency fetches
  sourceRepo?: string; // Optional override for cross-repo dependency fetches
  sourcePath?: string; // Original path inside sourceRepo when path is virtualized
}

const normalizedPathCache = new Map<string, string>();
const lowerCaseFileMapCache = new WeakMap<GitHubFile[], Map<string, GitHubFile>>();

function normalizePathCached(path: string): string {
  const cached = normalizedPathCache.get(path);
  if (cached) return cached;
  const normalized = normalizeRepositoryPath(path);
  normalizedPathCache.set(path, normalized);
  return normalized;
}

function getLowerCaseFileMap(files: GitHubFile[]): Map<string, GitHubFile> {
  const cached = lowerCaseFileMapCache.get(files);
  if (cached) return cached;

  const pathMap = new Map<string, GitHubFile>();
  for (const file of files) {
    if (file.type === "file") {
      const normalized = normalizePathCached(file.path);
      pathMap.set(normalized.toLowerCase(), file);
    }
  }
  lowerCaseFileMapCache.set(files, pathMap);
  return pathMap;
}

const resolveGitHubRepositoryTargetPath = (files: GitHubFile[], targetPath: string): string =>
  resolveRepositoryXacroTargetPathInCore(files, normalizeMeshPathForMatch(targetPath) || targetPath);

export const resolveRepositoryXacroTargetPath = (
  files: ArrayLike<{ path: string; type?: string }>,
  targetPath: string
): string =>
  resolveRepositoryXacroTargetPathInCore(
    Array.from(files, (file) => ({
      name: file.path.split("/").pop() || file.path,
      path: file.path,
      type: file.type === "dir" ? "dir" : "file",
      download_url: null,
    })),
    normalizeMeshPathForMatch(targetPath) || targetPath
  );

export type URDFCandidate = RepositoryUrdfCandidate;

interface GitHubTreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha?: string;
}

interface JsDelivrFlatFileEntry {
  name?: string;
  path?: string;
  size?: number;
}

const GITHUB_REPO_PARAMS = GITHUB_REPO_RUNTIME_PARAMS;
const GITHUB_API_ACCEPT_HEADER = GITHUB_REPO_PARAMS.apiAcceptHeader;
const JSDELIVR_DATA_BASE_URL = GITHUB_REPO_PARAMS.jsDelivrDataBaseUrl;
const JSDELIVR_CDN_BASE_URL = GITHUB_REPO_PARAMS.jsDelivrCdnBaseUrl;
const GITHUB_BAD_CREDENTIALS_PATTERN = /bad credentials/i;
const GITHUB_ABUSE_DETECTION_PATTERN = /abuse detection mechanism|secondary rate limit/i;
const GITHUB_ABUSE_MAX_RETRIES = GITHUB_REPO_PARAMS.abuseMaxRetries;
const GITHUB_ABUSE_BASE_DELAY_MS = GITHUB_REPO_PARAMS.abuseBaseDelayMs;
const GITHUB_ABUSE_MAX_DELAY_MS = GITHUB_REPO_PARAMS.abuseMaxDelayMs;
const GITHUB_NETWORK_FETCH_ERROR_PATTERN =
  /Failed to fetch|NetworkError|fetch failed|Load failed|ECONNREFUSED|ERR_CONNECTION_REFUSED|ERR_NETWORK/i;
const XACRO_MISSING_PACKAGE_PATTERN = /Package '([^']+)' not found in uploaded files\./g;
const MAX_XACRO_DEPENDENCY_RECOVERY_PASSES = GITHUB_REPO_PARAMS.maxXacroDependencyRecoveryPasses;
const GITHUB_FILE_FETCH_BATCH_SIZE = GITHUB_REPO_PARAMS.fileFetchBatchSize;
const GITHUB_FILE_FETCH_BATCH_DELAY_MS = GITHUB_REPO_PARAMS.fileFetchBatchDelayMs;
const GITHUB_XACRO_WRAPPER_CANDIDATE_LIMIT = GITHUB_REPO_PARAMS.wrapperCandidateLimit;

type GitHubApiFetchResult = {
  response: Response;
  fellBackToAnonymous: boolean;
};

type RepoContentsCacheEntry = {
  expiresAt: number;
  files: GitHubFile[];
};

type GitHubFileContentResult = {
  content: Blob;
  mimeType: string;
};

type GitHubFileContentCacheEntry = {
  expiresAt: number;
  value: GitHubFileContentResult;
};

type FetchRepoContentsOptions = {
  branch?: string;
  strategy?: "auto" | "api-first" | "archive-first";
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const parseRetryAfterMs = (retryAfter: string | null): number | null => {
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * 1000);
};

const GITHUB_REPO_CONTENTS_CACHE_TTL_MS = GITHUB_REPO_PARAMS.repoContentsCacheTtlMs;
const GITHUB_REPO_CONTENTS_CACHE_MAX_JSON_BYTES = GITHUB_REPO_PARAMS.repoContentsCacheMaxJsonBytes;
const GITHUB_REPO_CONTENTS_CACHE_PREFIX = GITHUB_REPO_PARAMS.repoContentsCachePrefix;
const repoContentsMemoryCache = new Map<string, RepoContentsCacheEntry>();
const repoContentsInFlight = new Map<string, Promise<GitHubFile[]>>();
const GITHUB_FILE_CONTENT_CACHE_TTL_MS = GITHUB_REPO_PARAMS.fileContentCacheTtlMs;
const GITHUB_FILE_CONTENT_CACHE_MAX_ENTRIES = GITHUB_REPO_PARAMS.fileContentCacheMaxEntries;
const gitHubFileContentCache = new Map<string, GitHubFileContentCacheEntry>();
const gitHubFileContentInFlight = new Map<string, Promise<GitHubFileContentResult>>();

const hashCacheToken = (value: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const buildFileContentCacheKey = (
  owner: string,
  repo: string,
  filePath: string,
  accessToken: string | undefined,
  blobSha: string | undefined
): string => {
  const tokenScope = accessToken ? `auth:${hashCacheToken(accessToken)}` : "anon";
  const normalizedPath = normalizePathCached(filePath || "");
  return `ghContent:${owner.toLowerCase()}/${repo.toLowerCase()}:${normalizedPath}:${blobSha || "no-sha"}:${tokenScope}`;
};

const isCacheableGitHubContentPath = (filePath: string): boolean => {
  const lower = filePath.toLowerCase();
  return (
    lower.endsWith(".urdf") ||
    lower.endsWith(".xacro") ||
    lower.endsWith(".xml") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".trans")
  );
};

const buildRepoContentsCacheKey = (
  owner: string,
  repo: string,
  path: string,
  accessToken?: string,
  branch?: string
): string => {
  const normalizedPath = normalizePathCached(path || "");
  const normalizedBranch = (branch || "").trim().toLowerCase() || "default";
  const tokenScope = accessToken ? `auth:${hashCacheToken(accessToken)}` : "anon";
  return `${GITHUB_REPO_CONTENTS_CACHE_PREFIX}:${owner.toLowerCase()}/${repo.toLowerCase()}:${normalizedBranch}:${normalizedPath}:${tokenScope}`;
};

const readRepoContentsStorageCache = (key: string): RepoContentsCacheEntry | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RepoContentsCacheEntry;
    if (!parsed || !Array.isArray(parsed.files) || !Number.isFinite(parsed.expiresAt)) {
      window.localStorage.removeItem(key);
      return null;
    }
    if (Date.now() > parsed.expiresAt) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const writeRepoContentsStorageCache = (key: string, entry: RepoContentsCacheEntry): void => {
  if (typeof window === "undefined") return;
  try {
    const raw = JSON.stringify(entry);
    if (raw.length > GITHUB_REPO_CONTENTS_CACHE_MAX_JSON_BYTES) return;
    window.localStorage.setItem(key, raw);
  } catch {
    // Ignore cache write failures (quota/private mode).
  }
};

const readRepoContentsCache = (
  key: string,
  options: { allowStorage?: boolean } = {}
): GitHubFile[] | null => {
  const memory = repoContentsMemoryCache.get(key);
  if (memory) {
    if (Date.now() <= memory.expiresAt) {
      return memory.files;
    }
    repoContentsMemoryCache.delete(key);
  }

  if (options.allowStorage === false) {
    return null;
  }

  const stored = readRepoContentsStorageCache(key);
  if (!stored) return null;
  repoContentsMemoryCache.set(key, stored);
  return stored.files;
};

const writeRepoContentsCache = (
  key: string,
  files: GitHubFile[],
  options: { persistToStorage?: boolean } = {}
): void => {
  const entry: RepoContentsCacheEntry = {
    expiresAt: Date.now() + GITHUB_REPO_CONTENTS_CACHE_TTL_MS,
    files,
  };
  repoContentsMemoryCache.set(key, entry);
  if (options.persistToStorage !== false) {
    writeRepoContentsStorageCache(key, entry);
  }
};

export const __clearRepoContentsCacheForTests = (): void => {
  repoContentsMemoryCache.clear();
  repoContentsInFlight.clear();
  gitHubFileContentCache.clear();
  gitHubFileContentInFlight.clear();
  if (typeof window === "undefined") return;
  try {
    const keysToDelete: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      if (key.startsWith(GITHUB_REPO_CONTENTS_CACHE_PREFIX)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // ignore storage failures
  }
};

const buildGitHubNetworkErrorMessage = (url: string): string => {
  let hostname = "api.github.com";
  try {
    hostname = new URL(url).hostname || hostname;
  } catch {
    hostname = "api.github.com";
  }
  return `${GITHUB_NETWORK_ERROR_PREFIX} (${hostname}). Check internet access, VPN/firewall, and ad blockers, then retry.`;
};

const toFetchableUrl = (url: string): string => {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (API_BASE_URL.startsWith("/")) {
    return `${API_BASE_URL.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
  }
  return new URL(url, API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`).toString();
};

const buildGitHubBackendRepoContentsUrl = (
  owner: string,
  repo: string,
  path: string,
  branch?: string
): string => {
  const params = new URLSearchParams();
  params.set("owner", owner);
  params.set("repo", repo);
  if (path) {
    params.set("path", path);
  }
  if (branch) {
    params.set("branch", branch);
  }
  return toFetchableUrl(`/ilu/repo-contents?${params.toString()}`);
};

async function fetchRepoContentsFromBackend(
  owner: string,
  repo: string,
  path: string = "",
  branch?: string
): Promise<GitHubFile[]> {
  const url = buildGitHubBackendRepoContentsUrl(owner, repo, path, branch);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    if (isGitHubNetworkFetchFailure(error)) {
      throw new Error(`Backend GitHub proxy is unreachable. ${error instanceof Error ? error.message : ""}`.trim());
    }
    throw error;
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Backend GitHub proxy failed: ${response.statusText}`);
  }
  const payload = (await response.json()) as GitHubFile[];
  if (!Array.isArray(payload)) {
    throw new Error("Backend GitHub proxy returned an invalid repository listing.");
  }
  return payload;
}

async function expandGitHubXacroFromBackend(params: {
  owner: string;
  repo: string;
  targetPath: string;
  branch?: string;
  accessToken?: string;
}): Promise<{ urdf: string; stderr?: string | null }> {
  const url = toFetchableUrl("/ilu/expand-github");

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner: params.owner,
        repo: params.repo,
        target_path: params.targetPath,
        branch: params.branch,
        access_token: params.accessToken,
        args: {},
        use_inorder: true,
      }),
    });
  } catch (error) {
    if (isGitHubNetworkFetchFailure(error)) {
      throw new Error(
        `Backend GitHub xacro expansion is unreachable. ${error instanceof Error ? error.message : ""}`.trim()
      );
    }
    throw error;
  }

  if (!response.ok) {
    let message = "Failed to expand GitHub xacro file.";
    try {
      const payload = await response.json();
      if (payload?.detail) {
        message = payload.detail;
      }
    } catch {
      // Ignore parse errors.
    }
    throw new Error(message);
  }

  const payload = (await response.json()) as { urdf?: string; stderr?: string | null };
  if (!payload?.urdf || payload.urdf.trim().length === 0) {
    throw new Error("Backend GitHub xacro expansion returned empty output.");
  }
  return {
    urdf: payload.urdf,
    stderr: typeof payload.stderr === "string" || payload.stderr === null ? payload.stderr : null,
  };
}

const isGitHubNetworkFetchFailure = (error: unknown): boolean =>
  error instanceof Error && GITHUB_NETWORK_FETCH_ERROR_PATTERN.test(error.message);

const canUseGitHubDevProxyFallback = (): boolean => {
  if (typeof window === "undefined") return false;
  const currentMode = import.meta.env.MODE || "";
  return (
    import.meta.env.DEV ||
    GITHUB_API_PROXY_FALLBACK_ENABLED_MODES.includes(
      currentMode as (typeof GITHUB_API_PROXY_FALLBACK_ENABLED_MODES)[number]
    )
  );
};

const buildGitHubDevProxyUrl = (url: string): string | null => {
  if (!canUseGitHubDevProxyFallback()) return null;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== GITHUB_API_BASE_URL) return null;
    return `${GITHUB_API_DEV_PROXY_PREFIX}${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
};

async function fetchGitHubApiRequest(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (!isGitHubNetworkFetchFailure(error)) {
      throw error;
    }

    const proxyUrl = buildGitHubDevProxyUrl(url);
    if (!proxyUrl) {
      throw new Error(buildGitHubNetworkErrorMessage(url));
    }

    const retryHeaders = new Headers(init.headers ?? {});
    retryHeaders.set(GITHUB_API_PROXY_RETRY_HEADER, GITHUB_API_PROXY_RETRY_HEADER_VALUE);
    try {
      return await fetch(proxyUrl, {
        ...init,
        headers: retryHeaders,
      });
    } catch (proxyError) {
      if (isGitHubNetworkFetchFailure(proxyError)) {
        throw new Error(buildGitHubNetworkErrorMessage(url));
      }
      throw proxyError;
    }
  }
}

async function fetchPublicMirrorRequest(url: string): Promise<Response> {
  try {
    return await fetch(url);
  } catch (error) {
    if (isGitHubNetworkFetchFailure(error)) {
      throw new Error(buildGitHubNetworkErrorMessage(url));
    }
    throw error;
  }
}

function buildGitHubHeaders(accessToken?: string, initialHeaders?: HeadersInit): Headers {
  const headers = new Headers(initialHeaders ?? {});
  if (!headers.has("Accept")) {
    headers.set("Accept", GITHUB_API_ACCEPT_HEADER);
  }
  if (accessToken) {
    headers.set("Authorization", `token ${accessToken}`);
  } else {
    headers.delete("Authorization");
  }
  return headers;
}

async function fetchGitHubApi(
  url: string,
  {
    accessToken,
    init,
    allowAnonymousRetryOnBadCredentials = true,
  }: {
    accessToken?: string;
    init?: RequestInit;
    allowAnonymousRetryOnBadCredentials?: boolean;
  } = {}
): Promise<GitHubApiFetchResult> {
  const firstResponse = await fetchGitHubApiRequest(url, {
    ...init,
    headers: buildGitHubHeaders(accessToken, init?.headers),
  });

  if (!accessToken || !allowAnonymousRetryOnBadCredentials || firstResponse.status !== 401) {
    return { response: firstResponse, fellBackToAnonymous: false };
  }

  const firstResponseText = await firstResponse.clone().text().catch(() => "");
  const authenticateHeader = firstResponse.headers.get("www-authenticate") ?? "";
  const isBadCredentials =
    GITHUB_BAD_CREDENTIALS_PATTERN.test(firstResponseText) ||
    GITHUB_BAD_CREDENTIALS_PATTERN.test(authenticateHeader);
  if (!isBadCredentials) {
    return { response: firstResponse, fellBackToAnonymous: false };
  }

  const retryResponse = await fetchGitHubApiRequest(url, {
    ...init,
    headers: buildGitHubHeaders(undefined, init?.headers),
  });
  return { response: retryResponse, fellBackToAnonymous: true };
}

async function fetchGitHubApiWithAbuseRetry(
  url: string,
  options?: {
    accessToken?: string;
    init?: RequestInit;
    allowAnonymousRetryOnBadCredentials?: boolean;
  }
): Promise<GitHubApiFetchResult> {
  for (let attempt = 0; attempt <= GITHUB_ABUSE_MAX_RETRIES; attempt += 1) {
    const result = await fetchGitHubApi(url, options);
    const { response } = result;
    if (response.status !== 403 || response.headers.get("x-ratelimit-remaining") === "0") {
      return result;
    }

    const responseText = await response.clone().text().catch(() => "");
    if (!GITHUB_ABUSE_DETECTION_PATTERN.test(responseText)) {
      return result;
    }

    if (attempt === GITHUB_ABUSE_MAX_RETRIES) {
      throw new Error(
        "GitHub temporarily throttled this request due to abuse detection. Please wait a minute and retry."
      );
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    const fallbackDelayMs = Math.min(
      GITHUB_ABUSE_BASE_DELAY_MS * Math.pow(2, attempt),
      GITHUB_ABUSE_MAX_DELAY_MS
    );
    const baseDelayMs = retryAfterMs ?? fallbackDelayMs;
    const jitterMs = Math.floor(Math.random() * Math.max(250, Math.round(baseDelayMs * 0.2)));
    await sleep(baseDelayMs + jitterMs);
  }

  throw new Error("GitHub request failed unexpectedly.");
}

/**
 * Parse GitHub repository URL
 * Supports formats:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/tree/branch
 * - https://github.com/owner/repo/tree/branch/path
 * - owner/repo
 */
export function parseGitHubUrl(url: string): GitHubRepoInfo | null {
  const decodeGitHubUrlSegment = (value: string): string => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  // Remove trailing slash
  url = url.trim().replace(/\/$/, "");

  // Handle owner/repo format
  if (!url.includes("github.com")) {
    const parts = url.split("/");
    if (parts.length >= 2) {
      return {
        owner: parts[0],
        repo: parts[1],
        path: parts.length > 2 ? parts.slice(2).join("/") : undefined,
      };
    }
    return null;
  }

  // Parse full GitHub URL
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname !== "github.com" && urlObj.hostname !== "www.github.com") {
      return null;
    }

    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    if (pathParts.length < 2) {
      return null;
    }

    const owner = pathParts[0];
    const repo = pathParts[1];

    // Check if there's a tree path
    let branch: string | undefined;
    let path: string | undefined;
    if (pathParts.length > 2 && pathParts[2] === "tree") {
      branch = decodeGitHubUrlSegment(pathParts[3]);
      if (pathParts.length > 4) {
        path = pathParts.slice(4).map(decodeGitHubUrlSegment).join("/");
      }
    } else if (pathParts.length > 2) {
      path = pathParts.slice(2).map(decodeGitHubUrlSegment).join("/");
    }

    return { owner, repo, path, branch };
  } catch {
    return null;
  }
}

/**
 * Get the default branch for a repository
 */
async function getDefaultBranch(
  owner: string,
  repo: string,
  accessToken?: string
): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}`;

  try {
    const { response, fellBackToAnonymous } = await fetchGitHubApiWithAbuseRetry(url, {
      accessToken,
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Repository not found");
      }
      if (response.status === 403) {
        const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
        if (rateLimitRemaining === "0") {
          throw new Error("GitHub API rate limit exceeded. Please try again later.");
        }
        if (accessToken && !fellBackToAnonymous) {
          throw new Error("Token has no access to this repository. Please check your token permissions.");
        }
        throw new Error("Repository is private or access denied. Public repositories only.");
      }
      if (response.status === 401) {
        throw new Error("Invalid GitHub token. Please update your credentials.");
      }
      throw new Error(`Failed to fetch repository: ${response.statusText}`);
    }

    const data = await response.json();
    const branch = data.default_branch || "main";

    return branch;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("rate limit") ||
        error.message.includes("abuse detection") ||
        error.message.includes("temporarily throttled") ||
        error.message.includes("403") ||
        error.message.includes("404") ||
        error.message.includes(GITHUB_NETWORK_ERROR_PREFIX))
    ) {
      throw error;
    }
    // Fallback to "main" if we can't determine the branch
    return "main";
  }
}

const addDirectoryAncestors = (directorySet: Set<string>, filePath: string): void => {
  const parts = normalizeRepositoryPath(filePath).split("/").filter(Boolean);
  if (parts.length <= 1) return;
  for (let i = 1; i < parts.length; i += 1) {
    directorySet.add(parts.slice(0, i).join("/"));
  }
};

const buildJsDelivrFlatUrl = (owner: string, repo: string, branch?: string): string =>
  `${JSDELIVR_DATA_BASE_URL}/package/gh/${owner}/${repo}${branch ? `@${encodeURIComponent(branch)}` : ""}/flat`;

const buildJsDelivrFileUrl = (
  owner: string,
  repo: string,
  filePath: string,
  branch?: string
): string => {
  const encodedPath = normalizeRepositoryPath(filePath)
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${JSDELIVR_CDN_BASE_URL}/gh/${owner}/${repo}${branch ? `@${encodeURIComponent(branch)}` : ""}/${encodedPath}`;
};

async function fetchRepoContentsFromJsDelivr(
  owner: string,
  repo: string,
  branch?: string,
  path: string = ""
): Promise<GitHubFile[]> {
  const listingUrl = buildJsDelivrFlatUrl(owner, repo, branch);
  const response = await fetchPublicMirrorRequest(listingUrl);
  if (response.status === 404) {
    throw new Error("Repository not found");
  }
  if (response.status === 403) {
    throw new Error("Repository is too large for public mirror listing.");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const statusLabel = response.statusText || `HTTP ${response.status}`;
    throw new Error(
      `Failed to fetch repository listing: ${statusLabel}${detail ? ` - ${detail.slice(0, 160)}` : ""}`
    );
  }

  const payload = (await response.json()) as { files?: JsDelivrFlatFileEntry[] };
  if (!Array.isArray(payload.files)) {
    throw new Error("Invalid repository listing from public mirror.");
  }

  const normalizedPrefix = normalizeRepositoryPath(path);
  const files: GitHubFile[] = [];
  const directories = new Set<string>();

  payload.files.forEach((entry) => {
    const rawPath = typeof entry.name === "string" ? entry.name : entry.path;
    const repoPath = normalizeRepositoryPath(rawPath || "").replace(/^\/+/, "");
    if (!repoPath) return;
    if (
      normalizedPrefix &&
      repoPath !== normalizedPrefix &&
      !repoPath.startsWith(`${normalizedPrefix}/`)
    ) {
      return;
    }

    addDirectoryAncestors(directories, repoPath);
    files.push({
      name: repoPath.split("/").pop() || repoPath,
      path: repoPath,
      type: "file",
      download_url: buildJsDelivrFileUrl(owner, repo, repoPath, branch),
      size: Number.isFinite(entry.size) ? entry.size : undefined,
    });
  });

  directories.forEach((dirPath) => {
    files.push({
      name: dirPath.split("/").pop() || dirPath,
      path: dirPath,
      type: "dir",
      download_url: null,
      size: 0,
    });
  });

  files.sort((left, right) => {
    if (left.path === right.path) {
      if (left.type === right.type) return 0;
      return left.type === "dir" ? -1 : 1;
    }
    return left.path.localeCompare(right.path);
  });

  return files;
}

/**
 * Fetch repository contents using the Trees API (recursive)
 * This fetches ALL files in the repository in a SINGLE API call
 */
export async function fetchRepoContents(
  owner: string,
  repo: string,
  path: string = "",
  accessToken?: string,
  options: FetchRepoContentsOptions = {}
): Promise<GitHubFile[]> {
  const branchHint = options.branch?.trim() || undefined;
  const strategy = options.strategy ?? "auto";
  const cacheKey = buildRepoContentsCacheKey(owner, repo, path, accessToken, branchHint);
  const persistRepoContentsToStorage = !accessToken;
  const cached = readRepoContentsCache(cacheKey, {
    allowStorage: persistRepoContentsToStorage,
  });
  if (cached) {
    return cached;
  }
  const inFlight = repoContentsInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const pending = (async () => {
    const fetchFromPublicMirror = async (branch?: string): Promise<GitHubFile[]> => {
      const files = await fetchRepoContentsFromJsDelivr(owner, repo, branch, path);
      writeRepoContentsCache(cacheKey, files, { persistToStorage: false });
      return files;
    };
    const fetchFromBackend = async (branch?: string): Promise<GitHubFile[]> => {
      const files = await fetchRepoContentsFromBackend(owner, repo, path, branch);
      writeRepoContentsCache(cacheKey, files, { persistToStorage: false });
      return files;
    };

    try {
      const prefersBackendFirst =
        strategy === "archive-first" || (strategy === "auto" && !accessToken);

      if (prefersBackendFirst) {
        try {
          return await fetchFromBackend(branchHint);
        } catch {
          try {
            return await fetchFromPublicMirror(branchHint);
          } catch {
            // Fall through to the GitHub API path when the backend proxy and public mirror are unavailable.
          }
        }
      }

      let defaultBranch: string;
      if (branchHint) {
        defaultBranch = branchHint;
      } else {
        try {
          defaultBranch = await getDefaultBranch(owner, repo, accessToken);
        } catch (error) {
          if (
            !(error instanceof Error) ||
            (!error.message.includes("rate limit") &&
              !error.message.includes(GITHUB_NETWORK_ERROR_PREFIX))
          ) {
            throw error;
          }
          try {
            return await fetchFromBackend(branchHint);
          } catch {
            return await fetchFromPublicMirror();
          }
        }
      }

      // Build the Trees API URL
      // Format: /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1
      // For a specific path, use: {branch}:{path}
      // For root, use: {branch}
      const treeRef = path ? `${defaultBranch}:${path}` : defaultBranch;
      const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeRef}?recursive=1`;

      const { response, fellBackToAnonymous } = await fetchGitHubApiWithAbuseRetry(url, {
        accessToken,
      });

      if (response.status === 404) {
        // If path was provided and tree not found, try root and filter
        if (path) {
          // Fallback to root if path doesn't exist
          const rootUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`;
          const { response: rootResponse } = await fetchGitHubApiWithAbuseRetry(rootUrl, {
            accessToken,
          });
          if (!rootResponse.ok) {
            throw new Error("Repository or path not found");
          }
          const rootData = (await rootResponse.json()) as { tree?: GitHubTreeEntry[] };
          if (!rootData.tree || !Array.isArray(rootData.tree)) {
            throw new Error("Invalid tree response from GitHub API");
          }
          // Filter to only include files that start with the path
          const filteredTree = rootData.tree.filter((entry) => entry.path.startsWith(path));
          const files = convertTreeToFiles(filteredTree, path);
          writeRepoContentsCache(cacheKey, files, {
            persistToStorage: persistRepoContentsToStorage,
          });
          return files;
        }
        throw new Error("Repository or path not found");
      }

      if (response.status === 403) {
        const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
        if (rateLimitRemaining === "0") {
          try {
            return await fetchFromBackend(defaultBranch);
          } catch {
            return await fetchFromPublicMirror(defaultBranch);
          }
        }
        if (accessToken && !fellBackToAnonymous) {
          throw new Error("Token has no access to this repository. Please check your token permissions.");
        }
        throw new Error("Repository is private or access denied. Public repositories only.");
      }
      if (response.status === 401) {
        throw new Error("Invalid GitHub token. Please update your credentials.");
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `Failed to fetch repository tree: ${response.statusText}${errorText ? ` - ${errorText.substring(0, 200)}` : ""}`
        );
      }

      const data = await response.json();

      // Trees API returns a tree object with a tree array
      if (!data.tree || !Array.isArray(data.tree)) {
        throw new Error("Invalid tree response from GitHub API - missing tree array");
      }

      // Convert tree entries to GitHubFile format
      const files = convertTreeToFiles(data.tree, path);
      writeRepoContentsCache(cacheKey, files, {
        persistToStorage: persistRepoContentsToStorage,
      });
      return files;
    } catch (error) {
      if (!accessToken) {
        try {
          return await fetchFromBackend(branchHint);
        } catch {
          // Fall through to the original error when the backend proxy is unavailable too.
        }
      }
      if (error instanceof Error) {
        // Re-throw with more context
        if (
          error.message.includes("rate limit") ||
          error.message.includes("abuse detection") ||
          error.message.includes("temporarily throttled") ||
          error.message.includes("403") ||
          error.message.includes("404") ||
          error.message.includes(GITHUB_NETWORK_ERROR_PREFIX)
        ) {
          throw error;
        }
        throw new Error(`Failed to fetch repository contents: ${error.message}`);
      }
      throw new Error("Failed to fetch repository contents: Unknown error");
    }
  })().finally(() => {
    repoContentsInFlight.delete(cacheKey);
  });

  repoContentsInFlight.set(cacheKey, pending);
  return pending;
}

/**
 * Convert GitHub Trees API response to GitHubFile array
 */
function convertTreeToFiles(treeEntries: GitHubTreeEntry[], pathPrefix: string = ""): GitHubFile[] {
  const files: GitHubFile[] = [];
  const directories = new Set<string>();

  for (const entry of treeEntries) {
    // Filter by path prefix if specified
    if (pathPrefix && !entry.path.startsWith(pathPrefix)) {
      continue;
    }

    if (entry.type === "blob") {
      // It's a file - store the blob SHA for efficient content fetching
      const fileName = entry.path.split("/").pop() || entry.path;
      files.push({
        name: fileName,
        path: entry.path, // Always store the full repository path
        type: "file",
        download_url: null,
        size: entry.size || 0,
        sha: entry.sha, // Store SHA for Blob API
        encoding: "sha", // Indicate we have a SHA
      });
    } else if (entry.type === "tree") {
      // It's a directory - track it
      directories.add(entry.path);
    }
  }

  // Add directory entries for meshes folder detection
  for (const dirPath of directories) {
    const dirName = dirPath.split("/").pop() || dirPath;
    files.push({
      name: dirName,
      path: dirPath,
      type: "dir",
      download_url: null,
      size: 0,
    });
  }

  return files;
}

/**
 * Check if repository is public
 */
export async function checkRepoVisibility(
  owner: string,
  repo: string,
  accessToken?: string
): Promise<{ isPublic: boolean; error?: string }> {
  const url = `https://api.github.com/repos/${owner}/${repo}`;

  try {
    const { response, fellBackToAnonymous } = await fetchGitHubApiWithAbuseRetry(url, {
      accessToken,
    });

    if (response.status === 404) {
      if (accessToken) {
        return { isPublic: false, error: "Repository not found or token has no access" };
      }
      return { isPublic: false, error: "Repository not found" };
    }

    if (response.status === 403) {
      // Check if it's a rate limit or access issue
      const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
      if (rateLimitRemaining === "0") {
        return { isPublic: false, error: "GitHub API rate limit exceeded" };
      }
      if (accessToken && !fellBackToAnonymous) {
        return { isPublic: false, error: "Token has no access to this repository" };
      }
      return { isPublic: false, error: "Repository is private or access denied" };
    }
    if (response.status === 401) {
      return { isPublic: false, error: "Invalid GitHub token. Please update your credentials." };
    }

    if (!response.ok) {
      return { isPublic: false, error: `Failed to check repository: ${response.statusText}` };
    }

    const data = await response.json();
    return { isPublic: !data.private };
  } catch (error) {
    return {
      isPublic: false,
      error: error instanceof Error ? error.message : "Failed to check repository visibility",
    };
  }
}

export function findURDFCandidates(files: GitHubFile[]): URDFCandidate[] {
  return findRepositoryUrdfCandidates(files);
}

const extractMissingPackageNamesFromXacroError = (error: unknown): string[] => {
  if (!(error instanceof Error) || !error.message) return [];
  const names = new Set<string>();
  XACRO_MISSING_PACKAGE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = XACRO_MISSING_PACKAGE_PATTERN.exec(error.message)) !== null) {
    const packageName = match[1]?.trim();
    if (packageName) {
      names.add(packageName);
    }
  }
  return Array.from(names);
};

/**
 * Check URDF candidates for unsupported mesh formats and unmatched mesh references
 * This fetches URDF content and checks for unsupported formats and missing mesh files
 */
export async function checkCandidatesForUnsupportedFormats(
  candidates: URDFCandidate[],
  files: GitHubFile[],
  owner: string,
  repo: string,
  accessToken?: string,
  options?: {
    maxCandidatesToInspect?: number;
    concurrency?: number;
  }
): Promise<URDFCandidate[]> {
  try {
    const inspected = await inspectRepositoryCandidates(
      candidates,
      files,
      async (_candidate, file) => {
        const { content } = await getGitHubFileContentForFile(owner, repo, file, accessToken);
        return content.text();
      },
      options
    );
    return inspected.map((candidate) =>
      candidate.isXacro
        ? {
            ...candidate,
            hasUnsupportedFormats: false,
            unsupportedFormats: undefined,
            unmatchedMeshReferences: undefined,
          }
        : candidate
    );
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[GitHub] Could not inspect repository candidates:", error);
    }
    return candidates;
  }
}

/**
 * Find meshes or assets folder in a specific directory
 */
function findMeshOrAssetsFolder(files: GitHubFile[], rootPath: string): { meshes?: GitHubFile; assets?: GitHubFile } {
  const meshes = files.find(
    f => f.type === "dir" &&
    f.path.toLowerCase() === `${rootPath}/meshes`.toLowerCase() &&
    f.name.toLowerCase() === "meshes"
  );
  
  const assets = files.find(
    f => f.type === "dir" &&
    f.path.toLowerCase() === `${rootPath}/assets`.toLowerCase() &&
    f.name.toLowerCase() === "assets"
  );
  
  return { meshes, assets };
}

/**
 * Find and locate robot description structures matching the pattern:
 * robot_name_description/
 *   [any_folder]/ or *.urdf  (URDF files can be in any subdirectory)
 *   meshes/ or assets/
 * 
 * This function detects the standard ROS robot description package structure.
 */
/**
 * Decode base64 string to ArrayBuffer
 */
function decodeBase64(base64String: string): ArrayBuffer {
  const binaryString = atob(base64String.replace(/\s/g, ""));
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const extractGltfResourceUris = (gltfText: string): string[] => {
  try {
    const data = JSON.parse(gltfText);
    const uris: string[] = [];
    const buffers = Array.isArray(data?.buffers) ? data.buffers : [];
    const images = Array.isArray(data?.images) ? data.images : [];
    buffers.forEach((buf: { uri?: string }) => {
      if (buf?.uri) uris.push(buf.uri);
    });
    images.forEach((img: { uri?: string }) => {
      if (img?.uri) uris.push(img.uri);
    });
    return uris;
  } catch {
    return [];
  }
};

const resolveReferencedResourcePath = (basePath: string, uri: string) => {
  const cleaned = uri.split("?")[0]?.split("#")[0] ?? uri;
  if (!cleaned || /^(data|file|https?):/i.test(cleaned)) {
    return "";
  }
  const baseDir = basePath.split("/").slice(0, -1).join("/");
  const combined = baseDir ? `${baseDir}/${cleaned}` : cleaned;
  return normalizeMeshPathForMatch(combined);
};

const stripInlineResourceComment = (line: string): string => {
  const commentIndex = line.indexOf("#");
  return commentIndex === -1 ? line : line.slice(0, commentIndex);
};

const tokenizeResourceLine = (line: string): string[] => {
  const tokens: string[] = [];
  const tokenPattern = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(line)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens.filter((token) => token.length > 0);
};

const isNumericResourceToken = (token: string): boolean =>
  token.trim().length > 0 && Number.isFinite(Number(token));

const extractObjMaterialUris = (objText: string): string[] => {
  const uris: string[] = [];
  objText.split(/\r?\n/).forEach((rawLine) => {
    const line = stripInlineResourceComment(rawLine).trim();
    if (!line.toLowerCase().startsWith("mtllib ")) return;
    const referenceText = line.slice("mtllib ".length).trim();
    if (!referenceText) return;
    uris.push(referenceText);
    tokenizeResourceLine(referenceText).forEach((token) => uris.push(token));
  });
  return Array.from(new Set(uris));
};

const MTL_TEXTURE_DIRECTIVES = new Set([
  "map_ka",
  "map_kd",
  "map_ks",
  "map_ke",
  "map_ns",
  "map_d",
  "map_bump",
  "map_pr",
  "map_pm",
  "map_ps",
  "map_refl",
  "bump",
  "disp",
  "decal",
  "norm",
  "refl",
]);

const MTL_FIXED_OPTION_ARG_COUNTS: Record<string, number> = {
  "-blendu": 1,
  "-blendv": 1,
  "-cc": 1,
  "-clamp": 1,
  "-imfchan": 1,
  "-type": 1,
};

const MTL_NUMERIC_OPTION_MAX_ARG_COUNTS: Record<string, number> = {
  "-boost": 1,
  "-bm": 1,
  "-mm": 2,
  "-o": 3,
  "-s": 3,
  "-t": 3,
  "-texres": 1,
};

const extractMtlTextureUris = (mtlText: string): string[] => {
  const uris: string[] = [];
  mtlText.split(/\r?\n/).forEach((rawLine) => {
    const line = stripInlineResourceComment(rawLine).trim();
    if (!line) return;
    const firstWhitespaceIndex = line.search(/\s/);
    if (firstWhitespaceIndex === -1) return;
    const directive = line.slice(0, firstWhitespaceIndex).toLowerCase();
    if (!MTL_TEXTURE_DIRECTIVES.has(directive)) return;

    const tokens = tokenizeResourceLine(line.slice(firstWhitespaceIndex + 1));
    let index = 0;
    while (index < tokens.length && tokens[index]?.startsWith("-")) {
      const option = tokens[index]?.toLowerCase() ?? "";
      index += 1;
      const fixedArgCount = MTL_FIXED_OPTION_ARG_COUNTS[option];
      if (fixedArgCount !== undefined) {
        index += Math.min(fixedArgCount, tokens.length - index);
        continue;
      }
      const numericMaxArgCount = MTL_NUMERIC_OPTION_MAX_ARG_COUNTS[option];
      let consumedNumericArgs = 0;
      while (
        numericMaxArgCount !== undefined &&
        consumedNumericArgs < numericMaxArgCount &&
        index < tokens.length &&
        isNumericResourceToken(tokens[index] ?? "")
      ) {
        index += 1;
        consumedNumericArgs += 1;
      }
    }

    const uri = tokens.slice(index).join(" ").trim();
    if (uri) {
      uris.push(uri);
    }
  });
  return Array.from(new Set(uris));
};

const extractDaeResourceUris = (daeText: string): string[] => {
  if (!daeText.trim()) return [];
  const uris: string[] = [];
  if (typeof DOMParser !== "undefined") {
    try {
      const document = new DOMParser().parseFromString(daeText, "application/xml");
      Array.from(document.getElementsByTagName("init_from")).forEach((node) => {
        const value = node.textContent?.trim();
        if (value) {
          uris.push(value);
        }
      });
    } catch {
      // Fall through to the regex fallback below.
    }
  }
  if (uris.length === 0) {
    const initFromPattern = /<init_from\b[^>]*>([^<]+)<\/init_from>/gi;
    let match: RegExpExecArray | null;
    while ((match = initFromPattern.exec(daeText)) !== null) {
      const value = match[1]?.trim();
      if (value) {
        uris.push(value);
      }
    }
  }
  return Array.from(new Set(uris));
};

const extractReferencedResourceUris = (filePath: string, text: string): string[] => {
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.endsWith(".gltf")) {
    return extractGltfResourceUris(text);
  }
  if (lowerPath.endsWith(".obj")) {
    return extractObjMaterialUris(text);
  }
  if (lowerPath.endsWith(".mtl")) {
    return extractMtlTextureUris(text);
  }
  if (lowerPath.endsWith(".dae")) {
    return extractDaeResourceUris(text);
  }
  return [];
};

/**
 * Get MIME type from file path
 */
function getMimeType(filePath: string): string {
  const fileName = filePath.split("/").pop() || filePath;
  const lowerFileName = fileName.toLowerCase();
  
  if (lowerFileName.endsWith('.urdf') || lowerFileName.endsWith('.xml')) {
    return 'application/xml';
  }
  if (lowerFileName.endsWith('.stl')) {
    return 'model/stl';
  }
  if (lowerFileName.endsWith('.glb')) {
    return 'model/gltf-binary';
  }
  if (lowerFileName.endsWith('.gltf')) {
    return 'model/gltf+json';
  }
  if (lowerFileName.endsWith('.png')) {
    return 'image/png';
  }
  if (lowerFileName.endsWith('.jpg') || lowerFileName.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lowerFileName.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lowerFileName.endsWith('.ktx2')) {
    return 'image/ktx2';
  }
  if (lowerFileName.endsWith('.bin')) {
    return 'application/octet-stream';
  }
  if (lowerFileName.endsWith('.txt')) {
    return 'text/plain';
  }
  return 'application/octet-stream';
}

const readBlobText = async (blob: Blob): Promise<string> => {
  const maybeText = (blob as Blob & { text?: () => Promise<string> }).text;
  if (typeof maybeText === "function") {
    return maybeText.call(blob);
  }
  const maybeArrayBuffer = (blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  if (typeof maybeArrayBuffer === "function") {
    const buffer = await maybeArrayBuffer.call(blob);
    return new TextDecoder().decode(buffer);
  }
  if (typeof FileReader !== "undefined") {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read blob content"));
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsText(blob);
    });
  }
  try {
    return await new Response(blob as unknown as BodyInit).text();
  } catch {
    // Fall through to final error.
  }
  throw new Error("Failed to read blob content");
};

/**
 * Get file content from GitHub using the Blob API (most efficient)
 * Falls back to Contents API if blob SHA is not available
 */
async function getGitHubFileContent(
  owner: string,
  repo: string,
  filePath: string,
  accessToken?: string,
  blobSha?: string,
  directUrl?: string
): Promise<GitHubFileContentResult> {
  const cacheable = isCacheableGitHubContentPath(filePath);
  const cacheKey = cacheable
    ? buildFileContentCacheKey(owner, repo, filePath, accessToken, directUrl || blobSha)
    : "";

  if (cacheable) {
    const cached = gitHubFileContentCache.get(cacheKey);
    if (cached) {
      if (Date.now() <= cached.expiresAt) {
        return cached.value;
      }
      gitHubFileContentCache.delete(cacheKey);
    }

    const inFlight = gitHubFileContentInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }
  }

  const fetchPromise = (async (): Promise<GitHubFileContentResult> => {
    const mimeType = getMimeType(filePath);

    if (directUrl) {
      const resolvedDirectUrl = toFetchableUrl(directUrl);
      try {
        const directResponse = await fetch(resolvedDirectUrl);
        if (directResponse.ok) {
          const content = await directResponse.arrayBuffer();
          const result = { content: new Blob([content], { type: mimeType }), mimeType };
          if (cacheable) {
            gitHubFileContentCache.set(cacheKey, {
              expiresAt: Date.now() + GITHUB_FILE_CONTENT_CACHE_TTL_MS,
              value: result,
            });
            while (gitHubFileContentCache.size > GITHUB_FILE_CONTENT_CACHE_MAX_ENTRIES) {
              const oldestKey = gitHubFileContentCache.keys().next().value as string | undefined;
              if (!oldestKey) break;
              gitHubFileContentCache.delete(oldestKey);
            }
          }
          return result;
        }
      } catch (error) {
        if (!isGitHubNetworkFetchFailure(error)) {
          throw error;
        }
      }
    }

    const url = blobSha
      ? `https://api.github.com/repos/${owner}/${repo}/git/blobs/${blobSha}`
      : `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

    const { response, fellBackToAnonymous } = await fetchGitHubApiWithAbuseRetry(url, {
      accessToken,
    });

    if (response.status === 404) {
      throw new Error(`File not found: ${filePath}${blobSha ? ` (SHA: ${blobSha.substring(0, 7)}...)` : ""}`);
    }

    if (response.status === 403) {
      const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
      if (rateLimitRemaining === "0") {
        throw new Error("GitHub API rate limit exceeded. Please try again later.");
      }
      if (accessToken && !fellBackToAnonymous) {
        throw new Error("Token has no access to this file. Please check your token permissions.");
      }
      throw new Error("Access denied to file.");
    }
    if (response.status === 401) {
      throw new Error("Invalid GitHub token. Please update your credentials.");
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }

    const data = await response.json();

    // Both Blob API and Contents API return base64 encoded content
    if (!data.content || data.encoding !== "base64") {
      throw new Error(`File content not available in expected format: ${filePath}`);
    }

    try {
      const content = decodeBase64(data.content);
      const result = { content: new Blob([content], { type: mimeType }), mimeType };
      if (cacheable) {
        gitHubFileContentCache.set(cacheKey, {
          expiresAt: Date.now() + GITHUB_FILE_CONTENT_CACHE_TTL_MS,
          value: result,
        });
        while (gitHubFileContentCache.size > GITHUB_FILE_CONTENT_CACHE_MAX_ENTRIES) {
          const oldestKey = gitHubFileContentCache.keys().next().value as string | undefined;
          if (!oldestKey) break;
          gitHubFileContentCache.delete(oldestKey);
        }
      }
      return result;
    } catch (error) {
      throw new Error(`Failed to decode file content: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  })();

  if (!cacheable) {
    return fetchPromise;
  }

  gitHubFileContentInFlight.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    gitHubFileContentInFlight.delete(cacheKey);
  }
}

const getEmbeddedGitHubFileContent = (file: GitHubFile): GitHubFileContentResult | null => {
  if (!file.content || file.encoding !== "base64") {
    return null;
  }
  const mimeType = getMimeType(file.path);
  const content = decodeBase64(file.content);
  return {
    content: new Blob([content], { type: mimeType }),
    mimeType,
  };
};

async function getGitHubFileContentForFile(
  owner: string,
  repo: string,
  file: GitHubFile,
  accessToken?: string
): Promise<GitHubFileContentResult> {
  const embedded = getEmbeddedGitHubFileContent(file);
  if (embedded) {
    return embedded;
  }
  const blobSha = file.sha || (file.encoding === "sha" ? file.content : undefined);
  const directUrl = file.download_url || undefined;
  return getGitHubFileContent(
    file.sourceOwner || owner,
    file.sourceRepo || repo,
    file.sourcePath || file.path,
    accessToken,
    blobSha,
    directUrl
  );
}

/**
 * Extract mesh references from URDF content
 */
export function extractMeshReferencesFromURDF(urdfContent: string): string[] {
  return extractMeshReferencesFromUrdf(urdfContent);
}

/**
 * Resolve mesh path using simple relative path resolution
 * Searches entire repository tree (case-insensitive)
*/
export function resolveMeshPathGeneric(
  urdfPath: string,
  meshRef: string,
  _fileMap: Map<string, GitHubFile>, // Unused - kept for API compatibility
  lowerCaseFileMap: Map<string, GitHubFile>,
  _rootPrefix: string // Unused - kept for API compatibility
): GitHubFile | null {
  return resolveMeshPathInRepository(urdfPath, meshRef, lowerCaseFileMap);
}

export const collectXacroSupportFilesForGitHub = (
  files: GitHubFile[],
  targetPath: string
): GitHubFile[] => collectXacroSupportFilesFromRepository(files, targetPath);

const getFileRelativePath = (file: File): string => {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
};

const findGitHubFileByPath = (files: GitHubFile[], targetPath: string): GitHubFile | null => {
  const normalizedTarget = normalizeMeshPathForMatch(targetPath);
  if (!normalizedTarget) return null;
  return (
    files.find(
      (file) =>
        file.type === "file" && normalizeMeshPathForMatch(file.path) === normalizedTarget
    ) ?? null
  );
};

const scoreWrapperCandidate = (path: string): number => {
  const lower = path.toLowerCase();
  let score = 0;
  if (isUrdfXacroPath(lower)) score += 40;
  if (lower.includes("/robots/")) score += 20;
  if (lower.includes("/robot/")) score += 10;
  if (lower.includes("/common/")) score -= 40;
  if (lower.includes("macro")) score -= 25;
  if (lower.startsWith("_") || lower.includes("/_")) score -= 20;
  return score;
};

const collectTargetPathHints = (targetPath: string): string[] => {
  const normalized = normalizeMeshPathForMatch(targetPath);
  if (!normalized) return [];
  const parts = normalized.split("/").filter(Boolean);
  const hints = new Set<string>();
  const fileName = parts[parts.length - 1];
  if (fileName) hints.add(fileName.toLowerCase());
  for (let depth = 2; depth <= 4; depth++) {
    if (parts.length < depth) break;
    hints.add(parts.slice(parts.length - depth).join("/").toLowerCase());
  }
  return Array.from(hints);
};

const findRenderableWrapperForXacro = async (params: {
  targetPath: string;
  supportFileObjects: File[];
}): Promise<{ wrapperPath: string; urdf: string } | null> => {
  const { targetPath, supportFileObjects } = params;
  const normalizedTarget = normalizeMeshPathForMatch(targetPath);
  if (!normalizedTarget) return null;

  const xacroTexts = await Promise.all(
    supportFileObjects.map(async (file) => {
      const path = normalizeMeshPathForMatch(getFileRelativePath(file));
      if (!path || !isXacroPath(path) || path === normalizedTarget) return null;
      try {
        const text = await file.text();
        return { path, text };
      } catch {
        return null;
      }
    })
  );

  const hints = collectTargetPathHints(normalizedTarget);
  const includeCandidates = xacroTexts
    .filter((entry): entry is { path: string; text: string } => Boolean(entry))
    .filter((entry) => {
      const lowered = entry.text.toLowerCase();
      return hints.some((hint) => lowered.includes(hint));
    })
    .sort((a, b) => scoreWrapperCandidate(b.path) - scoreWrapperCandidate(a.path))
    .slice(0, GITHUB_XACRO_WRAPPER_CANDIDATE_LIMIT);

  for (const candidate of includeCandidates) {
    try {
      const { urdf } = await expandXacro(candidate.path, supportFileObjects);
      if (hasRenderableUrdfGeometry(urdf)) {
        return { wrapperPath: candidate.path, urdf };
      }
    } catch {
      // Continue trying other wrapper candidates.
    }
  }

  return null;
};

const prefixDependencyFiles = (
  files: GitHubFile[],
  packageName: string,
  sourceOwner: string,
  sourceRepo: string
): GitHubFile[] => {
  const prefix = `__deps/${packageName}`;
  return files.map((file) => ({
    ...file,
    path: normalizeRepositoryPath(`${prefix}/${file.path}`),
    sourceOwner,
    sourceRepo,
    sourcePath: file.path,
  }));
};

const mergeGitHubFiles = (primary: GitHubFile[], secondary: GitHubFile[]): GitHubFile[] => {
  if (secondary.length === 0) return primary;
  const merged = new Map<string, GitHubFile>();
  primary.forEach((file) => merged.set(file.path, file));
  secondary.forEach((file) => {
    if (!merged.has(file.path)) {
      merged.set(file.path, file);
    }
  });
  return Array.from(merged.values());
};

const fetchMissingPackageDependencyFiles = async (params: {
  owner: string;
  accessToken?: string;
  branch?: string;
  packageNames: string[];
  existingFiles: GitHubFile[];
  skipExistingCheck?: boolean;
  repoContentsCache?: Map<string, GitHubFile[] | null>;
}): Promise<GitHubFile[]> => {
  const { owner, accessToken, branch, packageNames, existingFiles, skipExistingCheck } = params;
  const packageRoots = buildPackageRootsFromFiles(existingFiles);
  const hasLocalPackageLikeFolder = (packageName: string): boolean => {
    const normalizedPackageName = normalizePathCached(packageName).toLowerCase();
    if (!normalizedPackageName) return false;
    return existingFiles.some((file) =>
      normalizePathCached(file.path)
        .toLowerCase()
        .split("/")
        .includes(normalizedPackageName)
    );
  };
  const missingPackages = skipExistingCheck
    ? packageNames
    : packageNames.filter((name) => !packageRoots[name] && !hasLocalPackageLikeFolder(name));
  if (missingPackages.length === 0) return [];

  const repoContentsCache = params.repoContentsCache ?? new Map<string, GitHubFile[] | null>();
  const dependencyFiles: GitHubFile[] = [];

  for (const packageName of missingPackages) {
    let resolvedRepo: string | null = null;
    let resolvedFiles: GitHubFile[] | null = null;

    for (const repoCandidate of buildDependencyRepositoryNameCandidates(packageName)) {
      const cacheKey = `${owner}/${repoCandidate}`;
      if (!repoContentsCache.has(cacheKey)) {
        try {
          const repoFiles = await fetchRepoContents(owner, repoCandidate, "", accessToken, {
            branch,
          });
          repoContentsCache.set(cacheKey, repoFiles);
        } catch {
          repoContentsCache.set(cacheKey, null);
        }
      }

      const repoFiles = repoContentsCache.get(cacheKey);
      if (!repoFiles || repoFiles.length === 0) continue;
      if (!repositoryContainsPackage(repoFiles, packageName, repoCandidate)) continue;

      resolvedRepo = repoCandidate;
      resolvedFiles = repoFiles;
      break;
    }

    if (!resolvedRepo || !resolvedFiles) continue;
    dependencyFiles.push(
      ...prefixDependencyFiles(resolvedFiles, packageName, owner, resolvedRepo)
    );
  }

  return dependencyFiles;
};

const findPackageXmlForName = (files: GitHubFile[], packageName: string): GitHubFile | null => {
  const matched = findPackageXmlForPackageName(files, packageName);
  if (matched) {
    return matched;
  }

  const expectedPath = `${packageName.toLowerCase()}/package.xml`;
  return (
    files.find(
      (file) => file.type === "file" && normalizePathCached(file.path).toLowerCase() === expectedPath
    ) ?? null
  );
};

const hasExplicitLocalPackage = (
  files: GitHubFile[],
  packageName: string,
  repositoryName?: string
): boolean => {
  if (findPackageXmlForName(files, packageName)) {
    return true;
  }

  return Boolean(
    repositoryName &&
      files.some((file) => file.type === "file" && normalizePathCached(file.path) === "package.xml") &&
      repositoryContainsPackage(files, packageName, repositoryName)
  );
};

export const buildPackageRootsFromFiles = (files: GitHubFile[]): Record<string, string[]> =>
  buildPackageRootsFromRepositoryFiles(files);

export const resolveGitHubMeshReferences = (
  urdfPath: string,
  urdfText: string,
  files: GitHubFile[],
  packageRoots: Record<string, string[]> = buildPackageRootsFromFiles(files)
): {
  matches: GitHubFile[];
  matchByReference: Map<string, GitHubFile>;
  unresolved: string[];
} =>
  resolveRepositoryMeshReferences(urdfPath, urdfText, files, {
    packageRoots,
    supportedMeshExtensions: SUPPORTED_MESH_EXTENSIONS,
  });

export async function fetchGitHubFilesAsFileObjects(
  files: GitHubFile[],
  owner: string,
  repo: string,
  accessToken: string | undefined,
  targetFiles: GitHubFile[],
  options?: { requiredPaths?: string[] }
): Promise<File[]> {
  const pathMap = getLowerCaseFileMap(files);
  const queue: GitHubFile[] = [];
  const queued = new Set<string>();
  const results: File[] = [];
  const loadedPaths = new Set<string>();
  const requiredPathSet = new Set(
    (options?.requiredPaths ?? [])
      .map((path) => resolveGitHubRepositoryTargetPath(files, path))
      .map((path) => normalizeMeshPathForMatch(path))
      .filter((path): path is string => Boolean(path))
  );
  const requiredPathErrors = new Map<string, string>();

  const enqueue = (file: GitHubFile | null | undefined) => {
    if (!file || file.type !== "file") return;
    if (queued.has(file.path)) return;
    queued.add(file.path);
    queue.push(file);
  };

  targetFiles.forEach(enqueue);

  let index = 0;

  while (index < queue.length) {
    const batch = queue.slice(index, index + GITHUB_FILE_FETCH_BATCH_SIZE);
    index += batch.length;

    await Promise.all(
      batch.map(async (file) => {
        try {
          const { content, mimeType } = await getGitHubFileContentForFile(
            owner,
            repo,
            file,
            accessToken
          );

          const fileObj = new File([content], file.name, { type: mimeType });
          Object.defineProperty(fileObj, "webkitRelativePath", {
            value: file.path,
            writable: false,
            enumerable: true,
            configurable: false,
          });
          results.push(fileObj);
          const normalizedLoadedPath = normalizeMeshPathForMatch(file.path);
          if (normalizedLoadedPath) {
            loadedPaths.add(normalizedLoadedPath);
          }

          if (/\.(dae|gltf|mtl|obj)$/i.test(file.path)) {
            const text = await readBlobText(content);
            for (const uri of extractReferencedResourceUris(file.path, text)) {
              const resolvedPath = resolveReferencedResourcePath(file.path, uri);
              if (!resolvedPath) continue;
              const resolved = pathMap.get(resolvedPath.toLowerCase());
              if (resolved) enqueue(resolved);
            }
          }
        } catch {
          const normalizedPath = normalizeMeshPathForMatch(file.path);
          if (normalizedPath && requiredPathSet.has(normalizedPath)) {
            requiredPathErrors.set(normalizedPath, `Failed to fetch ${file.path} from GitHub.`);
          }
          // Continue processing other files even if one fails
        }
      })
    );

    if (index < queue.length) {
      await new Promise(resolve => setTimeout(resolve, GITHUB_FILE_FETCH_BATCH_DELAY_MS));
    }
  }

  const missingRequiredPaths = Array.from(requiredPathSet).filter(
    (path) => !loadedPaths.has(path)
  );
  if (missingRequiredPaths.length > 0) {
    const missingDetails = missingRequiredPaths.map((path) => {
      const file = findGitHubFileByPath(files, path);
      return requiredPathErrors.get(path) || `Failed to fetch ${file?.path || path} from GitHub.`;
    });
    throw new Error(missingDetails[0] || "Failed to fetch required GitHub file.");
  }

  return results;
}


/**
 * Convert GitHub files to FileList format
 * Resolves mesh paths from URDF content and matches them against repository files
 */
export async function convertGitHubFilesToFileList(
  files: GitHubFile[],
  urdfPath: string,
  owner: string,
  repo: string,
  accessToken?: string,
  options?: { additionalUrdfPaths?: string[]; branch?: string }
): Promise<FileList> {
  const dataTransfer = new DataTransfer();
  let resolvedFiles = files;
  let activeUrdfPath = resolveGitHubRepositoryTargetPath(files, urdfPath);
  const additionalUrdfPaths = Array.from(
    new Set(
      (options?.additionalUrdfPaths ?? [])
        .map((path) => normalizeMeshPathForMatch(path) || path)
        .filter((path) => path.length > 0)
    )
  );

  // Get URDF file from repository
  const urdfFile = findGitHubFileByPath(files, activeUrdfPath);
  if (!urdfFile) {
    throw new Error(`URDF file not found: ${activeUrdfPath}`);
  }
  const isXacro = isXacroPath(activeUrdfPath);
  let resolvedFromXacro = isXacro;
  let urdfText = "";
  let urdfContent: Blob;
  let urdfMimeType = "application/xml";
  let urdfRelativePath = activeUrdfPath;

  const expandFromXacroSource = async (targetPath: string) => {
    const resolvedTargetPath = resolveGitHubRepositoryTargetPath(resolvedFiles, targetPath);
    const attemptedRuntimeDependencyPackages = new Set<string>();
    const dependencyRepoContentsCache = new Map<string, GitHubFile[] | null>();

    const resolveStaticXacroDependencies = async (): Promise<File[]> => {
      let supportFileObjects: File[] = [];

      for (let iteration = 0; iteration < MAX_XACRO_DEPENDENCY_RECOVERY_PASSES; iteration += 1) {
        const supportFiles = collectXacroSupportFilesForGitHub(resolvedFiles, resolvedTargetPath);
        supportFileObjects = await fetchGitHubFilesAsFileObjects(
          resolvedFiles,
          owner,
          repo,
          accessToken,
          supportFiles,
          { requiredPaths: [resolvedTargetPath] }
        );

        const xacroPackageNames = new Set<string>();
        for (const file of supportFileObjects) {
          const text = await file.text();
          collectPackageNamesFromText(text).forEach((name) => xacroPackageNames.add(name));
        }

        const xacroDependencyFiles = await fetchMissingPackageDependencyFiles({
          owner,
          accessToken,
          branch: options?.branch,
          packageNames: Array.from(xacroPackageNames),
          existingFiles: resolvedFiles,
          repoContentsCache: dependencyRepoContentsCache,
        });

        if (xacroDependencyFiles.length === 0) {
          return supportFileObjects;
        }

        resolvedFiles = mergeGitHubFiles(resolvedFiles, xacroDependencyFiles);
      }

      return supportFileObjects;
    };

    try {
      const expanded = await expandGitHubXacroFromBackend({
        owner,
        repo,
        targetPath: resolvedTargetPath,
        branch: options?.branch,
        accessToken,
      });
      if (hasRenderableUrdfGeometry(expanded.urdf)) {
        return {
          urdfText: expanded.urdf,
          activePath: resolvedTargetPath,
        };
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("[GitHub] Backend GitHub xacro expansion failed, falling back:", error);
      }
    }

    let supportFileObjects = await resolveStaticXacroDependencies();
    let expanded;
    for (;;) {
      try {
        expanded = await expandXacro(resolvedTargetPath, supportFileObjects);
        break;
      } catch (error) {
        const missingPackages = extractMissingPackageNamesFromXacroError(error).filter(
          (packageName) => !attemptedRuntimeDependencyPackages.has(packageName)
        );
        if (missingPackages.length === 0) {
          throw error;
        }

        missingPackages.forEach((packageName) => attemptedRuntimeDependencyPackages.add(packageName));
        const localPackages = missingPackages.filter((packageName) =>
          hasExplicitLocalPackage(resolvedFiles, packageName, repo)
        );
        const remotePackages = missingPackages.filter(
          (packageName) => !localPackages.includes(packageName)
        );

        if (localPackages.length > 0) {
          supportFileObjects = await resolveStaticXacroDependencies();
          if (remotePackages.length === 0) {
            continue;
          }
        }

        const runtimeDependencyFiles = await fetchMissingPackageDependencyFiles({
          owner,
          accessToken,
          branch: options?.branch,
          packageNames: remotePackages,
          existingFiles: resolvedFiles,
          skipExistingCheck: true,
          repoContentsCache: dependencyRepoContentsCache,
        });
        if (runtimeDependencyFiles.length === 0) {
          throw error;
        }

        resolvedFiles = mergeGitHubFiles(resolvedFiles, runtimeDependencyFiles);
        supportFileObjects = await resolveStaticXacroDependencies();
      }
    }

    let expandedUrdfText = expanded.urdf;
    let expandedPath = resolvedTargetPath;
    if (!hasRenderableUrdfGeometry(expandedUrdfText)) {
      const wrapper = await findRenderableWrapperForXacro({
        targetPath: resolvedTargetPath,
        supportFileObjects,
      });
      if (wrapper) {
        expandedUrdfText = wrapper.urdf;
        expandedPath = wrapper.wrapperPath;
      }
    }

    return {
      urdfText: expandedUrdfText,
      activePath: expandedPath,
    };
  };

  if (isXacro) {
    const expanded = await expandFromXacroSource(activeUrdfPath);
    urdfText = expanded.urdfText;
    activeUrdfPath = expanded.activePath;
    urdfContent = new Blob([urdfText], { type: urdfMimeType });
    urdfRelativePath = normalizeExpandedUrdfPath(activeUrdfPath);
  } else {
    // Fetch URDF content first to extract mesh references
    const response = await getGitHubFileContentForFile(
      owner,
      repo,
      urdfFile,
      accessToken
    );
    urdfContent = response.content;
    urdfMimeType = response.mimeType;
    // Extract URDF content as text
    const urdfBlob =
      urdfContent && typeof (urdfContent as Blob).text === "function"
        ? (urdfContent as Blob)
        : new Blob([urdfContent as unknown as BlobPart], { type: urdfMimeType });
    urdfContent = urdfBlob;
    urdfText = await readBlobText(urdfBlob);
    if (hasXacroSyntax(urdfText)) {
      try {
        const expanded = await expandFromXacroSource(activeUrdfPath);
        if (hasRenderableUrdfGeometry(expanded.urdfText)) {
          urdfText = expanded.urdfText;
          activeUrdfPath = expanded.activePath;
          urdfContent = new Blob([urdfText], { type: urdfMimeType });
          urdfRelativePath = normalizeExpandedUrdfPath(activeUrdfPath);
          resolvedFromXacro = true;
        }
      } catch {
        // Keep original URDF behavior when opportunistic xacro expansion fails.
      }
    }
  }

  const urdfDependencyFiles = await fetchMissingPackageDependencyFiles({
    owner,
    accessToken,
    packageNames: collectMeshReferencedPackageNamesFromUrdf(urdfText),
    existingFiles: resolvedFiles,
  });
  if (urdfDependencyFiles.length > 0) {
    resolvedFiles = mergeGitHubFiles(resolvedFiles, urdfDependencyFiles);
  }

  const urdfAnalysis = analyzeUrdf(urdfText);
  if (!urdfAnalysis.isValid) {
    throw new Error(urdfAnalysis.error || "Expanded URDF is invalid.");
  }
  if (!hasRenderableUrdfGeometry(urdfText)) {
    throw new Error(
      "Selected URDF/Xacro expands to no renderable geometry. Pick a top-level robot model file."
    );
  }
  
  // Extract mesh references from URDF
  const packageRoots = buildPackageRootsFromFiles(resolvedFiles);
  const { matches } = resolveGitHubMeshReferences(activeUrdfPath, urdfText, resolvedFiles, packageRoots);
  const matchedFiles = matches.filter((file) => file.type === "file");
  const referencedPackages = collectMeshReferencedPackageNamesFromUrdf(urdfText);
  const packageXmlFiles = referencedPackages
    .map((name) => findPackageXmlForName(resolvedFiles, name))
    .filter((file): file is GitHubFile => Boolean(file));

  // Add URDF file to FileList
  // Use full repository path as webkitRelativePath for consistency
  const urdfFileObj = new File(
    [urdfContent],
    resolvedFromXacro
      ? normalizeExpandedUrdfPath(activeUrdfPath.split("/").pop() || urdfFile.name)
      : urdfFile.name,
    { type: urdfMimeType }
  );
  Object.defineProperty(urdfFileObj, "webkitRelativePath", {
    value: urdfRelativePath,
    writable: false,
    enumerable: true,
    configurable: false,
  });
  dataTransfer.items.add(urdfFileObj);

  const meshFiles = await fetchGitHubFilesAsFileObjects(
    resolvedFiles,
    owner,
    repo,
    accessToken,
    Array.from(
      new Map(
        [...matchedFiles, ...packageXmlFiles].map((file) => [file.path, file])
      ).values()
    )
  );

  meshFiles.forEach((fileObj) => {
    dataTransfer.items.add(fileObj);
  });

  if (additionalUrdfPaths.length > 0) {
    const normalizedPrimaryPath = normalizeMeshPathForMatch(activeUrdfPath) || activeUrdfPath;
    const repositoryFileMap = new Map<string, GitHubFile>();
    resolvedFiles.forEach((file) => {
      if (file.type !== "file") return;
      const normalizedPath = normalizeMeshPathForMatch(file.path) || file.path;
      repositoryFileMap.set(normalizedPath, file);
    });

    const additionalUrdfFilesToFetch = additionalUrdfPaths
      .filter((path) => path !== normalizedPrimaryPath)
      .map((path) => repositoryFileMap.get(path))
      .filter((file): file is GitHubFile => Boolean(file))
      .filter((file) => file.path.toLowerCase().endsWith(".urdf"));

    if (additionalUrdfFilesToFetch.length > 0) {
      const additionalUrdfFiles = await fetchGitHubFilesAsFileObjects(
        resolvedFiles,
        owner,
        repo,
        accessToken,
        additionalUrdfFilesToFetch
      );
      additionalUrdfFiles.forEach((fileObj) => {
        dataTransfer.items.add(fileObj);
      });
    }
  }

  return dataTransfer.files;
}

/**
 * Check if a file exists in GitHub repository
 */
export async function checkFileExists(
  owner: string,
  repo: string,
  path: string,
  accessToken: string
): Promise<{ exists: boolean; sha?: string }> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github.v3+json",
    Authorization: `token ${accessToken}`,
  };

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const response = await fetch(url, { headers });

  if (response.status === 404) {
    return { exists: false };
  }

  if (!response.ok) {
    // If it's not 404, it might be a different error, but we'll assume it doesn't exist
    return { exists: false };
  }

  const data = await response.json();
  // If it's an array, it means it's a directory, not a file
  if (Array.isArray(data)) {
    return { exists: false };
  }

  return { exists: true, sha: data.sha };
}

/**
 * Check if assets folder exists (by checking if any file in assets/ exists)
 */
export async function checkAssetsFolderExists(
  owner: string,
  repo: string,
  accessToken: string
): Promise<boolean> {
  try {
    const headers: HeadersInit = {
      Accept: "application/vnd.github.v3+json",
      Authorization: `token ${accessToken}`,
    };

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/assets`;
    const response = await fetch(url, { headers });

    if (response.status === 404) {
      return false;
    }

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    // If it's an array, it's a directory with files
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Generate commit message with urdf-studio prefix and timestamp
 */
export function generateCommitMessage(customMessage?: string): string {
  const timestamp = new Date().toISOString();
  const baseMessage = customMessage || "Update URDF and mesh files";
  return `urdf-studio: ${baseMessage} (${timestamp})`;
}

/**
 * Upload a file to GitHub repository using Contents API
 * If sha is provided, it will overwrite the existing file
 */
export async function uploadFileToGitHub(
  owner: string,
  repo: string,
  path: string,
  content: string | ArrayBuffer,
  message: string,
  accessToken: string,
  existingSha?: string
): Promise<void> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github.v3+json",
    Authorization: `token ${accessToken}`,
    "Content-Type": "application/json",
  };

  // Convert content to base64 if it's not already
  let base64Content: string;
  if (typeof content === "string") {
    base64Content = btoa(unescape(encodeURIComponent(content)));
  } else {
    const bytes = new Uint8Array(content);
    const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join("");
    base64Content = btoa(binary);
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const body: { message: string; content: string; sha?: string } = {
    message,
    content: base64Content,
  };

  // Include SHA if provided (for overwriting existing files)
  if (existingSha) {
    body.sha = existingSha;
  }

  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    if (response.status === 409) {
      throw new Error(`File already exists at ${path}. Please delete it first or use a different path.`);
    }
    throw new Error(`Failed to upload file ${path}: ${response.statusText}${errorText ? ` - ${errorText.substring(0, 200)}` : ''}`);
  }
}

/**
 * Update URDF mesh paths to point to assets/ folder
 * Preserves the original file extension
 */
export function updateURDFMeshPathsToAssets(urdfContent: string): string {
  const result = updateMeshPathsToAssetsInUrdf(urdfContent);
  return result.success ? result.content : urdfContent;
}
