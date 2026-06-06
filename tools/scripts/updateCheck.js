import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { isTruthyEnvValue } from './runConfig.js';
import {
  RUN_OPTION_FLAGS,
  RUN_UPDATE_CHECK_API_BASE_URL,
  RUN_UPDATE_CHECK_CACHE_FILE,
  RUN_UPDATE_CHECK_CACHE_TTL_MS,
  RUN_UPDATE_CHECK_CACHE_VERSION,
  RUN_UPDATE_CHECK_DEFAULT_BRANCH,
  RUN_UPDATE_CHECK_ENV_KEYS,
  RUN_UPDATE_CHECK_GIT_REMOTE_HEAD_REF,
  RUN_UPDATE_CHECK_REMOTE_NAME,
  RUN_UPDATE_CHECK_TIMEOUT_MS,
} from './runParams.js';

export const VERSION_CHECK_STATES = {
  ahead: 'ahead',
  behind: 'behind',
  current: 'current',
  custom: 'custom',
  diverged: 'diverged',
  skipped: 'skipped',
  unavailable: 'unavailable',
};

const DETACHED_HEAD_BRANCH_NAME = 'HEAD';

function runGitCommand(args, { cwd, timeoutMs = RUN_UPDATE_CHECK_TIMEOUT_MS, execFileSyncImpl = execFileSync } = {}) {
  return execFileSyncImpl('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  }).trim();
}

function getVersionCheckCachePath(cwd) {
  return join(cwd, RUN_UPDATE_CHECK_CACHE_FILE);
}

function loadVersionCheckCache(cachePath) {
  if (!existsSync(cachePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function saveVersionCheckCache(cachePath, entry) {
  writeFileSync(cachePath, JSON.stringify(entry, null, 2), 'utf8');
}

export function parseGitHubRepositorySlug(remoteUrl) {
  if (typeof remoteUrl !== 'string') {
    return null;
  }
  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return null;
  }

  const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  try {
    const parsedUrl = new URL(trimmed);
    if (parsedUrl.hostname.toLowerCase() !== 'github.com') {
      return null;
    }
    const segments = parsedUrl.pathname.replace(/^\/+/, '').replace(/\.git$/i, '').split('/');
    if (segments.length < 2 || !segments[0] || !segments[1]) {
      return null;
    }
    return `${segments[0]}/${segments[1]}`;
  } catch {
    return null;
  }
}

export function parseTrackedDefaultBranch(remoteHeadRef) {
  if (typeof remoteHeadRef !== 'string') {
    return RUN_UPDATE_CHECK_DEFAULT_BRANCH;
  }
  const trimmed = remoteHeadRef.trim();
  if (!trimmed) {
    return RUN_UPDATE_CHECK_DEFAULT_BRANCH;
  }
  const segments = trimmed.split('/');
  return segments[segments.length - 1] || RUN_UPDATE_CHECK_DEFAULT_BRANCH;
}

export function shouldBypassOutdatedVersionGate({ allowOutdated = false, env = process.env } = {}) {
  return allowOutdated || isTruthyEnvValue(env[RUN_UPDATE_CHECK_ENV_KEYS.allowOutdated]);
}

export function isNonDefaultBranchCheckout(result) {
  return Boolean(
    result &&
      typeof result.currentBranch === 'string' &&
      result.currentBranch.trim() &&
      result.currentBranch !== DETACHED_HEAD_BRANCH_NAME &&
      result.currentBranch !== result.defaultBranch
  );
}

export function shouldEnforceOutdatedVersionGate(
  result,
  { allowOutdated = false, env = process.env } = {}
) {
  if (
    !result ||
    (result.state !== VERSION_CHECK_STATES.behind &&
      result.state !== VERSION_CHECK_STATES.diverged)
  ) {
    return false;
  }
  if (shouldBypassOutdatedVersionGate({ allowOutdated, env })) {
    return false;
  }
  return !isNonDefaultBranchCheckout(result);
}

function shouldSkipUpdateCheck(env) {
  return isTruthyEnvValue(env[RUN_UPDATE_CHECK_ENV_KEYS.skip]);
}

function buildCompareApiUrl({ repoSlug, defaultBranch, currentSha }) {
  return `${RUN_UPDATE_CHECK_API_BASE_URL}/repos/${repoSlug}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(currentSha)}`;
}

function readLocalVersionMetadata({ cwd, runGitCommandImpl = runGitCommand } = {}) {
  const currentSha = runGitCommandImpl(['rev-parse', 'HEAD'], { cwd });
  let currentBranch = null;
  try {
    currentBranch = runGitCommandImpl(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  } catch {
    currentBranch = null;
  }
  const remoteUrl = runGitCommandImpl(
    ['config', '--get', `remote.${RUN_UPDATE_CHECK_REMOTE_NAME}.url`],
    { cwd }
  );
  let trackedDefaultBranch = RUN_UPDATE_CHECK_DEFAULT_BRANCH;
  try {
    trackedDefaultBranch = runGitCommandImpl(
      ['symbolic-ref', '--quiet', '--short', RUN_UPDATE_CHECK_GIT_REMOTE_HEAD_REF],
      { cwd }
    );
  } catch {
    trackedDefaultBranch = RUN_UPDATE_CHECK_DEFAULT_BRANCH;
  }
  const repoSlug = parseGitHubRepositorySlug(remoteUrl);
  return {
    currentSha,
    currentBranch,
    defaultBranch: parseTrackedDefaultBranch(trackedDefaultBranch),
    repoSlug,
  };
}

function isFreshCachedResult(cacheEntry, { cacheKey, nowMs }) {
  if (!cacheEntry || typeof cacheEntry !== 'object') {
    return false;
  }
  if (cacheEntry.version !== RUN_UPDATE_CHECK_CACHE_VERSION) {
    return false;
  }
  if (cacheEntry.cacheKey !== cacheKey) {
    return false;
  }
  if (!Number.isFinite(cacheEntry.checkedAtMs)) {
    return false;
  }
  return nowMs - cacheEntry.checkedAtMs <= RUN_UPDATE_CHECK_CACHE_TTL_MS;
}

function shortenSha(sha) {
  return typeof sha === 'string' && sha.length >= 7 ? sha.slice(0, 7) : sha || 'unknown';
}

function normalizeCompareResult(payload, { currentSha, currentBranch, defaultBranch, repoSlug }) {
  const latestSha = typeof payload?.base_commit?.sha === 'string' ? payload.base_commit.sha : null;
  const status = typeof payload?.status === 'string' ? payload.status.trim().toLowerCase() : '';
  const behindBy = Number.isInteger(payload?.behind_by) ? payload.behind_by : 0;
  const aheadBy = Number.isInteger(payload?.ahead_by) ? payload.ahead_by : 0;
  const base = {
    currentSha,
    currentBranch,
    defaultBranch,
    latestSha,
    repoSlug,
  };

  if (status === 'identical') {
    return { ...base, state: VERSION_CHECK_STATES.current, aheadBy: 0, behindBy: 0 };
  }
  if (status === 'behind') {
    return { ...base, state: VERSION_CHECK_STATES.behind, aheadBy, behindBy };
  }
  if (status === 'diverged') {
    return { ...base, state: VERSION_CHECK_STATES.diverged, aheadBy, behindBy };
  }
  if (status === 'ahead') {
    return { ...base, state: VERSION_CHECK_STATES.ahead, aheadBy, behindBy };
  }

  return {
    ...base,
    state: VERSION_CHECK_STATES.unavailable,
    aheadBy,
    behindBy,
    reason: `unsupported compare status: ${status || 'unknown'}`,
  };
}

function normalizeCustomCheckoutResult({ currentSha, currentBranch, defaultBranch, repoSlug }) {
  return {
    state: VERSION_CHECK_STATES.custom,
    currentSha,
    currentBranch,
    defaultBranch,
    latestSha: null,
    repoSlug,
    aheadBy: 0,
    behindBy: 0,
    reason: 'local commit is not published on the official remote branch',
  };
}

function formatGithubApiFailure(status) {
  if (status === 403) {
    return 'GitHub API rate limit or access policy blocked the official version check';
  }
  return `GitHub compare API returned HTTP ${status}`;
}

function parseLeftRightCount(output) {
  const match = String(output).trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) {
    throw new Error(`unexpected git rev-list count output: ${output}`);
  }
  return {
    leftOnly: Number.parseInt(match[1], 10),
    rightOnly: Number.parseInt(match[2], 10),
  };
}

function resolveStatusFromGitRemote({ cwd, currentSha, currentBranch, defaultBranch, repoSlug, runGitCommandImpl }) {
  runGitCommandImpl(
    ['fetch', '--quiet', '--no-tags', RUN_UPDATE_CHECK_REMOTE_NAME, defaultBranch],
    { cwd }
  );
  const latestSha = runGitCommandImpl(['rev-parse', 'FETCH_HEAD'], { cwd });
  const { leftOnly: remoteOnly, rightOnly: localOnly } = parseLeftRightCount(
    runGitCommandImpl(['rev-list', '--left-right', '--count', 'FETCH_HEAD...HEAD'], { cwd })
  );

  if (remoteOnly === 0 && localOnly === 0) {
    return {
      state: VERSION_CHECK_STATES.current,
      currentSha,
      currentBranch,
      defaultBranch,
      latestSha,
      repoSlug,
      aheadBy: 0,
      behindBy: 0,
    };
  }

  if (remoteOnly > 0 && localOnly === 0) {
    return {
      state: VERSION_CHECK_STATES.behind,
      currentSha,
      currentBranch,
      defaultBranch,
      latestSha,
      repoSlug,
      aheadBy: 0,
      behindBy: remoteOnly,
    };
  }

  if (remoteOnly === 0 && localOnly > 0) {
    return {
      state: VERSION_CHECK_STATES.ahead,
      currentSha,
      currentBranch,
      defaultBranch,
      latestSha,
      repoSlug,
      aheadBy: localOnly,
      behindBy: 0,
    };
  }

  return {
    state: VERSION_CHECK_STATES.diverged,
    currentSha,
    currentBranch,
    defaultBranch,
    latestSha,
    repoSlug,
    aheadBy: localOnly,
    behindBy: remoteOnly,
  };
}

export async function resolveOfficialVersionStatus({
  cwd,
  env = process.env,
  fetchImpl = fetch,
  githubToken = null,
  nowMs = Date.now(),
  runGitCommandImpl = runGitCommand,
  loadCacheImpl = loadVersionCheckCache,
  saveCacheImpl = saveVersionCheckCache,
} = {}) {
  if (shouldSkipUpdateCheck(env)) {
    return {
      state: VERSION_CHECK_STATES.skipped,
      reason: `${RUN_UPDATE_CHECK_ENV_KEYS.skip}=1 disabled the official version check`,
    };
  }

  let localVersionMetadata;
  try {
    localVersionMetadata = readLocalVersionMetadata({ cwd, runGitCommandImpl });
  } catch (error) {
    return {
      state: VERSION_CHECK_STATES.unavailable,
      reason: `git metadata unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!localVersionMetadata.repoSlug) {
    return {
      state: VERSION_CHECK_STATES.unavailable,
      reason: 'origin remote is not a supported github.com repository URL',
    };
  }

  const { currentSha, currentBranch, defaultBranch, repoSlug } = localVersionMetadata;
  const cacheKey = `${repoSlug}:${defaultBranch}:${currentSha}`;
  const cachePath = getVersionCheckCachePath(cwd);
  const cachedResult = loadCacheImpl(cachePath);
  if (isFreshCachedResult(cachedResult, { cacheKey, nowMs })) {
    return cachedResult.result;
  }

  let result;
  try {
    result = resolveStatusFromGitRemote({
      cwd,
      currentSha,
      currentBranch,
      defaultBranch,
      repoSlug,
      runGitCommandImpl,
    });
  } catch {
    result = null;
  }

  if (result) {
    try {
      saveCacheImpl(cachePath, {
        version: RUN_UPDATE_CHECK_CACHE_VERSION,
        cacheKey,
        checkedAtMs: nowMs,
        result,
      });
    } catch {
      // Cache persistence is best-effort only; startup gating should not fail on it.
    }
    return result;
  }

  let response;
  try {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': `urdf-studio/${currentSha}`,
    };
    if (typeof githubToken === 'string' && githubToken.trim().length > 0) {
      headers.Authorization = `Bearer ${githubToken.trim()}`;
    }
    response = await fetchImpl(buildCompareApiUrl({ repoSlug, defaultBranch, currentSha }), {
      headers,
      signal: AbortSignal.timeout(RUN_UPDATE_CHECK_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      state: VERSION_CHECK_STATES.unavailable,
      currentSha,
      currentBranch,
      defaultBranch,
      latestSha: null,
      repoSlug,
      aheadBy: 0,
      behindBy: 0,
      reason: `official version check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (response.status === 404) {
    result = normalizeCustomCheckoutResult({ currentSha, currentBranch, defaultBranch, repoSlug });
  } else if (!response.ok) {
    result = {
      state: VERSION_CHECK_STATES.unavailable,
      currentSha,
      currentBranch,
      defaultBranch,
      latestSha: null,
      repoSlug,
      aheadBy: 0,
      behindBy: 0,
      reason: formatGithubApiFailure(response.status),
    };
  } else {
    const payload = await response.json();
    result = normalizeCompareResult(payload, { currentSha, currentBranch, defaultBranch, repoSlug });
  }

  if (result.state !== VERSION_CHECK_STATES.unavailable) {
    try {
      saveCacheImpl(cachePath, {
        version: RUN_UPDATE_CHECK_CACHE_VERSION,
        cacheKey,
        checkedAtMs: nowMs,
        result,
      });
    } catch {
      // Cache persistence is best-effort only; startup gating should not fail on it.
    }
  }

  return result;
}

export function formatOfficialVersionStatusMessage(result) {
  if (!result || typeof result !== 'object') {
    return 'Official version check unavailable.';
  }

  if (result.state === VERSION_CHECK_STATES.current) {
    return `Official version check: current (${shortenSha(result.currentSha)} on ${result.repoSlug}#${result.defaultBranch})`;
  }

  if (result.state === VERSION_CHECK_STATES.custom) {
    return `Official version check: custom checkout detected (${shortenSha(result.currentSha)} is not published on ${result.repoSlug}#${result.defaultBranch})`;
  }

  if (result.state === VERSION_CHECK_STATES.ahead) {
    return `Official version check: local checkout is ahead/custom relative to ${result.repoSlug}#${result.defaultBranch}`;
  }

  if (result.state === VERSION_CHECK_STATES.behind) {
    return `Official version check: checkout is behind ${result.repoSlug}#${result.defaultBranch} by ${result.behindBy} commit(s)`;
  }

  if (result.state === VERSION_CHECK_STATES.diverged) {
    return `Official version check: checkout diverged from ${result.repoSlug}#${result.defaultBranch} (ahead ${result.aheadBy}, behind ${result.behindBy})`;
  }

  if (result.state === VERSION_CHECK_STATES.skipped) {
    return `Official version check skipped: ${result.reason}`;
  }

  return `Official version check unavailable: ${result.reason || 'unknown reason'}`;
}

export function buildOutdatedVersionMessage(result) {
  const repoDisplay = `${result.repoSlug}#${result.defaultBranch}`;
  const lines = [];

  if (result.state === VERSION_CHECK_STATES.behind) {
    lines.push(
      `This URDF Studio checkout is behind the official ${repoDisplay} by ${result.behindBy} commit(s).`
    );
  } else if (result.state === VERSION_CHECK_STATES.diverged) {
    lines.push(
      `This URDF Studio checkout diverged from the official ${repoDisplay} (ahead ${result.aheadBy}, behind ${result.behindBy}).`
    );
  } else {
    lines.push(`This URDF Studio checkout is not current for ${repoDisplay}.`);
  }

  lines.push(`Current: ${shortenSha(result.currentSha)}`);
  if (result.latestSha) {
    lines.push(`Latest: ${shortenSha(result.latestSha)}`);
  }
  lines.push('Update before running:');
  lines.push(`  git pull --ff-only ${RUN_UPDATE_CHECK_REMOTE_NAME} ${result.defaultBranch}`);
  lines.push('  npm run setup');
  lines.push(
    `If you intentionally need this older checkout, rerun with ${RUN_OPTION_FLAGS.allowOutdated} or ${RUN_UPDATE_CHECK_ENV_KEYS.allowOutdated}=1.`
  );
  return lines.join('\n');
}
