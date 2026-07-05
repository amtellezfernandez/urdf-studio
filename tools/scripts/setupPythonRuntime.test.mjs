import test from 'node:test';
import assert from 'node:assert/strict';
import { delimiter, join } from 'node:path';

import {
  getManagedPythonPath,
  getUvEnv,
  listInstalledPythonPackageNames,
  prependNativeLibraryPath,
  resolveManagedCmeelLibPath,
  resolveManagedCmeelLibPathFromSitePackages,
  resolvePythonForBackendVenv,
  runPythonImportCheck,
  setupPythonBackendEnvironment,
} from './setupPythonRuntime.js';

test('managed Python path is rooted in the repo venv', () => {
  assert.equal(getManagedPythonPath('/repo'), '/repo/.venv/bin/python3');
});

test('native library path prepending is stable and de-duplicates the target path', () => {
  const env = {
    LD_LIBRARY_PATH: ['/opt/other/lib', '/tmp/cmeel/lib'].join(delimiter),
  };

  prependNativeLibraryPath(env, '/tmp/cmeel/lib');

  assert.equal(env.LD_LIBRARY_PATH, ['/tmp/cmeel/lib', '/opt/other/lib'].join(delimiter));
});

test('cmeel library path resolves from Python site-package paths', () => {
  const sitePackagePath = join('/tmp', 'studio-env', 'lib', 'python3.12', 'site-packages');
  const expectedPath = join(sitePackagePath, 'cmeel.prefix', 'lib');

  assert.equal(
    resolveManagedCmeelLibPathFromSitePackages(
      ['', join('/tmp', 'empty-site-packages'), sitePackagePath],
      (candidatePath) => candidatePath === expectedPath
    ),
    expectedPath
  );
});

test('uv environment adds cache, ROS urdfdom, and managed cmeel libraries', () => {
  const venvPython = '/repo/.venv/bin/python3';
  const sitePackagePath = '/repo/.venv/lib/python3.12/site-packages';
  const cmeelLibPath = join(sitePackagePath, 'cmeel.prefix', 'lib');
  const rosLibPath = '/opt/ros/jazzy/lib/x86_64-linux-gnu';
  const execCalls = [];
  const existsSyncImpl = (candidatePath) =>
    [
      venvPython,
      cmeelLibPath,
      join(rosLibPath, 'liburdfdom_sensor.so.4.0'),
    ].includes(candidatePath);

  const env = getUvEnv({
    rootDir: '/repo',
    env: { PATH: '/usr/bin' },
    managedPythonPath: venvPython,
    existsSyncImpl,
    execFileSyncImpl: (command, args, options) => {
      execCalls.push({ command, args, env: options.env });
      return JSON.stringify([sitePackagePath]);
    },
  });

  assert.equal(env.UV_CACHE_DIR, '/repo/.uv-cache');
  assert.equal(env.LD_LIBRARY_PATH, [cmeelLibPath, rosLibPath].join(delimiter));
  assert.equal(execCalls.length, 1);
  assert.equal(execCalls[0].command, venvPython);
  assert.equal(execCalls[0].env.UV_CACHE_DIR, '/repo/.uv-cache');
  assert.equal(execCalls[0].env.LD_LIBRARY_PATH, rosLibPath);
});

test('managed cmeel lookup returns null when Python inspection fails', () => {
  assert.equal(
    resolveManagedCmeelLibPath('/repo/.venv/bin/python3', {
      rootDir: '/repo',
      existsSyncImpl: () => true,
      execFileSyncImpl: () => {
        throw new Error('python failed');
      },
    }),
    null
  );
});

test('backend Python resolution supports managed default and explicit Python 3.12+', () => {
  assert.deepEqual(resolvePythonForBackendVenv({ env: {} }), {
    python: '3.12',
    usesUvManagedPython: true,
  });
  assert.deepEqual(
    resolvePythonForBackendVenv({
      env: { URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON: '/opt/python3.12' },
      execFileSyncImpl: () => '3.12\n',
    }),
    {
      python: '/opt/python3.12',
      usesUvManagedPython: false,
    }
  );
  assert.equal(
    resolvePythonForBackendVenv({
      env: { URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON: '/opt/python3.11' },
      execFileSyncImpl: () => '3.11\n',
    }),
    null
  );
});

test('Python backend environment setup reuses existing managed venv', async () => {
  const arrows = [];
  const success = [];
  const result = await setupPythonBackendEnvironment({
    rootDir: '/repo',
    findUv: () => '/usr/bin/uv',
    existsSyncImpl: (candidatePath) => candidatePath === '/repo/.venv/bin/python3',
    logArrow: (message) => arrows.push(message),
    logSuccess: (message) => success.push(message),
    execFileSyncImpl: () => {
      throw new Error('uv venv should not run');
    },
  });

  assert.deepEqual(result, { ok: true, changed: false });
  assert.deepEqual(arrows, ['Checking Python backend runtime']);
  assert.deepEqual(success, ['Python backend environment ready']);
});

test('Python backend environment setup reports missing uv before creating venv', async () => {
  const warnings = [];
  const info = [];
  const result = await setupPythonBackendEnvironment({
    rootDir: '/repo',
    findUv: () => null,
    logWarning: (message) => warnings.push(message),
    logInfo: (message) => info.push(message),
  });

  assert.deepEqual(result, { ok: false, changed: false });
  assert.match(warnings.join('\n'), /uv not found/);
  assert.match(info.join('\n'), /curl -LsSf/);
});

test('Python backend environment setup rejects invalid bootstrap Python', async () => {
  const warnings = [];
  const info = [];
  const result = await setupPythonBackendEnvironment({
    rootDir: '/repo',
    findUv: () => '/usr/bin/uv',
    existsSyncImpl: () => false,
    resolvePythonForBackendVenvImpl: () => null,
    logWarning: (message) => warnings.push(message),
    logInfo: (message) => info.push(message),
  });

  assert.deepEqual(result, { ok: false, changed: false });
  assert.match(warnings.join('\n'), /BACKEND_BOOTSTRAP_PYTHON/);
  assert.match(info.join('\n'), /uv python install 3\.12/);
});

test('Python backend environment setup creates venv with selected interpreter', async () => {
  const calls = [];
  const result = await setupPythonBackendEnvironment({
    rootDir: '/repo',
    findUv: () => '/usr/bin/uv',
    existsSyncImpl: () => false,
    resolvePythonForBackendVenvImpl: () => ({
      python: '/opt/python3.12',
      usesUvManagedPython: false,
    }),
    getUvEnvImpl: () => ({ UV_CACHE_DIR: '/repo/.uv-cache' }),
    execFileSyncImpl: (command, args, options) => {
      calls.push({ command, args, options });
    },
  });

  assert.deepEqual(result, { ok: true, changed: true });
  assert.equal(calls[0].command, '/usr/bin/uv');
  assert.deepEqual(calls[0].args, ['venv', '--python', '/opt/python3.12', '/repo/.venv']);
  assert.equal(calls[0].options.cwd, '/repo');
  assert.equal(calls[0].options.env.UV_CACHE_DIR, '/repo/.uv-cache');
});

test('Python backend environment setup reports uv venv failures', async () => {
  const warnings = [];
  const info = [];
  const result = await setupPythonBackendEnvironment({
    rootDir: '/repo',
    findUv: () => '/usr/bin/uv',
    existsSyncImpl: () => false,
    resolvePythonForBackendVenvImpl: () => ({
      python: '3.12',
      usesUvManagedPython: true,
    }),
    execFileSyncImpl: () => {
      throw new Error('uv failed');
    },
    logWarning: (message) => warnings.push(message),
    logInfo: (message) => info.push(message),
  });

  assert.deepEqual(result, { ok: false, changed: false });
  assert.match(warnings.join('\n'), /Failed to create unified Python environment/);
  assert.match(info.join('\n'), /npm run setup/);
});

test('installed Python package inspection parses distribution names', () => {
  const result = listInstalledPythonPackageNames('/repo/.venv/bin/python3', {
    rootDir: '/repo',
    spawnSyncImpl: (command, args, options) => {
      assert.equal(command, '/repo/.venv/bin/python3');
      assert.deepEqual(args.slice(0, 1), ['-c']);
      assert.equal(options.cwd, '/repo');
      return {
        status: 0,
        stdout: JSON.stringify(['fastapi', 'mujoco']),
        stderr: '',
      };
    },
  });

  assert.deepEqual(result, ['fastapi', 'mujoco']);
});

test('installed Python package inspection reports stderr on failure', () => {
  assert.throws(
    () =>
      listInstalledPythonPackageNames('/repo/.venv/bin/python3', {
        spawnSyncImpl: () => ({
          status: 1,
          stdout: '',
          stderr: 'metadata unavailable',
        }),
      }),
    /metadata unavailable/
  );
});

test('Python import check returns trimmed output and uv environment', () => {
  const result = runPythonImportCheck('/repo/.venv/bin/python3', 'import fastapi', {
    rootDir: '/repo',
    env: { PATH: '/usr/bin' },
    existsSyncImpl: (candidatePath) => candidatePath === '/repo/.venv/bin/python3',
    execFileSyncImpl: () => JSON.stringify([]),
    spawnSyncImpl: (command, args, options) => {
      assert.equal(command, '/repo/.venv/bin/python3');
      assert.deepEqual(args, ['-c', 'import fastapi']);
      assert.equal(options.cwd, '/repo');
      assert.equal(options.env.UV_CACHE_DIR, '/repo/.uv-cache');
      return {
        status: 1,
        stdout: ' stdout line \n',
        stderr: ' stderr line \n',
      };
    },
  });

  assert.deepEqual(result, {
    ok: false,
    stdout: 'stdout line',
    stderr: 'stderr line',
    output: 'stdout line\nstderr line',
  });
});
