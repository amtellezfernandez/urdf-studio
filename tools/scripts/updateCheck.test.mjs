import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOutdatedVersionMessage,
  formatOfficialVersionStatusMessage,
  parseGitHubRepositorySlug,
  parseTrackedDefaultBranch,
  resolveOfficialVersionStatus,
  shouldBypassOutdatedVersionGate,
  shouldEnforceOutdatedVersionGate,
  VERSION_CHECK_STATES,
} from './updateCheck.js';

const TEST_CWD = '/tmp/urdf-studio';
const CURRENT_SHA = '1111111111111111111111111111111111111111';
const LATEST_SHA = '2222222222222222222222222222222222222222';

function buildRunGitCommandStub() {
  return (args) => {
    const command = args.join(' ');
    if (command === 'rev-parse HEAD') {
      return CURRENT_SHA;
    }
    if (command === 'rev-parse --abbrev-ref HEAD') {
      return 'main';
    }
    if (command === 'config --get remote.origin.url') {
      return 'git@github.com:amtellezfernandez/urdf-studio.git';
    }
    if (command === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') {
      return 'origin/main';
    }
    throw new Error(`Unexpected git command: ${command}`);
  };
}

test('parseGitHubRepositorySlug supports ssh and https github remotes', () => {
  assert.equal(
    parseGitHubRepositorySlug('git@github.com:amtellezfernandez/urdf-studio.git'),
    'amtellezfernandez/urdf-studio'
  );
  assert.equal(
    parseGitHubRepositorySlug('https://github.com/amtellezfernandez/urdf-studio.git'),
    'amtellezfernandez/urdf-studio'
  );
  assert.equal(parseGitHubRepositorySlug('https://example.com/amtellezfernandez/urdf-studio'), null);
});

test('parseTrackedDefaultBranch falls back safely', () => {
  assert.equal(parseTrackedDefaultBranch('origin/main'), 'main');
  assert.equal(parseTrackedDefaultBranch(''), 'main');
});

test('resolveOfficialVersionStatus reports outdated checkout from official compare API', async () => {
  const cacheWrites = [];
  const requestHeaders = [];
  const result = await resolveOfficialVersionStatus({
    cwd: TEST_CWD,
    env: {},
    githubToken: 'gho_test_token',
    fetchImpl: async (_url, init) => {
      requestHeaders.push(init.headers);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            status: 'behind',
            ahead_by: 0,
            behind_by: 3,
            base_commit: { sha: LATEST_SHA },
          };
        },
      };
    },
    runGitCommandImpl: buildRunGitCommandStub(),
    loadCacheImpl: () => null,
    saveCacheImpl(_cachePath, entry) {
      cacheWrites.push(entry);
    },
  });

  assert.deepEqual(result, {
    state: VERSION_CHECK_STATES.behind,
    currentSha: CURRENT_SHA,
    currentBranch: 'main',
    defaultBranch: 'main',
    latestSha: LATEST_SHA,
    repoSlug: 'amtellezfernandez/urdf-studio',
    aheadBy: 0,
    behindBy: 3,
  });
  assert.equal(cacheWrites.length, 1);
  assert.equal(requestHeaders[0].Authorization, 'Bearer gho_test_token');
});

test('resolveOfficialVersionStatus reuses a fresh cache entry', async () => {
  let fetchCalls = 0;
  const cachedResult = {
    state: VERSION_CHECK_STATES.current,
    currentSha: CURRENT_SHA,
    currentBranch: 'main',
    defaultBranch: 'main',
    latestSha: CURRENT_SHA,
    repoSlug: 'amtellezfernandez/urdf-studio',
    aheadBy: 0,
    behindBy: 0,
  };

  const result = await resolveOfficialVersionStatus({
    cwd: TEST_CWD,
    env: {},
    nowMs: 50_000,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('fetch should not be called when cache is fresh');
    },
    runGitCommandImpl: buildRunGitCommandStub(),
    loadCacheImpl: () => ({
      version: 1,
      cacheKey: 'amtellezfernandez/urdf-studio:main:1111111111111111111111111111111111111111',
      checkedAtMs: 49_000,
      result: cachedResult,
    }),
    saveCacheImpl() {
      throw new Error('saveCache should not be called for a fresh cache hit');
    },
  });

  assert.equal(fetchCalls, 0);
  assert.deepEqual(result, cachedResult);
});

test('resolveOfficialVersionStatus prefers git remote ancestry when available', async () => {
  const calls = [];
  const result = await resolveOfficialVersionStatus({
    cwd: TEST_CWD,
    env: {},
    fetchImpl: async () => {
      throw new Error('fetch should not run when git remote ancestry succeeds');
    },
    runGitCommandImpl(args) {
      const command = args.join(' ');
      calls.push(command);
      if (command === 'rev-parse HEAD') return CURRENT_SHA;
      if (command === 'rev-parse --abbrev-ref HEAD') return 'main';
      if (command === 'config --get remote.origin.url') {
        return 'git@github.com:amtellezfernandez/urdf-studio.git';
      }
      if (command === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') {
        return 'origin/main';
      }
      if (command === 'fetch --quiet --no-tags origin main') return '';
      if (command === 'rev-parse FETCH_HEAD') return LATEST_SHA;
      if (command === 'rev-list --left-right --count FETCH_HEAD...HEAD') return '2\t0';
      throw new Error(`Unexpected git command: ${command}`);
    },
    loadCacheImpl: () => null,
    saveCacheImpl() {},
  });

  assert.equal(calls.includes('fetch --quiet --no-tags origin main'), true);
  assert.equal(result.state, VERSION_CHECK_STATES.behind);
  assert.equal(result.behindBy, 2);
});

test('resolveOfficialVersionStatus treats 404 compare results as custom checkouts', async () => {
  const result = await resolveOfficialVersionStatus({
    cwd: TEST_CWD,
    env: {},
    fetchImpl: async () => ({
      ok: false,
      status: 404,
    }),
    runGitCommandImpl: buildRunGitCommandStub(),
    loadCacheImpl: () => null,
    saveCacheImpl() {},
  });

  assert.equal(result.state, VERSION_CHECK_STATES.custom);
  assert.equal(result.repoSlug, 'amtellezfernandez/urdf-studio');
});

test('resolveOfficialVersionStatus honors explicit skip env', async () => {
  let fetchCalls = 0;
  const result = await resolveOfficialVersionStatus({
    cwd: TEST_CWD,
    env: { URDF_STUDIO_SKIP_UPDATE_CHECK: '1' },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('fetch should not be called when skip env is set');
    },
    runGitCommandImpl: buildRunGitCommandStub(),
  });

  assert.equal(fetchCalls, 0);
  assert.equal(result.state, VERSION_CHECK_STATES.skipped);
});

test('outdated version helpers format enforcement messages and bypass env', () => {
  const result = {
    state: VERSION_CHECK_STATES.behind,
    currentSha: CURRENT_SHA,
    latestSha: LATEST_SHA,
    defaultBranch: 'main',
    repoSlug: 'amtellezfernandez/urdf-studio',
    aheadBy: 0,
    behindBy: 2,
  };

  assert.match(buildOutdatedVersionMessage(result), /git pull --ff-only origin main/);
  assert.equal(
    shouldBypassOutdatedVersionGate({
      allowOutdated: false,
      env: { URDF_STUDIO_ALLOW_OUTDATED: 'yes' },
    }),
    true
  );
  assert.equal(
    shouldEnforceOutdatedVersionGate(result, {
      allowOutdated: false,
      env: {},
    }),
    true
  );
  assert.equal(
    shouldEnforceOutdatedVersionGate(
      {
        ...result,
        currentBranch: 'hkhack',
      },
      {
        allowOutdated: false,
        env: {},
      }
    ),
    false
  );
  assert.match(
    formatOfficialVersionStatusMessage({
      state: VERSION_CHECK_STATES.current,
      currentSha: CURRENT_SHA,
      repoSlug: 'amtellezfernandez/urdf-studio',
      defaultBranch: 'main',
    }),
    /Official version check: current/
  );
});
