import test from 'node:test';
import assert from 'node:assert/strict';

import {
  installOptionalPythonRuntime,
  shouldInstallOptionalPythonRuntime,
} from './setupOptionalPythonRuntime.js';
import {
  PYBULLET_FORCE_INSTALL_ENV,
  PYBULLET_SKIP_AUTO_INSTALL_ENV,
} from './setupParams.js';

function quietRuntimeOptions(overrides = {}) {
  return {
    rootDir: '/repo',
    env: {},
    platform: 'linux',
    getManagedPythonPath: () => '/repo/.venv/bin/python3',
    findUvImpl: () => '/usr/bin/uv',
    existsSyncImpl: () => true,
    getUvEnv: () => ({ UV_CACHE_DIR: '/repo/.uv-cache' }),
    logArrow: () => {},
    logInfo: () => {},
    logSuccess: () => {},
    logWarning: () => {},
    ...overrides,
  };
}

function pybulletRuntimeSpec(overrides = {}) {
  return {
    shouldInstall: () => true,
    displayName: 'PyBullet workspace adapter runtime',
    setupName: 'PyBullet',
    simulatorId: 'pybullet',
    dependencies: ['pybullet'],
    verifyImportScript: 'import pybullet',
    forceInstallEnv: PYBULLET_FORCE_INSTALL_ENV,
    ...overrides,
  };
}

test('optional Python runtime install policy respects skip and force env vars', () => {
  assert.equal(
    shouldInstallOptionalPythonRuntime({
      skipAutoInstallEnv: PYBULLET_SKIP_AUTO_INSTALL_ENV,
      forceInstallEnv: PYBULLET_FORCE_INSTALL_ENV,
      defaultInstall: true,
      env: { [PYBULLET_SKIP_AUTO_INSTALL_ENV]: '1' },
    }),
    false
  );
  assert.equal(
    shouldInstallOptionalPythonRuntime({
      skipAutoInstallEnv: PYBULLET_SKIP_AUTO_INSTALL_ENV,
      forceInstallEnv: PYBULLET_FORCE_INSTALL_ENV,
      defaultInstall: false,
      env: { [PYBULLET_FORCE_INSTALL_ENV]: '1' },
    }),
    true
  );
});

test('optional Python runtime returns skipped when policy declines install', async () => {
  const result = await installOptionalPythonRuntime(
    pybulletRuntimeSpec({ shouldInstall: () => false }),
    quietRuntimeOptions()
  );

  assert.deepEqual(result, {
    ok: true,
    changed: false,
    installed: false,
    skipped: true,
  });
});

test('optional Python runtime returns ready when import verification already passes', async () => {
  let execCalled = false;
  const result = await installOptionalPythonRuntime(pybulletRuntimeSpec(), quietRuntimeOptions({
    buildCompatibilityResult: () => null,
    runPythonImportCheckImpl: () => ({ ok: true }),
    execFileSyncImpl: () => {
      execCalled = true;
    },
  }));

  assert.equal(result.installed, true);
  assert.equal(result.changed, false);
  assert.equal(execCalled, false);
});

test('optional Python runtime installs and verifies missing package', async () => {
  const execCalls = [];
  const importChecks = [{ ok: false, output: 'missing pybullet' }, { ok: true }];
  const result = await installOptionalPythonRuntime(pybulletRuntimeSpec(), quietRuntimeOptions({
    buildCompatibilityResult: () => null,
    runPythonImportCheckImpl: () => importChecks.shift(),
    execFileSyncImpl: (command, args, options) => {
      execCalls.push({ command, args, options });
    },
  }));

  assert.deepEqual(result, {
    ok: true,
    changed: true,
    installed: true,
    skipped: false,
  });
  assert.equal(execCalls[0].command, '/usr/bin/uv');
  assert.deepEqual(execCalls[0].args, [
    'pip',
    'install',
    '--python',
    '/repo/.venv/bin/python3',
    'pybullet',
  ]);
  assert.equal(execCalls[0].options.cwd, '/repo');
  assert.deepEqual(execCalls[0].options.env, { UV_CACHE_DIR: '/repo/.uv-cache' });
});

test('optional Python runtime reports missing venv and missing uv as fatal', async () => {
  const missingVenv = await installOptionalPythonRuntime(pybulletRuntimeSpec(), quietRuntimeOptions({
    existsSyncImpl: () => false,
  }));
  const missingUv = await installOptionalPythonRuntime(pybulletRuntimeSpec(), quietRuntimeOptions({
    findUvImpl: () => null,
  }));

  assert.equal(missingVenv.ok, false);
  assert.equal(missingVenv.fatal, true);
  assert.equal(missingUv.ok, false);
  assert.equal(missingUv.fatal, true);
});

test('optional Python runtime reports nonfatal install failure unless forced', async () => {
  const result = await installOptionalPythonRuntime(pybulletRuntimeSpec(), quietRuntimeOptions({
    buildCompatibilityResult: () => null,
    runPythonImportCheckImpl: () => ({ ok: false, output: 'missing pybullet' }),
    execFileSyncImpl: () => {
      throw new Error('install failed');
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.fatal, false);
  assert.equal(result.error, 'install failed');
});
