import {
  installOptionalPythonRuntime,
  shouldInstallOptionalPythonRuntime,
} from './setupOptionalPythonRuntime.js';
import {
  GENESIS_FORCE_INSTALL_ENV,
  GENESIS_PYTHON_DEPENDENCIES,
  GENESIS_SKIP_AUTO_INSTALL_ENV,
  GENESIS_VERIFY_IMPORT_SCRIPT,
  MJLAB_DEPENDENCIES,
  MJLAB_FORCE_INSTALL_ENV,
  MJLAB_SKIP_AUTO_INSTALL_ENV,
  MJLAB_VERIFY_IMPORT_SCRIPT,
  MJX_DEPENDENCIES,
  PYBULLET_DEPENDENCIES,
  PYBULLET_FORCE_INSTALL_ENV,
  PYBULLET_SKIP_AUTO_INSTALL_ENV,
  PYBULLET_VERIFY_IMPORT_SCRIPT,
} from './setupParams.js';

export function shouldInstallGenesisRuntime({
  env = process.env,
  platform = process.platform,
} = {}) {
  return shouldInstallOptionalPythonRuntime({
    skipAutoInstallEnv: GENESIS_SKIP_AUTO_INSTALL_ENV,
    forceInstallEnv: GENESIS_FORCE_INSTALL_ENV,
    defaultInstall: platform !== 'win32',
    env,
  });
}

export function shouldInstallPybulletRuntime({
  env = process.env,
  platform = process.platform,
} = {}) {
  return shouldInstallOptionalPythonRuntime({
    skipAutoInstallEnv: PYBULLET_SKIP_AUTO_INSTALL_ENV,
    forceInstallEnv: PYBULLET_FORCE_INSTALL_ENV,
    defaultInstall: platform !== 'darwin',
    env,
  });
}

export function shouldInstallMjlabRuntime({
  env = process.env,
  platform = process.platform,
} = {}) {
  return shouldInstallOptionalPythonRuntime({
    skipAutoInstallEnv: MJLAB_SKIP_AUTO_INSTALL_ENV,
    forceInstallEnv: MJLAB_FORCE_INSTALL_ENV,
    defaultInstall: platform !== 'win32',
    env,
  });
}

export async function installPybulletRuntime(simulatorCompatibilityReport = null, options = {}) {
  return installOptionalPythonRuntime({
    shouldInstall: shouldInstallPybulletRuntime,
    displayName: 'PyBullet workspace adapter runtime',
    setupName: 'PyBullet',
    simulatorId: 'pybullet',
    simulatorCompatibilityReport,
    dependencies: PYBULLET_DEPENDENCIES,
    verifyImportScript: PYBULLET_VERIFY_IMPORT_SCRIPT,
    forceInstallEnv: PYBULLET_FORCE_INSTALL_ENV,
  }, options);
}

export async function installMjlabRuntime(simulatorCompatibilityReport = null, options = {}) {
  return installOptionalPythonRuntime({
    shouldInstall: shouldInstallMjlabRuntime,
    displayName: 'MJLab validation runtime',
    setupName: 'MJLab',
    simulatorId: 'mjlab',
    simulatorCompatibilityReport,
    dependencies: MJLAB_DEPENDENCIES,
    verifyImportScript: MJLAB_VERIFY_IMPORT_SCRIPT,
    forceInstallEnv: MJLAB_FORCE_INSTALL_ENV,
    manualInstallIntro: 'Try manually in a compatible Python environment:',
  }, options);
}

export async function installGenesisRuntime(simulatorCompatibilityReport = null, options = {}) {
  return installOptionalPythonRuntime({
    shouldInstall: shouldInstallGenesisRuntime,
    displayName: 'Genesis workspace adapter runtime',
    setupName: 'Genesis',
    simulatorId: 'genesis',
    simulatorCompatibilityReport,
    dependencies: GENESIS_PYTHON_DEPENDENCIES,
    verifyImportScript: GENESIS_VERIFY_IMPORT_SCRIPT,
    forceInstallEnv: GENESIS_FORCE_INSTALL_ENV,
    manualInstallIntro: 'Try manually on a compatible Linux environment:',
  }, options);
}
