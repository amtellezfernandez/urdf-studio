import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';

export function asString(value) {
  return typeof value === 'string' ? value : '';
}

export function safeRead(path, readFileSyncImpl = readFileSync) {
  try {
    return readFileSyncImpl(path, 'utf-8');
  } catch {
    return '';
  }
}

export function runCommand(
  command,
  args = [],
  { spawnSyncImpl = spawnSync, env = process.env, timeout = 8000 } = {}
) {
  try {
    const result = spawnSyncImpl(command, args, {
      encoding: 'utf-8',
      env,
      timeout,
    });
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: asString(result.stdout).trim(),
      stderr: asString(result.stderr).trim(),
      error: result.error ? result.error.message : '',
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      stdout: '',
      stderr: '',
      error: error?.message || String(error),
    };
  }
}

export function splitCommandLine(value) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
  let match = pattern.exec(asString(value));
  while (match) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
    match = pattern.exec(asString(value));
  }
  return tokens.filter(Boolean);
}

export function commandUnavailable(result) {
  const detail = `${result.error}\n${result.stderr}`.toLowerCase();
  return result.status === null && /(enoent|not found|no such file|cannot find)/i.test(detail);
}

export function summarizeCommandOutput(result) {
  const output = `${result.stdout}\n${result.stderr}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (output.length > 0) return output.slice(0, 3).join(' ');
  if (result.status !== null && result.status !== 0) return `exit code ${result.status}`;
  return result.error || 'no output';
}
