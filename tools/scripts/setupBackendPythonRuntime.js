import { existsSync } from 'fs';
import { execFileSync } from 'child_process';

import {
  getSimulatorCompatibilityTarget,
  isManagedSimulatorInstallAllowed,
} from './simulatorCompatibility.js';
import {
  selectInstalledSupersededPythonDependencies,
  isTruthyEnvValue,
} from './setupHelpers.js';
import {
  buildSetupResult,
  printCapturedCommandOutput,
} from './setupCommandResults.js';
import { formatSimulatorInstallBlock } from './setupSimulatorInstallCompatibility.js';
import {
  listInstalledPythonPackageNames,
  runPythonImportCheck,
} from './setupPythonRuntime.js';
import { findUv } from './setupToolchainRuntime.js';
import {
  BACKEND_COLLISION_STACK_FORCE_ENV,
  BACKEND_COLLISION_STACK_SKIP_ENV,
  BACKEND_PYTHON_CORE_VERIFY_IMPORT_SCRIPT,
  BACKEND_PYTHON_JAX_DEPENDENCIES,
  BACKEND_PYTHON_NATIVE_SIM_VERIFY_IMPORT_SCRIPT,
  BACKEND_PYTHON_PLACO_DEPENDENCIES,
  BACKEND_PYTHON_PORTABLE_DEPENDENCIES,
  BACKEND_PYTHON_PORTABLE_VERIFY_IMPORT_SCRIPT,
  BACKEND_NATIVE_SIM_FORCE_ENV,
  BACKEND_NATIVE_SIM_SKIP_ENV,
  BACKEND_PYTHON_SUPERSEDED_DEPENDENCIES,
  MJX_DEPENDENCIES,
  PYTHON_ENV_DIRNAME,
} from './setupParams.js';

export function shouldInstallBackendNativeSimRuntime({
  env = process.env,
  platform = process.platform,
  simulatorCompatibilityReport = null,
  managedInstallAllowed = isManagedSimulatorInstallAllowed,
} = {}) {
  if (isTruthyEnvValue(env[BACKEND_NATIVE_SIM_SKIP_ENV])) {
    return false;
  }
  if (isTruthyEnvValue(env[BACKEND_NATIVE_SIM_FORCE_ENV])) {
    return true;
  }
  return platform !== 'darwin' && managedInstallAllowed(simulatorCompatibilityReport, 'mjx');
}

export function shouldInstallBackendCollisionStack({
  env = process.env,
  platform = process.platform,
} = {}) {
  if (isTruthyEnvValue(env[BACKEND_COLLISION_STACK_SKIP_ENV])) {
    return false;
  }
  if (isTruthyEnvValue(env[BACKEND_COLLISION_STACK_FORCE_ENV])) {
    return true;
  }
  return platform !== 'darwin';
}

export function resolveBackendPythonDependencies({
  env = process.env,
  platform = process.platform,
  simulatorCompatibilityReport = null,
  managedInstallAllowed = isManagedSimulatorInstallAllowed,
} = {}) {
  const baseDependencies = [...BACKEND_PYTHON_PORTABLE_DEPENDENCIES];
  if (shouldInstallBackendCollisionStack({ env, platform })) {
    baseDependencies.push(...BACKEND_PYTHON_PLACO_DEPENDENCIES);
  }
  if (
    !shouldInstallBackendNativeSimRuntime({
      env,
      platform,
      simulatorCompatibilityReport,
      managedInstallAllowed,
    })
  ) {
    return baseDependencies;
  }
  return [
    ...baseDependencies,
    ...BACKEND_PYTHON_JAX_DEPENDENCIES,
    ...MJX_DEPENDENCIES,
  ];
}

export function resolveBackendPythonVerifyImportScript({
  env = process.env,
  platform = process.platform,
  simulatorCompatibilityReport = null,
  managedInstallAllowed = isManagedSimulatorInstallAllowed,
} = {}) {
  const portableScript = shouldInstallBackendCollisionStack({ env, platform })
    ? BACKEND_PYTHON_PORTABLE_VERIFY_IMPORT_SCRIPT
    : BACKEND_PYTHON_CORE_VERIFY_IMPORT_SCRIPT;
  if (
    !shouldInstallBackendNativeSimRuntime({
      env,
      platform,
      simulatorCompatibilityReport,
      managedInstallAllowed,
    })
  ) {
    return portableScript;
  }
  return [portableScript, BACKEND_PYTHON_NATIVE_SIM_VERIFY_IMPORT_SCRIPT].join('\n');
}

export function shouldBlockForcedBackendNativeSimRuntime({
  env = process.env,
  simulatorCompatibilityReport = null,
  managedInstallAllowed = isManagedSimulatorInstallAllowed,
} = {}) {
  return (
    isTruthyEnvValue(env[BACKEND_NATIVE_SIM_FORCE_ENV]) &&
    !managedInstallAllowed(simulatorCompatibilityReport, 'mjx')
  );
}

export async function installBackendDeps(
  simulatorCompatibilityReport = null,
  {
    rootDir = process.cwd(),
    env = process.env,
    platform = process.platform,
    getManagedPythonPath,
    findUvImpl = findUv,
    existsSyncImpl = existsSync,
    execFileSyncImpl = execFileSync,
    getUvEnv = () => env,
    runPythonImportCheckImpl = runPythonImportCheck,
    listInstalledPythonPackageNamesImpl = listInstalledPythonPackageNames,
    managedInstallAllowed = isManagedSimulatorInstallAllowed,
    getCompatibilityTarget = getSimulatorCompatibilityTarget,
    selectInstalledSupersededPythonDependenciesImpl = selectInstalledSupersededPythonDependencies,
    printCapturedCommandOutputImpl = printCapturedCommandOutput,
    logArrow = () => {},
    logInfo = () => {},
    logSuccess = () => {},
    logWarning = () => {},
  } = {}
) {
  const venvPython = getManagedPythonPath();
  const uvPath = findUvImpl({ env });
  logArrow('Checking backend Python runtime');

  if (!existsSyncImpl(venvPython)) {
    logInfo(`Unified Python environment not found at ${venvPython}. Run setup first.`);
    return buildSetupResult({ ok: false });
  }
  if (!uvPath) {
    logWarning('✗ uv not found. Please install uv first:');
    return buildSetupResult({ ok: false });
  }

  if (
    shouldBlockForcedBackendNativeSimRuntime({
      env,
      simulatorCompatibilityReport,
      managedInstallAllowed,
    })
  ) {
    const target = getCompatibilityTarget(simulatorCompatibilityReport, 'mjx');
    logWarning('✗ Native simulator dependencies are not compatible with this machine');
    logInfo(formatSimulatorInstallBlock(target));
    return buildSetupResult({ ok: false });
  }

  const backendPythonDependencies = resolveBackendPythonDependencies({
    env,
    platform,
    simulatorCompatibilityReport,
    managedInstallAllowed,
  });
  const backendVerifyImportScript = resolveBackendPythonVerifyImportScript({
    env,
    platform,
    simulatorCompatibilityReport,
    managedInstallAllowed,
  });

  let changed = false;
  try {
    const installedPackageNames = listInstalledPythonPackageNamesImpl(venvPython);
    const installedSupersededDependencies = selectInstalledSupersededPythonDependenciesImpl({
      supersededDependencies: BACKEND_PYTHON_SUPERSEDED_DEPENDENCIES,
      installedPackageNames,
    });

    if (installedSupersededDependencies.length > 0) {
      logInfo(`Removing superseded backend packages: ${installedSupersededDependencies.join(', ')}`);
      execFileSyncImpl(
        uvPath,
        ['pip', 'uninstall', '--python', venvPython, ...installedSupersededDependencies],
        {
          cwd: rootDir,
          stdio: 'inherit',
          env: getUvEnv(),
        }
      );
      changed = true;
    }
  } catch (_error) {
    if (changed) {
      logInfo('Continuing after superseded backend package cleanup could not inspect or remove superseded packages.');
    }
  }

  const existingBackendCheck = runPythonImportCheckImpl(venvPython, backendVerifyImportScript);
  if (existingBackendCheck.ok) {
    logSuccess('Backend Python runtime ready');
    return buildSetupResult({ changed });
  }
  logInfo('Installing or repairing backend Python packages...');
  logInfo(`Installing: ${backendPythonDependencies.join(', ')}`);
  logInfo('Streaming uv pip output below.');

  try {
    execFileSyncImpl(uvPath, ['pip', 'install', '--python', venvPython, ...backendPythonDependencies], {
      cwd: rootDir,
      stdio: 'inherit',
      env: getUvEnv(),
    });
    logInfo('Verifying backend Python runtime...');
    const installedBackendCheck = runPythonImportCheckImpl(venvPython, backendVerifyImportScript);
    if (!installedBackendCheck.ok) {
      printCapturedCommandOutputImpl(installedBackendCheck);
      throw new Error(installedBackendCheck.output || 'Backend Python import check failed after install.');
    }
    logSuccess('Backend dependencies installed');
    return buildSetupResult({ changed: true });
  } catch (_error) {
    logWarning('✗ Failed to install backend dependencies');
    logInfo('   You can try installing manually:');
    logInfo(`     "${uvPath}" pip install --python ${PYTHON_ENV_DIRNAME}/bin/python3 ${backendPythonDependencies.map((dependency) => JSON.stringify(dependency)).join(' ')}`);
    return buildSetupResult({ ok: false, changed });
  }
}
