import test from 'node:test';
import assert from 'node:assert/strict';

import {
  installBackendDeps,
  resolveBackendPythonDependencies,
  resolveBackendPythonVerifyImportScript,
  shouldBlockForcedBackendNativeSimRuntime,
  shouldInstallBackendNativeSimRuntime,
} from './setupBackendPythonRuntime.js';
import {
  BACKEND_NATIVE_SIM_FORCE_ENV,
  BACKEND_NATIVE_SIM_SKIP_ENV,
  BACKEND_PYTHON_JAX_DEPENDENCIES,
  BACKEND_PYTHON_PLACO_DEPENDENCIES,
  BACKEND_PYTHON_PORTABLE_DEPENDENCIES,
  MJX_DEPENDENCIES,
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

test('backend native simulation install policy honors skip, force, platform, and compatibility', () => {
  assert.equal(
    shouldInstallBackendNativeSimRuntime({
      env: { [BACKEND_NATIVE_SIM_SKIP_ENV]: '1' },
      platform: 'linux',
      managedInstallAllowed: () => true,
    }),
    false
  );
  assert.equal(
    shouldInstallBackendNativeSimRuntime({
      env: { [BACKEND_NATIVE_SIM_FORCE_ENV]: '1' },
      platform: 'darwin',
      managedInstallAllowed: () => false,
    }),
    true
  );
  assert.equal(
    shouldInstallBackendNativeSimRuntime({
      env: {},
      platform: 'darwin',
      managedInstallAllowed: () => true,
    }),
    false
  );
  assert.equal(
    shouldInstallBackendNativeSimRuntime({
      env: {},
      platform: 'linux',
      managedInstallAllowed: (_report, simulatorId) => simulatorId === 'mjx',
    }),
    true
  );
});

test('backend dependency resolution composes portable, collision, and native stacks', () => {
  const portableOnly = resolveBackendPythonDependencies({
    env: { URDF_STUDIO_SKIP_COLLISION_STACK_AUTO_INSTALL: '1' },
    platform: 'darwin',
    managedInstallAllowed: () => false,
  });
  const fullLinux = resolveBackendPythonDependencies({
    env: {},
    platform: 'linux',
    managedInstallAllowed: () => true,
  });

  assert.deepEqual(portableOnly, BACKEND_PYTHON_PORTABLE_DEPENDENCIES);
  assert.ok(fullLinux.includes(BACKEND_PYTHON_PLACO_DEPENDENCIES[0]));
  assert.ok(fullLinux.includes(BACKEND_PYTHON_JAX_DEPENDENCIES[0]));
  assert.ok(fullLinux.includes(MJX_DEPENDENCIES[0]));
});

test('backend verification script follows selected runtime stacks', () => {
  const coreOnly = resolveBackendPythonVerifyImportScript({
    env: { URDF_STUDIO_SKIP_COLLISION_STACK_AUTO_INSTALL: '1' },
    platform: 'darwin',
    managedInstallAllowed: () => false,
  });
  const fullLinux = resolveBackendPythonVerifyImportScript({
    env: {},
    platform: 'linux',
    managedInstallAllowed: () => true,
  });

  assert.match(coreOnly, /backend python core runtime ok/);
  assert.doesNotMatch(coreOnly, /backend python collision stack runtime ok/);
  assert.match(fullLinux, /backend python collision stack runtime ok/);
  assert.match(fullLinux, /backend python native simulation runtime ok/);
});

test('backend install removes superseded packages before repairing dependencies', async () => {
  const execCalls = [];
  const importChecks = [{ ok: false }, { ok: true }];
  const arrows = [];
  const success = [];
  const result = await installBackendDeps(null, quietRuntimeOptions({
    logArrow: (message) => arrows.push(message),
    logSuccess: (message) => success.push(message),
    listInstalledPythonPackageNamesImpl: () => ['libcoal', 'fastapi'],
    runPythonImportCheckImpl: () => importChecks.shift(),
    execFileSyncImpl: (command, args, options) => {
      execCalls.push({ command, args, env: options.env });
    },
    managedInstallAllowed: () => false,
  }));

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(execCalls.length, 2);
  assert.deepEqual(execCalls[0].args.slice(0, 4), ['pip', 'uninstall', '--python', '/repo/.venv/bin/python3']);
  assert.ok(execCalls[0].args.includes('libcoal'));
  assert.deepEqual(execCalls[1].args.slice(0, 4), ['pip', 'install', '--python', '/repo/.venv/bin/python3']);
  assert.deepEqual(execCalls[1].env, { UV_CACHE_DIR: '/repo/.uv-cache' });
  assert.deepEqual(arrows, ['Checking backend Python runtime']);
  assert.deepEqual(success, ['Backend dependencies installed']);
});

test('backend install reports ready when backend packages already verify', async () => {
  const arrows = [];
  const success = [];
  const result = await installBackendDeps(null, quietRuntimeOptions({
    logArrow: (message) => arrows.push(message),
    logSuccess: (message) => success.push(message),
    listInstalledPythonPackageNamesImpl: () => [],
    runPythonImportCheckImpl: () => ({ ok: true }),
    execFileSyncImpl: () => {
      throw new Error('backend install should not run');
    },
  }));

  assert.deepEqual(result, { ok: true, changed: false });
  assert.deepEqual(arrows, ['Checking backend Python runtime']);
  assert.deepEqual(success, ['Backend Python runtime ready']);
});

test('backend install blocks forced native dependencies on incompatible hosts', async () => {
  let installCalled = false;
  const result = await installBackendDeps(
    { targets: {} },
    quietRuntimeOptions({
      env: { [BACKEND_NATIVE_SIM_FORCE_ENV]: '1' },
      managedInstallAllowed: () => false,
      getCompatibilityTarget: () => ({
        label: 'MJX',
        reasons: ['CUDA unavailable.'],
        setupMode: 'managed',
      }),
      runPythonImportCheckImpl: () => {
        installCalled = true;
        return { ok: true };
      },
    })
  );

  assert.equal(result.ok, false);
  assert.equal(installCalled, false);
  assert.equal(
    shouldBlockForcedBackendNativeSimRuntime({
      env: { [BACKEND_NATIVE_SIM_FORCE_ENV]: '1' },
      managedInstallAllowed: () => false,
    }),
    true
  );
});
