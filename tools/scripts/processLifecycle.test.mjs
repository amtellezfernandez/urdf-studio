import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildManagedSpawnOptions,
  findStaleUrdfStudioProcessGroups,
  shouldUseManagedProcessGroup,
  terminateManagedProcess,
  terminateStaleUrdfStudioProcessGroups,
} from './processLifecycle.js';

test('managed process groups are enabled on POSIX platforms', () => {
  assert.equal(shouldUseManagedProcessGroup('linux'), true);
  assert.equal(shouldUseManagedProcessGroup('darwin'), true);
});

test('managed process groups stay disabled on Windows', () => {
  assert.equal(shouldUseManagedProcessGroup('win32'), false);
});

test('buildManagedSpawnOptions enables detached process groups without mutating options', () => {
  const options = { cwd: '/repo', stdio: 'pipe' };
  const managedOptions = buildManagedSpawnOptions(options, { platform: 'linux' });

  assert.deepEqual(options, { cwd: '/repo', stdio: 'pipe' });
  assert.deepEqual(managedOptions, { cwd: '/repo', stdio: 'pipe', detached: true });
});

test('buildManagedSpawnOptions preserves Windows spawn options without detaching', () => {
  const managedOptions = buildManagedSpawnOptions(
    { cwd: 'C:\\repo', stdio: 'pipe' },
    { platform: 'win32' }
  );

  assert.deepEqual(managedOptions, { cwd: 'C:\\repo', stdio: 'pipe' });
});

test('terminateManagedProcess kills the POSIX child process group', () => {
  const calls = [];
  const didTerminate = terminateManagedProcess(
    { pid: 1234, kill: () => false },
    'SIGINT',
    {
      platform: 'linux',
      killProcess: (pid, signal) => {
        calls.push({ pid, signal });
      },
    }
  );

  assert.equal(didTerminate, true);
  assert.deepEqual(calls, [{ pid: -1234, signal: 'SIGINT' }]);
});

test('terminateManagedProcess uses direct child termination on Windows', () => {
  const calls = [];
  const didTerminate = terminateManagedProcess(
    {
      pid: 1234,
      kill: (signal) => {
        calls.push(signal);
        return true;
      },
    },
    'SIGTERM',
    {
      platform: 'win32',
      killProcess: () => {
        throw new Error('should not call process-group killer on Windows');
      },
    }
  );

  assert.equal(didTerminate, true);
  assert.deepEqual(calls, ['SIGTERM']);
});

test('terminateManagedProcess treats already-exited POSIX process groups as stopped', () => {
  const didTerminate = terminateManagedProcess(
    { pid: 1234, kill: () => true },
    'SIGTERM',
    {
      platform: 'linux',
      killProcess: () => {
        const error = new Error('missing process');
        error.code = 'ESRCH';
        throw error;
      },
    }
  );

  assert.equal(didTerminate, false);
});

function writeProcEntry(procDir, pid, { argv, cwd, processGroupId }) {
  const pidDir = join(procDir, String(pid));
  mkdirSync(pidDir, { recursive: true });
  writeFileSync(join(pidDir, 'cmdline'), `${argv.join('\0')}\0`);
  writeFileSync(join(pidDir, 'stat'), `${pid} (${argv[0]}) S 1 ${processGroupId} 0 0 0`);
  symlinkSync(cwd, join(pidDir, 'cwd'));
}

test('stale URDF Studio cleanup only targets matching process groups in this checkout', () => {
  const procDir = join(tmpdir(), `urdf-studio-proc-${process.pid}-${Date.now()}`);
  const rootDir = join(procDir, 'repo', 'urdf-studio');
  const otherRootDir = join(procDir, 'other', 'repo');
  mkdirSync(rootDir, { recursive: true });
  mkdirSync(otherRootDir, { recursive: true });
  mkdirSync(procDir, { recursive: true });
  writeProcEntry(procDir, 100, {
    argv: ['node', 'tools/scripts/run.js'],
    cwd: rootDir,
    processGroupId: 100,
  });
  writeProcEntry(procDir, 101, {
    argv: ['node', './node_modules/.bin/vite', '--config', 'config/vite.config.ts'],
    cwd: rootDir,
    processGroupId: 100,
  });
  writeProcEntry(procDir, 200, {
    argv: ['node', 'tools/scripts/run.js'],
    cwd: otherRootDir,
    processGroupId: 200,
  });
  writeProcEntry(procDir, 300, {
    argv: ['python3', '-m', 'http.server'],
    cwd: rootDir,
    processGroupId: 300,
  });

  const staleGroups = findStaleUrdfStudioProcessGroups({
    currentPid: 999,
    platform: 'linux',
    procDir,
    rootDir,
  });

  assert.equal(staleGroups.length, 1);
  assert.equal(staleGroups[0].processGroupId, 100);
  assert.deepEqual(
    staleGroups[0].processes.map((processInfo) => processInfo.pid).sort(),
    [100, 101]
  );

  const calls = [];
  const terminatedGroups = terminateStaleUrdfStudioProcessGroups({
    currentPid: 999,
    killProcess: (pid, signal) => calls.push({ pid, signal }),
    platform: 'linux',
    procDir,
    rootDir,
    signal: 'SIGTERM',
  });

  assert.equal(terminatedGroups.length, 1);
  assert.deepEqual(calls, [{ pid: -100, signal: 'SIGTERM' }]);
});
