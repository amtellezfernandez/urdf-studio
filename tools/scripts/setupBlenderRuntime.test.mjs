import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  findExecutableInPath,
  getManagedBlenderExecutablePath,
  installBlenderRuntime,
  installManagedLinuxBlenderRuntime,
  resolveBlenderCandidate,
  resolveBlenderExecutableForSetup,
  shouldInstallBlenderRuntime,
  verifyBlenderExecutable,
} from './setupBlenderRuntime.js';
import {
  BLENDER_FORCE_INSTALL_ENV,
  BLENDER_SKIP_AUTO_INSTALL_ENV,
} from './setupParams.js';

function withTempDir(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'urdf-studio-blender-runtime-'));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function writeExecutable(path) {
  writeFileSync(path, '#!/bin/sh\n', 'utf-8');
  chmodSync(path, 0o755);
}

test('managed Blender executable path is derived from setup params and platform', () => {
  assert.equal(
    getManagedBlenderExecutablePath('/repo', { platform: 'linux' }),
    '/repo/.cache/blender-runtime/blender-4.5.10-linux-x64/blender'
  );
  assert.equal(
    getManagedBlenderExecutablePath('/repo', { platform: 'win32' }),
    '/repo/.cache/blender-runtime/blender-4.5.10-linux-x64/blender.exe'
  );
});

test('Blender candidate resolver handles directories, app bundles, PATH names, and Windows executables', () =>
  withTempDir((directory) => {
    const blenderDir = join(directory, 'Blender');
    mkdirSync(blenderDir, { recursive: true });
    const blenderExecutable = join(blenderDir, 'blender');
    writeExecutable(blenderExecutable);

    const appExecutable = join(directory, 'Blender.app', 'Contents', 'MacOS', 'Blender');
    mkdirSync(join(directory, 'Blender.app', 'Contents', 'MacOS'), { recursive: true });
    writeExecutable(appExecutable);

    assert.equal(
      resolveBlenderCandidate(blenderDir, { platform: 'linux' }),
      blenderExecutable
    );
    assert.equal(
      resolveBlenderCandidate(join(directory, 'Blender.app'), { platform: 'darwin' }),
      appExecutable
    );
    assert.equal(
      findExecutableInPath('blender', {
        env: { PATH: blenderDir },
        platform: 'linux',
      }),
      blenderExecutable
    );
    assert.equal(
      resolveBlenderCandidate('C:\\Program Files\\Blender\\blender.exe', {
        platform: 'linux',
      }),
      null
    );
  }));

test('configured Blender path must resolve and pass verification', () =>
  withTempDir((directory) => {
    const blenderExecutable = join(directory, 'blender');
    writeExecutable(blenderExecutable);
    const env = {
      URDF_STUDIO_BLENDER_PATH: blenderExecutable,
      PATH: '',
    };

    assert.equal(
      resolveBlenderExecutableForSetup({
        rootDir: '/repo',
        env,
        platform: 'linux',
        verifyExecutable: (candidate) => candidate === blenderExecutable,
      }),
      blenderExecutable
    );
    assert.equal(
      resolveBlenderExecutableForSetup({
        rootDir: '/repo',
        env,
        platform: 'linux',
        verifyExecutable: () => false,
      }),
      null
    );
  }));

test('Blender verification requires the runtime marker from the spawned process', () => {
  assert.equal(
    verifyBlenderExecutable('/opt/blender/blender', {
      rootDir: '/repo',
      spawnSyncImpl: (command, args, options) => {
        assert.equal(command, '/opt/blender/blender');
        assert.equal(options.cwd, '/repo');
        assert.deepEqual(args.slice(0, 2), ['--background', '--python-expr']);
        return {
          status: 0,
          stdout: 'blender python runtime ok\n',
          stderr: '',
        };
      },
    }),
    true
  );
  assert.equal(
    verifyBlenderExecutable('/opt/blender/blender', {
      rootDir: '/repo',
      spawnSyncImpl: () => ({
        status: 0,
        stdout: 'Blender 4.5\n',
        stderr: '',
      }),
    }),
    false
  );
});

test('Blender install policy honors skip and force env vars', () => {
  assert.equal(
    shouldInstallBlenderRuntime({ env: { [BLENDER_SKIP_AUTO_INSTALL_ENV]: '1' } }),
    false
  );
  assert.equal(
    shouldInstallBlenderRuntime({ env: { [BLENDER_FORCE_INSTALL_ENV]: '1' } }),
    true
  );
  assert.equal(shouldInstallBlenderRuntime({ env: {} }), true);
});

test('managed Blender installer reuses an already verified executable', () => {
  const executablePath = '/repo/.cache/blender-runtime/blender-4.5.10-linux-x64/blender';
  let execCalled = false;

  assert.equal(
    installManagedLinuxBlenderRuntime({
      rootDir: '/repo',
      platform: 'linux',
      arch: 'x64',
      getManagedBlenderRuntimeRootImpl: () => '/repo/.cache/blender-runtime',
      getManagedBlenderExecutablePathImpl: () => executablePath,
      verifyBlenderExecutableImpl: () => true,
      execFileSyncImpl: () => {
        execCalled = true;
      },
    }),
    executablePath
  );
  assert.equal(execCalled, false);
});

test('managed Blender installer downloads, extracts, chmods, and verifies the runtime', () => {
  const calls = [];
  const executablePath = '/repo/.cache/blender-runtime/blender-4.5.10-linux-x64/blender';
  const runtimeRoot = '/repo/.cache/blender-runtime';
  let verifyCount = 0;

  const result = installManagedLinuxBlenderRuntime({
    rootDir: '/repo',
    platform: 'linux',
    arch: 'x64',
    getManagedBlenderRuntimeRootImpl: () => runtimeRoot,
    getManagedBlenderExecutablePathImpl: () => executablePath,
    verifyBlenderExecutableImpl: () => {
      verifyCount += 1;
      return verifyCount > 1;
    },
    existsSyncImpl: () => false,
    mkdirSyncImpl: (path, options) => calls.push(['mkdir', path, options]),
    rmSyncImpl: (path, options) => calls.push(['rm', path, options]),
    renameSyncImpl: (from, to) => calls.push(['rename', from, to]),
    chmodSyncImpl: (path, mode) => calls.push(['chmod', path, mode]),
    execFileSyncImpl: (command, args, options) => calls.push(['exec', command, args, options.cwd]),
  });

  assert.equal(result, executablePath);
  assert.deepEqual(calls[0], ['mkdir', `${runtimeRoot}/downloads`, { recursive: true }]);
  assert.deepEqual(calls[1], ['rm', `${runtimeRoot}/downloads/blender-4.5.10-linux-x64.tar.xz.tmp`, { force: true }]);
  assert.equal(calls[2][0], 'exec');
  assert.equal(calls[2][1], 'curl');
  assert.ok(calls[2][2].includes('--output'));
  assert.deepEqual(calls[3], [
    'rename',
    `${runtimeRoot}/downloads/blender-4.5.10-linux-x64.tar.xz.tmp`,
    `${runtimeRoot}/downloads/blender-4.5.10-linux-x64.tar.xz`,
  ]);
  assert.deepEqual(calls[4], ['rm', '/repo/.cache/blender-runtime/blender-4.5.10-linux-x64', { recursive: true, force: true }]);
  assert.deepEqual(calls[5], [
    'exec',
    'tar',
    ['-xJf', `${runtimeRoot}/downloads/blender-4.5.10-linux-x64.tar.xz`, '-C', runtimeRoot],
    '/repo',
  ]);
  assert.deepEqual(calls[6], ['chmod', executablePath, 0o755]);
});

test('Blender runtime setup returns existing compatible executable before install', async () => {
  let installCalled = false;

  const result = await installBlenderRuntime(null, {
    rootDir: '/repo',
    resolveBlenderExecutableForSetupImpl: () => '/opt/blender/blender',
    installManagedLinuxBlenderRuntimeImpl: () => {
      installCalled = true;
    },
  });

  assert.equal(result.installed, true);
  assert.equal(result.executable, '/opt/blender/blender');
  assert.equal(installCalled, false);
});

test('Blender runtime setup reports nonfatal managed install failures by default', async () => {
  const result = await installBlenderRuntime(null, {
    rootDir: '/repo',
    env: {},
    resolveBlenderExecutableForSetupImpl: () => null,
    buildCompatibilityResult: () => null,
    installManagedLinuxBlenderRuntimeImpl: () => {
      throw new Error('download failed');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.fatal, false);
  assert.equal(result.error, 'download failed');
});
