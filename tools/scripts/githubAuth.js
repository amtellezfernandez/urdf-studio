#!/usr/bin/env node

import { spawnSync } from 'child_process';

const GITHUB_CLI_TIMEOUT_MS = 2_000;

function normalizeToken(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

function resolveTokenFromCandidates(candidates) {
  for (const candidate of candidates) {
    const token = normalizeToken(candidate.value);
    if (token) {
      return { token, source: candidate.source };
    }
  }
  return { token: null, source: null };
}

function readGitHubCliCommand(args, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: GITHUB_CLI_TIMEOUT_MS,
  });
  if (result.error || result.status !== 0) {
    return undefined;
  }
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function resolveGitHubToken({ candidates, spawnSyncImpl }) {
  const resolved = resolveTokenFromCandidates(candidates);
  if (resolved.token) {
    return resolved;
  }
  return readGitHubCliToken({ spawnSyncImpl });
}

export function maskToken(token) {
  const normalized = normalizeToken(token);
  if (!normalized) return '';
  if (normalized.length <= 10) {
    return `${normalized.slice(0, 3)}...${normalized.slice(-1)}`;
  }
  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}

export function extractGitHubCliToken(output) {
  const normalized = normalizeToken(output);
  if (!normalized) return null;

  const tokenLine = normalized.match(/Token:\s*(\S+)/i);
  if (tokenLine?.[1]) {
    return tokenLine[1];
  }

  if (!normalized.includes('\n') && !normalized.includes('\r') && !normalized.toLowerCase().includes('logged in')) {
    return normalized;
  }

  return null;
}

export function readGitHubCliToken({ spawnSyncImpl = spawnSync } = {}) {
  const directOutput = readGitHubCliCommand(['auth', 'token'], spawnSyncImpl);
  const directToken = extractGitHubCliToken(directOutput);
  if (directToken) {
    return { token: directToken, source: 'gh auth token' };
  }

  const statusOutput = readGitHubCliCommand(['auth', 'status', '--show-token'], spawnSyncImpl);
  const statusToken = extractGitHubCliToken(statusOutput);
  if (statusToken) {
    return { token: statusToken, source: 'gh auth status --show-token' };
  }

  return { token: null, source: null };
}

export function resolveFrontendGitHubToken({
  configToken,
  env = process.env,
  spawnSyncImpl = spawnSync,
} = {}) {
  return resolveGitHubToken({
    candidates: [
      { source: 'VITE_GITHUB_TOKEN', value: env.VITE_GITHUB_TOKEN },
      { source: 'GITHUB_TOKEN', value: env.GITHUB_TOKEN },
      { source: 'GH_TOKEN', value: env.GH_TOKEN },
      { source: 'saved config', value: configToken },
    ],
    spawnSyncImpl,
  });
}

export function resolveBackendGitHubToken({
  configToken,
  env = process.env,
  spawnSyncImpl = spawnSync,
} = {}) {
  return resolveGitHubToken({
    candidates: [
      { source: 'URDF_GITHUB_TOKEN', value: env.URDF_GITHUB_TOKEN },
      { source: 'GITHUB_TOKEN', value: env.GITHUB_TOKEN },
      { source: 'GH_TOKEN', value: env.GH_TOKEN },
      { source: 'saved config', value: configToken },
    ],
    spawnSyncImpl,
  });
}

export function resolveSetupGitHubToken({ env = process.env, spawnSyncImpl = spawnSync } = {}) {
  return resolveGitHubToken({
    candidates: [
      { source: 'GITHUB_TOKEN', value: env.GITHUB_TOKEN },
      { source: 'GH_TOKEN', value: env.GH_TOKEN },
    ],
    spawnSyncImpl,
  });
}
