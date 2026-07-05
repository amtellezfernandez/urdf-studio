import { existsSync } from 'fs';
import { execFileSync } from 'child_process';

import { isTruthyEnvValue } from './setupHelpers.js';
import {
  buildOptionalRuntimeInstallFailure,
  buildSetupResult,
  printCapturedCommandOutput,
} from './setupCommandResults.js';
import { buildSimulatorCompatibilityInstallResult } from './setupSimulatorInstallCompatibility.js';
import { runPythonImportCheck } from './setupPythonRuntime.js';
import { findUv } from './setupToolchainRuntime.js';
import { PYTHON_ENV_DIRNAME } from './setupParams.js';

export function shouldInstallOptionalPythonRuntime({
  skipAutoInstallEnv,
  forceInstallEnv,
  defaultInstall,
  env = process.env,
}) {
  if (isTruthyEnvValue(env[skipAutoInstallEnv])) {
    return false;
  }
  if (isTruthyEnvValue(env[forceInstallEnv])) {
    return true;
  }
  return defaultInstall;
}

export async function installOptionalPythonRuntime({
  shouldInstall,
  displayName,
  setupName,
  simulatorId,
  simulatorCompatibilityReport = null,
  dependencies,
  verifyImportScript,
  forceInstallEnv,
  manualInstallIntro = 'Try manually:',
}, {
  rootDir = process.cwd(),
  env = process.env,
  platform = process.platform,
  getManagedPythonPath,
  findUvImpl = findUv,
  existsSyncImpl = existsSync,
  runPythonImportCheckImpl = runPythonImportCheck,
  execFileSyncImpl = execFileSync,
  buildCompatibilityResult = buildSimulatorCompatibilityInstallResult,
  buildOptionalRuntimeInstallFailureImpl = buildOptionalRuntimeInstallFailure,
  printCapturedCommandOutputImpl = printCapturedCommandOutput,
  getUvEnv = () => env,
  logArrow = () => {},
  logInfo = () => {},
  logSuccess = () => {},
  logWarning = () => {},
} = {}) {
  if (!shouldInstall({ env, platform })) {
    return buildSetupResult({ installed: false, skipped: true });
  }
  const compatibilityResult = buildCompatibilityResult({
    simulatorCompatibilityReport,
    simulatorId,
    setupName,
    forceInstallEnv,
    env,
    logWarning,
    logInfo,
  });
  if (compatibilityResult) {
    return compatibilityResult;
  }

  const venvPython = getManagedPythonPath();
  const uvPath = findUvImpl({ env });
  if (!existsSyncImpl(venvPython)) {
    logInfo(`Unified Python environment not found at ${venvPython}. Run setup first.`);
    return { ok: false, installed: false, skipped: false, fatal: true };
  }
  if (!uvPath) {
    logWarning(`✗ uv not found. ${setupName} setup requires uv.`);
    return { ok: false, installed: false, skipped: false, fatal: true };
  }

  const existingRuntimeCheck = runPythonImportCheckImpl(venvPython, verifyImportScript);
  if (existingRuntimeCheck.ok) {
    return buildSetupResult({ installed: true, skipped: false });
  }

  logArrow(`Installing ${displayName}`);
  if (existingRuntimeCheck.output) {
    logInfo(`${displayName} check failed; reinstalling packages.`);
  }
  logInfo('Streaming uv pip output below.');

  try {
    logInfo(`Installing ${displayName} packages in ${PYTHON_ENV_DIRNAME}...`);
    execFileSyncImpl(uvPath, ['pip', 'install', '--python', venvPython, ...dependencies], {
      cwd: rootDir,
      stdio: 'inherit',
      env: getUvEnv(),
    });

    const installedRuntimeCheck = runPythonImportCheckImpl(venvPython, verifyImportScript);
    if (!installedRuntimeCheck.ok) {
      printCapturedCommandOutputImpl(installedRuntimeCheck);
      throw new Error(installedRuntimeCheck.output || `${setupName} import check failed after install.`);
    }
    logSuccess(`${displayName} installed`);
    return buildSetupResult({ changed: true, installed: true, skipped: false });
  } catch (error) {
    logWarning(`✗ Failed to install ${displayName}`);
    logInfo(manualInstallIntro);
    logInfo(`  "${uvPath}" pip install --python ${PYTHON_ENV_DIRNAME}/bin/python3 ${dependencies.map((dependency) => JSON.stringify(dependency)).join(' ')}`);
    if (!isTruthyEnvValue(env[forceInstallEnv])) {
      logInfo(`Continuing without ${setupName}. Set ${forceInstallEnv}=1 to require it during setup.`);
    }
    return buildOptionalRuntimeInstallFailureImpl({
      forceInstallEnv,
      error,
      env,
    });
  }
}
