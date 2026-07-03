import { isTruthyEnvValue } from './setupHelpers.js';

export function buildSetupResult({ ok = true, changed = false, ...rest } = {}) {
  return { ok, changed, ...rest };
}

export function isSetupStepReady(result) {
  return result !== false && result?.ok !== false;
}

export function didSetupStepChange(result) {
  return Boolean(result?.changed);
}

export function printCapturedCommandOutput(
  result,
  { stdout = process.stdout, stderr = process.stderr } = {}
) {
  if (result.stdout) {
    stdout.write(result.stdout);
  }
  if (result.stderr) {
    stderr.write(result.stderr);
  }
}

export function didSpawnSyncFail(result) {
  if (result.status === 0 && !result.signal) {
    return false;
  }
  return result.status !== 0 || Boolean(result.signal) || Boolean(result.error);
}

export function buildOptionalRuntimeInstallFailure({
  forceInstallEnv,
  error = null,
  env = process.env,
}) {
  const fatal = isTruthyEnvValue(env[forceInstallEnv]);
  return {
    ok: false,
    installed: false,
    skipped: false,
    fatal,
    error: error instanceof Error ? error.message : null,
  };
}

export function shouldFailSetupForRuntimeResult(result) {
  return result?.ok === false && result.fatal !== false;
}
