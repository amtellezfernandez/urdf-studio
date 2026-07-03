import test from 'node:test';
import assert from 'node:assert/strict';

import { detectOfficialIsaacSimCompatibilityChecker } from './simulatorIsaacSimChecker.js';

test('Isaac Sim checker can be explicitly skipped', () => {
  const checker = detectOfficialIsaacSimCompatibilityChecker({
    env: { URDF_STUDIO_SKIP_ISAACSIM_COMPATIBILITY_CHECKER: '1' },
    spawnSyncImpl: () => {
      throw new Error('checker should not execute');
    },
  });

  assert.equal(checker, null);
});

test('Isaac Sim checker uses configured command as required probe', () => {
  const calls = [];
  const checker = detectOfficialIsaacSimCompatibilityChecker({
    env: { URDF_STUDIO_ISAACSIM_COMPATIBILITY_CHECKER: 'custom-checker --no-window' },
    platform: 'linux',
    spawnSyncImpl: (command, args, options) => {
      calls.push({ command, args, timeout: options.timeout });
      return {
        status: 1,
        stdout: 'Compatibility Checker\nGPU driver check failed\n',
        stderr: '',
      };
    },
    existsSyncImpl: () => false,
  });

  assert.equal(checker.available, true);
  assert.equal(checker.ok, false);
  assert.equal(checker.source, 'configured command');
  assert.equal(checker.command, 'custom-checker --no-window');
  assert.match(checker.summary, /GPU driver check failed/);
  assert.deepEqual(calls, [
    {
      command: 'custom-checker',
      args: ['--no-window'],
      timeout: 90_000,
    },
  ]);
});

test('Isaac Sim checker detects workstation script from configured root', () => {
  const checker = detectOfficialIsaacSimCompatibilityChecker({
    env: { ISAAC_SIM_ROOT: '/opt/isaac-sim' },
    platform: 'linux',
    existsSyncImpl: (path) => path === '/opt/isaac-sim/isaac-sim.compatibility_check.sh',
    spawnSyncImpl: () => ({
      status: 0,
      stdout: 'All checks passed\n0 failed\n',
      stderr: '',
    }),
  });

  assert.equal(checker.ok, true);
  assert.equal(checker.source, 'Isaac Sim workstation script');
  assert.match(checker.command, /^\/opt\/isaac-sim\/isaac-sim\.compatibility_check\.sh/);
});

test('Isaac Sim checker returns null when only optional probes are unavailable', () => {
  const checker = detectOfficialIsaacSimCompatibilityChecker({
    env: {},
    platform: 'linux',
    existsSyncImpl: () => false,
    spawnSyncImpl: () => ({
      status: null,
      stdout: '',
      stderr: 'not found',
      error: { message: 'ENOENT' },
    }),
  });

  assert.equal(checker, null);
});
