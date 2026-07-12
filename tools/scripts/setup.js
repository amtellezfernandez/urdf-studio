#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve } from 'path';
import {
  formatSimulatorCompatibilitySummary,
  getSimulatorCompatibilityReport,
} from './simulatorCompatibility.js';
import {
  applySetupProfileFlags,
  buildSetupRoadmapSections,
  buildSetupSummarySections,
} from './setupHelpers.js';
import {
  buildSetupResult,
  didSpawnSyncFail,
} from './setupCommandResults.js';
import {
  installBlenderRuntime as installBlenderRuntimeWithOptions,
  resolveBlenderExecutableForSetup as resolveBlenderExecutableForSetupWithOptions,
} from './setupBlenderRuntime.js';
import {
  findPythonForBackend as findPythonForBackendWithOptions,
  getManagedPythonPath as getManagedPythonPathForRoot,
  getUvEnv as getUvEnvWithOptions,
  prependNativeLibraryPath,
  resolveManagedCmeelLibPathFromSitePackages,
  resolvePythonForBackendVenv as resolvePythonForBackendVenvWithOptions,
  setupPythonBackendEnvironment as setupPythonBackendEnvironmentWithOptions,
} from './setupPythonRuntime.js';
import {
  installGenesisRuntime as installGenesisRuntimeWithOptions,
  installMjlabRuntime as installMjlabRuntimeWithOptions,
  installPybulletRuntime as installPybulletRuntimeWithOptions,
} from './setupPythonRuntimes.js';
import { installBackendDeps as installBackendDepsWithOptions } from './setupBackendPythonRuntime.js';
import {
  installSimulatorContainers as installSimulatorContainersWithOptions,
  simulatorContainerImageExists as simulatorContainerImageExistsWithOptions,
} from './setupSimulatorContainers.js';
import {
  installDependencies as installDependenciesWithOptions,
  installOptionalGlobalIlu as installOptionalGlobalIluWithOptions,
  installTwinDepsIfRequested as installTwinDepsIfRequestedWithOptions,
} from './setupNodeRuntime.js';
import {
  assertIluRuntimeContract,
  verifyIluRuntimeContract as verifyIluRuntimeContractWithOptions,
} from './setupIluRuntime.js';
import {
  checkIkd as checkIkdWithOptions,
  findUv as findUvWithOptions,
} from './setupToolchainRuntime.js';
import {
  loadAppConfig as loadAppConfigWithOptions,
  setupGitHub as setupGitHubWithOptions,
  setupHuggingFace as setupHuggingFaceWithOptions,
} from './setupAuthConfig.js';
import { runSetupSequence as runSetupSequenceWithSteps } from './setupSequence.js';
import { createTerminalLogger } from './terminalOutput.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..', '..');

const { colors, log, logArrow, logInfo, logSuccess, logUrl } = createTerminalLogger();

function getUvEnv({ managedPythonPath = null } = {}) {
  return getUvEnvWithOptions({ rootDir, managedPythonPath });
}

async function installDependencies() {
  return installDependenciesWithOptions({
    rootDir,
    logArrow,
    logInfo,
    logSuccess,
    logWarning: (message) => log(message, colors.yellow),
  });
}

async function verifyIluRuntimeContract() {
  return verifyIluRuntimeContractWithOptions({
    logArrow,
    logSuccess,
    logWarning: (message) => log(message, colors.yellow),
    logInfo,
  });
}

function loadAppConfig() {
  return loadAppConfigWithOptions(rootDir);
}

async function setupHuggingFace() {
  return setupHuggingFaceWithOptions({
    rootDir,
    colors,
    log,
    logArrow,
    logInfo,
    logSuccess,
    logUrl,
  });
}

async function setupGitHub() {
  return setupGitHubWithOptions({
    rootDir,
    colors,
    log,
    logArrow,
    logInfo,
    logSuccess,
    logUrl,
  });
}

async function installOptionalGlobalIlu() {
  return installOptionalGlobalIluWithOptions({
    rootDir,
    log,
    logArrow,
    logSuccess,
    logInfo,
    warningColor: colors.yellow,
  });
}

function findUv() {
  return findUvWithOptions();
}

async function checkIkd() {
  return checkIkdWithOptions({
    rootDir,
    loadAppConfig,
    logArrow,
    logInfo,
    logSuccess,
    logWarning: (message) => log(message, colors.yellow),
  });
}

function getManagedPythonPath() {
  return getManagedPythonPathForRoot(rootDir);
}

async function setupPythonBackendEnvironment() {
  return setupPythonBackendEnvironmentWithOptions({
    rootDir,
    findUv,
    getUvEnv,
    logArrow,
    logInfo,
    logSuccess,
    logWarning: (message) => log(message, colors.yellow),
  });
}

function findPythonForBackend() {
  return findPythonForBackendWithOptions();
}

function resolvePythonForBackendVenv() {
  return resolvePythonForBackendVenvWithOptions();
}

function resolveBlenderExecutableForSetup() {
  return resolveBlenderExecutableForSetupWithOptions({ rootDir });
}

async function installBlenderRuntime(simulatorCompatibilityReport = null) {
  return installBlenderRuntimeWithOptions(simulatorCompatibilityReport, {
    rootDir,
    env: process.env,
    logArrow,
    logInfo,
    logSuccess,
    logWarning: (message) => log(message, colors.yellow),
  });
}

function checkSimulatorCompatibility() {
  logArrow('Checking simulator compatibility');
  const report = getSimulatorCompatibilityReport({
    pythonExecutable: getManagedPythonPath(),
  });
  for (const line of formatSimulatorCompatibilitySummary(report)) {
    logInfo(line);
  }
  return buildSetupResult({ report });
}

function pythonRuntimeInstallOptions() {
  return {
    rootDir,
    env: process.env,
    platform: process.platform,
    getManagedPythonPath,
    getUvEnv,
    logArrow,
    logInfo,
    logSuccess,
    logWarning: (message) => log(message, colors.yellow),
  };
}

async function installBackendDeps(simulatorCompatibilityReport = null) {
  return installBackendDepsWithOptions(
    simulatorCompatibilityReport,
    pythonRuntimeInstallOptions()
  );
}

async function installGenesisRuntime(simulatorCompatibilityReport = null) {
  return installGenesisRuntimeWithOptions(
    simulatorCompatibilityReport,
    pythonRuntimeInstallOptions()
  );
}

async function installPybulletRuntime(simulatorCompatibilityReport = null) {
  return installPybulletRuntimeWithOptions(
    simulatorCompatibilityReport,
    pythonRuntimeInstallOptions()
  );
}

async function installMjlabRuntime(simulatorCompatibilityReport = null) {
  return installMjlabRuntimeWithOptions(
    simulatorCompatibilityReport,
    pythonRuntimeInstallOptions()
  );
}

async function installSimulatorContainers(
  simulatorCompatibilityReport = null,
  options = {}
) {
  return installSimulatorContainersWithOptions(simulatorCompatibilityReport, {
    ...options,
    rootDir: options.rootDir || rootDir,
    logArrow,
    logInfo,
    logSuccess,
    logWarning: (message) => log(message, colors.yellow),
  });
}

function simulatorContainerImageExists(image, options = {}) {
  return simulatorContainerImageExistsWithOptions(image, {
    ...options,
    rootDir: options.rootDir || rootDir,
  });
}

function renderSetupSections(
  sections = [],
  {
    logImpl = log,
    logArrowImpl = logArrow,
    logInfoImpl = logInfo,
  } = {}
) {
  for (const section of sections) {
    logImpl('');
    logArrowImpl(section.heading);
    for (const line of section.lines || []) {
      logInfoImpl(line);
    }
  }
}

async function installTwinDepsIfRequested() {
  return installTwinDepsIfRequestedWithOptions({
    rootDir,
    log,
    logArrow,
    warningColor: colors.yellow,
  });
}

function buildSetupSteps() {
  return {
    installDependencies,
    verifyIluRuntimeContract,
    setupPythonBackendEnvironment,
    checkSimulatorCompatibility,
    installBackendDeps,
    installGenesisRuntime,
    installMjlabRuntime,
    installPybulletRuntime,
    installBlenderRuntime,
    installSimulatorContainers,
    installTwinDepsIfRequested,
    checkIkd,
    setupHuggingFace,
    setupGitHub,
    installOptionalGlobalIlu,
  };
}

async function runSetupSequence(overrides = {}) {
  return runSetupSequenceWithSteps(buildSetupSteps(), overrides);
}

async function main() {
  try {
    const setupProfiles = applySetupProfileFlags();
    logArrow('URDF Studio setup');
    logInfo('Default install: node_modules, .venv, backend Python packages, and MJLab when compatible.');
    logInfo('Simulator work: npm run setup:simulators installs Blender, Genesis, and PyBullet local runtimes.');
    logInfo('Containerized simulators: npm run setup:simulator-containers builds Docker images only when needed.');
    if (setupProfiles.localSimulators) {
      logInfo('Setup profile enabled: local simulator runtimes.');
    }
    if (setupProfiles.simulatorContainers) {
      logInfo('Setup profile enabled: container simulator images.');
    }
    logInfo('npm and uv commands stream live output below so long installs do not look stalled.');
    renderSetupSections(buildSetupRoadmapSections());
    const setupResult = await runSetupSequence();
    renderSetupSections(buildSetupSummarySections({
      globalIluAttempted: setupResult.globalIluResult?.attempted,
      globalIluInstalled: setupResult.globalIluResult?.installed,
      genesisRuntimeResult: setupResult.genesisRuntimeResult,
      mjlabRuntimeResult: setupResult.mjlabRuntimeResult,
      pybulletRuntimeResult: setupResult.pybulletRuntimeResult,
      blenderRuntimeResult: setupResult.blenderRuntimeResult,
      simulatorContainerResult: setupResult.simulatorContainerResult,
    }));
    const { changed } = setupResult;
    logSuccess(changed ? 'Setup complete' : 'All up to date');
    logInfo('Run: npm run start');
  } catch (error) {
    log('');
    log('✗ Setup failed', colors.yellow);
    if (error?.message) {
      logInfo(error.message);
    }
    process.exit(1);
  }
}

function isMainModule() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href);
}

if (isMainModule()) {
  main();
}

export {
  assertIluRuntimeContract,
  checkSimulatorCompatibility,
  didSpawnSyncFail,
  findPythonForBackend,
  installBlenderRuntime,
  installSimulatorContainers,
  prependNativeLibraryPath,
  simulatorContainerImageExists,
  resolveBlenderExecutableForSetup,
  resolveManagedCmeelLibPathFromSitePackages,
  resolvePythonForBackendVenv,
  renderSetupSections,
  runSetupSequence,
  verifyIluRuntimeContract,
};
