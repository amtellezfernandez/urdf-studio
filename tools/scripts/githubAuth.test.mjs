import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractGitHubCliToken,
  resolveBackendGitHubToken,
  resolveFrontendGitHubToken,
  resolveSetupGitHubToken,
} from './githubAuth.js';

test('extractGitHubCliToken returns direct gh auth token output', () => {
  assert.equal(extractGitHubCliToken('gho_direct_token\n'), 'gho_direct_token');
});

test('extractGitHubCliToken returns token from gh auth status output', () => {
  const output = [
    'github.com',
    '  ✓ Logged in to github.com as example (/tmp/hosts.yml)',
    '  ✓ Token: gho_status_token',
  ].join('\n');
  assert.equal(extractGitHubCliToken(output), 'gho_status_token');
});

test('resolveFrontendGitHubToken prioritizes shared env before saved config', () => {
  const resolved = resolveFrontendGitHubToken({
    configToken: 'config_token',
    env: {
      VITE_GITHUB_TOKEN: '   ',
      GITHUB_TOKEN: 'env_token',
      GH_TOKEN: 'gh_env_token',
    },
    spawnSyncImpl() {
      throw new Error('gh should not be queried when env already has a token');
    },
  });

  assert.deepEqual(resolved, {
    token: 'env_token',
    source: 'GITHUB_TOKEN',
  });
});

test('resolveBackendGitHubToken prefers URDF_GITHUB_TOKEN', () => {
  const resolved = resolveBackendGitHubToken({
    configToken: 'config_token',
    env: {
      URDF_GITHUB_TOKEN: 'backend_token',
      GITHUB_TOKEN: 'env_token',
    },
    spawnSyncImpl() {
      throw new Error('gh should not be queried when env already has a token');
    },
  });

  assert.deepEqual(resolved, {
    token: 'backend_token',
    source: 'URDF_GITHUB_TOKEN',
  });
});

test('resolveSetupGitHubToken falls back to gh auth status stderr for older gh versions', () => {
  const calls = [];
  const resolved = resolveSetupGitHubToken({
    env: {},
    spawnSyncImpl(_command, args) {
      calls.push(args.join(' '));
      if (args[0] === 'auth' && args[1] === 'token') {
        return { status: 1, stdout: 'unsupported command', stderr: '', error: null };
      }
      return {
        status: 0,
        stdout: '',
        stderr: [
          'github.com',
          '  ✓ Logged in to github.com as example (/tmp/hosts.yml)',
          '  ✓ Token: gho_status_token',
        ].join('\n'),
        error: null,
      };
    },
  });

  assert.deepEqual(resolved, {
    token: 'gho_status_token',
    source: 'gh auth status --show-token',
  });
  assert.deepEqual(calls, ['auth token', 'auth status --show-token']);
});
