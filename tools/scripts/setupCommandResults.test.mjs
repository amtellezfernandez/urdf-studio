import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOptionalRuntimeInstallFailure,
  buildSetupResult,
  didSetupStepChange,
  didSpawnSyncFail,
  isSetupStepReady,
  printCapturedCommandOutput,
  shouldFailSetupForRuntimeResult,
} from './setupCommandResults.js';

test('setup result helpers preserve defaults and readiness semantics', () => {
  assert.deepEqual(buildSetupResult({ installed: true }), {
    ok: true,
    changed: false,
    installed: true,
  });
  assert.equal(isSetupStepReady(false), false);
  assert.equal(isSetupStepReady({ ok: false }), false);
  assert.equal(isSetupStepReady({ ok: true }), true);
  assert.equal(didSetupStepChange({ changed: true }), true);
});

test('spawn result helper treats successful exit as success despite stale error metadata', () => {
  assert.equal(
    didSpawnSyncFail({
      status: 0,
      signal: null,
      error: new Error('spawnSync cargo EPERM'),
    }),
    false
  );
  assert.equal(didSpawnSyncFail({ status: 1, signal: null }), true);
  assert.equal(didSpawnSyncFail({ status: null, signal: null, error: new Error('EPERM') }), true);
  assert.equal(didSpawnSyncFail({ status: 0, signal: 'SIGTERM' }), true);
});

test('captured command output writes stdout and stderr streams separately', () => {
  const stdoutWrites = [];
  const stderrWrites = [];

  printCapturedCommandOutput(
    { stdout: 'out', stderr: 'err' },
    {
      stdout: { write: (value) => stdoutWrites.push(value) },
      stderr: { write: (value) => stderrWrites.push(value) },
    }
  );

  assert.deepEqual(stdoutWrites, ['out']);
  assert.deepEqual(stderrWrites, ['err']);
});

test('optional runtime failure carries fatality from force env', () => {
  assert.deepEqual(
    buildOptionalRuntimeInstallFailure({
      forceInstallEnv: 'FORCE_RUNTIME',
      env: { FORCE_RUNTIME: '1' },
      error: new Error('install failed'),
    }),
    {
      ok: false,
      installed: false,
      skipped: false,
      fatal: true,
      error: 'install failed',
    }
  );
  assert.equal(shouldFailSetupForRuntimeResult({ ok: false, fatal: false }), false);
  assert.equal(shouldFailSetupForRuntimeResult({ ok: false, fatal: true }), true);
});
