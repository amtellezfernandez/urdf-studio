import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  getNpmCommand,
  installDependencies,
  installOptionalGlobalIlu,
  installTwinDepsIfRequested,
  runNpmInstall,
  shouldInstallTwinDeps,
} from './setupNodeRuntime.js';

test('npm command resolution prefers npm_execpath and falls back by platform', () => {
  assert.deepEqual(
    getNpmCommand({
      env: { npm_execpath: '/repo/.npm/npm-cli.js' },
      execPath: '/usr/bin/node',
    }),
    {
      command: '/usr/bin/node',
      argsPrefix: ['/repo/.npm/npm-cli.js'],
    }
  );
  assert.deepEqual(getNpmCommand({ env: {}, platform: 'win32' }), {
    command: 'npm.cmd',
    argsPrefix: [],
  });
  assert.deepEqual(getNpmCommand({ env: {}, platform: 'linux' }), {
    command: 'npm',
    argsPrefix: [],
  });
});

test('runNpmInstall forwards npm output on failure', () => {
  const stdoutWrites = [];
  const stderrWrites = [];
  assert.throws(
    () =>
      runNpmInstall(['install'], {
        rootDir: '/repo',
        env: {},
        platform: 'linux',
        spawnSyncImpl: (command, args, options) => {
          assert.equal(command, 'npm');
          assert.deepEqual(args, ['install']);
          assert.equal(options.cwd, '/repo');
          return {
            status: 1,
            stdout: 'install out',
            stderr: 'install err',
          };
        },
        stdout: { write: (value) => stdoutWrites.push(value) },
        stderr: { write: (value) => stderrWrites.push(value) },
      }),
    /npm install failed/
  );

  assert.deepEqual(stdoutWrites, ['install out']);
  assert.deepEqual(stderrWrites, ['install err']);
});

test('dependency setup installs full dependencies or only missing setup dependency', async () => {
  const calls = [];
  const missingAll = await installDependencies({
    rootDir: '/repo',
    existsSyncImpl: () => false,
    runNpmInstallImpl: (args, options) => calls.push({ args, options }),
  });
  const missingInquirer = await installDependencies({
    rootDir: '/repo',
    existsSyncImpl: (candidatePath) =>
      [
        join('/repo', 'node_modules'),
        join('/repo', 'node_modules', '.bin', 'vite'),
      ].includes(candidatePath),
    runNpmInstallImpl: (args, options) => calls.push({ args, options }),
  });

  assert.equal(missingAll.changed, true);
  assert.equal(missingInquirer.changed, true);
  assert.deepEqual(calls[0].args, ['install', '--no-fund', '--audit=false', '--loglevel=error']);
  assert.deepEqual(calls[1].args, ['install', 'inquirer', '--no-fund', '--audit=false', '--loglevel=error']);
  assert.equal(calls[0].options.rootDir, '/repo');
});

test('dependency setup reports no changes when node runtime is ready', async () => {
  const result = await installDependencies({
    rootDir: '/repo',
    existsSyncImpl: () => true,
    runNpmInstallImpl: () => {
      throw new Error('npm install should not run');
    },
  });

  assert.equal(result.changed, false);
});

test('optional global ilu install handles skipped, missing, success, and failure states', async () => {
  const skipped = await installOptionalGlobalIlu({
    shouldInstall: () => false,
  });
  const missingLocal = await installOptionalGlobalIlu({
    rootDir: '/repo',
    shouldInstall: () => true,
    existsSyncImpl: () => false,
  });
  const installCalls = [];
  const installed = await installOptionalGlobalIlu({
    rootDir: '/repo',
    shouldInstall: () => true,
    existsSyncImpl: () => true,
    runNpmInstallImpl: (args, options) => installCalls.push({ args, options }),
  });
  const failed = await installOptionalGlobalIlu({
    rootDir: '/repo',
    shouldInstall: () => true,
    existsSyncImpl: () => true,
    runNpmInstallImpl: () => {
      throw new Error('npm failed');
    },
  });

  assert.deepEqual(skipped, {
    ok: true,
    changed: false,
    attempted: false,
    installed: false,
  });
  assert.equal(missingLocal.attempted, true);
  assert.equal(missingLocal.installed, false);
  assert.equal(installed.changed, true);
  assert.equal(installed.installed, true);
  assert.deepEqual(installCalls[0].args, [
    'install',
    '-g',
    join('/repo', 'node_modules', 'i-love-urdf'),
    '--no-fund',
    '--audit=false',
    '--loglevel=error',
  ]);
  assert.equal(failed.attempted, true);
  assert.equal(failed.installed, false);
  assert.equal(failed.changed, false);
});

test('twin dependency setup opt-in honors flags and environment', () => {
  assert.equal(shouldInstallTwinDeps({ argv: ['node', 'setup'], env: {} }), false);
  assert.equal(shouldInstallTwinDeps({ argv: ['node', 'setup', '--twin'], env: {} }), true);
  assert.equal(shouldInstallTwinDeps({ argv: ['node', 'setup', '--install-twin'], env: {} }), true);
  assert.equal(shouldInstallTwinDeps({ argv: ['node', 'setup'], env: { npm_config_twin: '1' } }), true);
  assert.equal(shouldInstallTwinDeps({ argv: ['node', 'setup'], env: { TWIN: 'true' } }), true);
});

test('twin dependency setup skips when not requested', async () => {
  const result = await installTwinDepsIfRequested({
    rootDir: '/repo',
    argv: ['node', 'setup'],
    env: {},
    execFileSyncImpl: () => {
      throw new Error('twin setup should not run');
    },
  });

  assert.deepEqual(result, { ok: true, changed: false });
});

test('twin dependency setup reports missing script when requested', async () => {
  const logs = [];

  await assert.rejects(
    installTwinDepsIfRequested({
      rootDir: '/repo',
      argv: ['node', 'setup', '--twin'],
      env: {},
      existsSyncImpl: () => false,
      log: (message) => logs.push(message),
    }),
    /Missing scripts\/twin\.js/
  );

  assert.deepEqual(logs, ['✗ Twin setup requested but scripts/twin.js was not found']);
});

test('twin dependency setup launches repo twin script with current Node runtime', async () => {
  const calls = [];
  const result = await installTwinDepsIfRequested({
    rootDir: '/repo',
    argv: ['node', 'setup'],
    env: { TWIN: '1' },
    existsSyncImpl: () => true,
    nodeCommand: '/usr/bin/node',
    execFileSyncImpl: (command, args, options) => {
      calls.push({ command, args, options });
    },
  });

  assert.deepEqual(result, { ok: true, changed: true });
  assert.deepEqual(calls, [
    {
      command: '/usr/bin/node',
      args: [join('/repo', 'scripts', 'twin.js'), '--twin'],
      options: { cwd: '/repo', stdio: 'inherit' },
    },
  ]);
});
