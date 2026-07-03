import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  getAppConfigPath,
  getSetupConfigPath,
  loadAppConfig,
  loadSetupConfig,
  saveSetupConfig,
  setupGitHub,
  setupHuggingFace,
  shouldOfferTokenSetup,
} from './setupAuthConfig.js';

function silentAuthOptions(overrides = {}) {
  return {
    rootDir: '/repo',
    colors: {},
    log: () => {},
    logArrow: () => {},
    logInfo: () => {},
    logSuccess: () => {},
    logUrl: () => {},
    shouldOfferTokenSetupImpl: () => true,
    isInteractiveImpl: () => true,
    importInquirer: async () => ({
      default: {
        prompt: async () => ({ token: '' }),
      },
    }),
    ...overrides,
  };
}

function queuedQuestion(answers) {
  const queue = [...answers];
  return async () => {
    if (queue.length === 0) {
      throw new Error('question queue exhausted');
    }
    return queue.shift();
  };
}

test('setup config paths are rooted in the checkout', () => {
  assert.equal(getSetupConfigPath('/repo'), join('/repo', '.urdf-studio-config.json'));
  assert.equal(getAppConfigPath('/repo'), join('/repo', 'config', 'app.config.json'));
});

test('JSON config loading tolerates missing and malformed files', () => {
  assert.deepEqual(loadSetupConfig('/repo', { existsSyncImpl: () => false }), {});
  assert.deepEqual(
    loadAppConfig('/repo', {
      existsSyncImpl: () => true,
      readFileSyncImpl: () => '{not json',
    }),
    {}
  );
  assert.deepEqual(
    loadAppConfig('/repo', {
      existsSyncImpl: () => true,
      readFileSyncImpl: () => '{"ikd":{"enabled":true}}',
    }),
    { ikd: { enabled: true } }
  );
});

test('setup config saving writes stable pretty JSON', () => {
  let writeCall = null;

  saveSetupConfig(
    '/repo',
    { githubToken: 'github_pat_test' },
    {
      writeFileSyncImpl: (path, content, encoding) => {
        writeCall = { path, content, encoding };
      },
    }
  );

  assert.deepEqual(writeCall, {
    path: join('/repo', '.urdf-studio-config.json'),
    content: '{\n  "githubToken": "github_pat_test"\n}',
    encoding: 'utf-8',
  });
});

test('token setup opt-in honors skip, flags, and environment', () => {
  assert.equal(shouldOfferTokenSetup({ env: { URDF_STUDIO_SKIP_TOKENS: '1' }, argv: ['node', 'setup'] }), false);
  assert.equal(shouldOfferTokenSetup({ env: {}, argv: ['node', 'setup', '--auth'] }), true);
  assert.equal(shouldOfferTokenSetup({ env: {}, argv: ['node', 'setup', '--tokens'] }), true);
  assert.equal(shouldOfferTokenSetup({ env: { URDF_STUDIO_SETUP_TOKENS: 'yes' }, argv: ['node', 'setup'] }), true);
  assert.equal(shouldOfferTokenSetup({ env: {}, argv: ['node', 'setup'] }), false);
});

test('Hugging Face setup is skipped outside interactive opt-in', async () => {
  const result = await setupHuggingFace(silentAuthOptions({
    shouldOfferTokenSetupImpl: () => false,
    question: async () => {
      throw new Error('question should not run');
    },
  }));

  assert.deepEqual(result, { ok: true, changed: false });
});

test('Hugging Face setup removes an existing token', async () => {
  let savedConfig = null;
  const result = await setupHuggingFace(silentAuthOptions({
    loadConfig: () => ({ huggingfaceToken: 'hf_existing' }),
    saveConfig: (config) => {
      savedConfig = config;
    },
    question: queuedQuestion(['yes', 'remove']),
  }));

  assert.deepEqual(result, { ok: true, changed: true });
  assert.deepEqual(savedConfig, {});
});

test('Hugging Face setup saves a trimmed token from the hidden prompt', async () => {
  let savedConfig = null;
  const result = await setupHuggingFace(silentAuthOptions({
    loadConfig: () => ({}),
    saveConfig: (config) => {
      savedConfig = config;
    },
    question: queuedQuestion(['y']),
    importInquirer: async () => ({
      default: {
        prompt: async () => ({ token: '  hf_new  ' }),
      },
    }),
  }));

  assert.deepEqual(result, { ok: true, changed: true });
  assert.deepEqual(savedConfig, { huggingfaceToken: 'hf_new' });
});

test('GitHub setup reuses detected access without saving by default', async () => {
  let saved = false;
  const result = await setupGitHub(silentAuthOptions({
    loadConfig: () => ({}),
    saveConfig: () => {
      saved = true;
    },
    question: queuedQuestion(['yes', '']),
    resolveSetupGitHubTokenImpl: () => ({
      source: 'gh auth token',
      token: 'github_pat_detected',
    }),
  }));

  assert.deepEqual(result, { ok: true, changed: false });
  assert.equal(saved, false);
});

test('GitHub setup can save detected access locally', async () => {
  let savedConfig = null;
  const result = await setupGitHub(silentAuthOptions({
    loadConfig: () => ({}),
    saveConfig: (config) => {
      savedConfig = config;
    },
    question: queuedQuestion(['yes', 'save']),
    resolveSetupGitHubTokenImpl: () => ({
      source: 'GH_TOKEN',
      token: 'github_pat_detected',
    }),
  }));

  assert.deepEqual(result, { ok: true, changed: true });
  assert.deepEqual(savedConfig, { githubToken: 'github_pat_detected' });
});

test('GitHub setup can fall back to manual token entry', async () => {
  let savedConfig = null;
  const result = await setupGitHub(silentAuthOptions({
    loadConfig: () => ({}),
    saveConfig: (config) => {
      savedConfig = config;
    },
    question: queuedQuestion(['yes', 'manual']),
    resolveSetupGitHubTokenImpl: () => ({
      source: 'GH_TOKEN',
      token: 'github_pat_detected',
    }),
    importInquirer: async () => ({
      default: {
        prompt: async () => ({ token: '  github_pat_manual  ' }),
      },
    }),
  }));

  assert.deepEqual(result, { ok: true, changed: true });
  assert.deepEqual(savedConfig, { githubToken: 'github_pat_manual' });
});
