import test from 'node:test';
import assert from 'node:assert/strict';

import {
  commandUnavailable,
  runCommand,
  splitCommandLine,
  summarizeCommandOutput,
} from './simulatorHostProbeUtils.js';

test('splitCommandLine preserves quoted arguments for configured probes', () => {
  assert.deepEqual(
    splitCommandLine('checker --flag "two words" \'single quoted\''),
    ['checker', '--flag', 'two words', 'single quoted']
  );
});

test('runCommand normalizes spawn success and failure output', () => {
  const success = runCommand('tool', ['--version'], {
    spawnSyncImpl: (command, args) => ({
      status: 0,
      stdout: ` ${command} ${args.join(' ')} \n`,
      stderr: '',
    }),
  });
  const missing = runCommand('missing-tool', [], {
    spawnSyncImpl: () => ({
      status: null,
      stdout: '',
      stderr: 'not found',
      error: { message: 'ENOENT' },
    }),
  });

  assert.deepEqual(success, {
    ok: true,
    status: 0,
    stdout: 'tool --version',
    stderr: '',
    error: '',
  });
  assert.equal(commandUnavailable(missing), true);
  assert.equal(summarizeCommandOutput(missing), 'not found');
});

test('summarizeCommandOutput prefers bounded stdout and stderr detail', () => {
  const summary = summarizeCommandOutput({
    ok: false,
    status: 1,
    stdout: 'line one\nline two\nline three\nline four',
    stderr: 'ignored after first three lines',
    error: '',
  });

  assert.equal(summary, 'line one line two line three');
});
