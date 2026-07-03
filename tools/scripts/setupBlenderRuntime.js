import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'fs';
import { dirname, join } from 'path';
import { execFileSync, spawnSync } from 'child_process';

import {
  BLENDER_FORCE_INSTALL_ENV,
  BLENDER_PATH_ENV,
  BLENDER_SETUP,
  BLENDER_SKIP_AUTO_INSTALL_ENV,
} from './setupParams.js';
import { isTruthyEnvValue } from './setupHelpers.js';
import {
  buildOptionalRuntimeInstallFailure,
  buildSetupResult,
} from './setupCommandResults.js';
import { buildSimulatorCompatibilityInstallResult } from './setupSimulatorInstallCompatibility.js';

export function getManagedBlenderRuntimeRoot(rootDir) {
  return join(rootDir, '.cache', 'blender-runtime');
}

export function getManagedBlenderExecutablePath(rootDir, { platform = process.platform } = {}) {
  return join(
    getManagedBlenderRuntimeRoot(rootDir),
    `blender-${BLENDER_SETUP.portableVersion}-${BLENDER_SETUP.portablePlatform}`,
    platform === 'win32' ? 'blender.exe' : 'blender'
  );
}

export function isExecutableFile(
  filePath,
  { platform = process.platform, statSyncImpl = statSync } = {}
) {
  try {
    const stats = statSyncImpl(filePath);
    if (!stats.isFile()) return false;
    if (stats.size <= 0) return false;
    return platform === 'win32' || (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export function findExecutableInPath(
  name,
  {
    env = process.env,
    platform = process.platform,
    statSyncImpl = statSync,
  } = {}
) {
  const pathDelimiter = platform === 'win32' ? ';' : ':';
  for (const directory of String(env.PATH || '').split(pathDelimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    if (isExecutableFile(candidate, { platform, statSyncImpl })) {
      return candidate;
    }
  }
  return null;
}

export function resolveBlenderCandidate(
  candidate,
  {
    env = process.env,
    platform = process.platform,
    statSyncImpl = statSync,
  } = {}
) {
  const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
  if (!trimmed) return null;
  if (platform !== 'win32' && trimmed.toLowerCase().endsWith('.exe')) {
    return null;
  }
  if (trimmed.endsWith('.app')) {
    const appBinary = join(trimmed, 'Contents', 'MacOS', 'Blender');
    return isExecutableFile(appBinary, { platform, statSyncImpl }) ? appBinary : null;
  }
  try {
    const stats = statSyncImpl(trimmed);
    if (stats.isDirectory()) {
      const executableName = platform === 'win32' ? 'blender.exe' : 'blender';
      const executablePath = join(trimmed, executableName);
      return isExecutableFile(executablePath, { platform, statSyncImpl }) ? executablePath : null;
    }
  } catch {
    // Try direct file and PATH resolution below.
  }
  if (isExecutableFile(trimmed, { platform, statSyncImpl })) return trimmed;
  return findExecutableInPath(trimmed, { env, platform, statSyncImpl });
}

export function verifyBlenderExecutable(
  executablePath,
  {
    rootDir = process.cwd(),
    spawnSyncImpl = spawnSync,
  } = {}
) {
  const result = spawnSyncImpl(
    executablePath,
    ['--background', '--python-expr', 'import bpy; print("blender python runtime ok")'],
    {
      cwd: rootDir,
      encoding: 'utf-8',
      timeout: 15000,
    }
  );
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  return result.status === 0 && output.includes('blender python runtime ok');
}

export function resolveBlenderExecutableForSetup({
  rootDir = process.cwd(),
  env = process.env,
  platform = process.platform,
  statSyncImpl = statSync,
  verifyExecutable = (executablePath) =>
    verifyBlenderExecutable(executablePath, { rootDir }),
} = {}) {
  const executableName = platform === 'win32' ? 'blender.exe' : 'blender';
  const configuredPath = typeof env[BLENDER_PATH_ENV] === 'string'
    ? env[BLENDER_PATH_ENV].trim()
    : '';
  if (configuredPath) {
    const resolved = resolveBlenderCandidate(configuredPath, { env, platform, statSyncImpl });
    return resolved && verifyExecutable(resolved) ? resolved : null;
  }
  const candidates = [
    getManagedBlenderExecutablePath(rootDir, { platform }),
    executableName,
    platform === 'darwin' ? '/Applications/Blender.app' : '',
  ];
  for (const candidate of candidates) {
    const resolved = resolveBlenderCandidate(candidate, { env, platform, statSyncImpl });
    if (resolved && verifyExecutable(resolved)) {
      return resolved;
    }
  }
  return null;
}

export function shouldInstallBlenderRuntime({ env = process.env } = {}) {
  if (isTruthyEnvValue(env[BLENDER_SKIP_AUTO_INSTALL_ENV])) {
    return false;
  }
  if (isTruthyEnvValue(env[BLENDER_FORCE_INSTALL_ENV])) {
    return true;
  }
  return true;
}

export function installManagedLinuxBlenderRuntime({
  rootDir = process.cwd(),
  platform = process.platform,
  arch = process.arch,
  existsSyncImpl = existsSync,
  mkdirSyncImpl = mkdirSync,
  rmSyncImpl = rmSync,
  renameSyncImpl = renameSync,
  chmodSyncImpl = chmodSync,
  execFileSyncImpl = execFileSync,
  verifyBlenderExecutableImpl = (executablePath) =>
    verifyBlenderExecutable(executablePath, { rootDir }),
  getManagedBlenderRuntimeRootImpl = getManagedBlenderRuntimeRoot,
  getManagedBlenderExecutablePathImpl = getManagedBlenderExecutablePath,
  logInfo = () => {},
} = {}) {
  if (platform !== 'linux' || arch !== 'x64') {
    throw new Error('Managed Blender install is currently available for Linux x64 only.');
  }

  const runtimeRoot = getManagedBlenderRuntimeRootImpl(rootDir);
  const executablePath = getManagedBlenderExecutablePathImpl(rootDir, { platform });
  const runtimeDir = dirname(executablePath);
  if (verifyBlenderExecutableImpl(executablePath)) {
    return executablePath;
  }

  const downloadsDir = join(runtimeRoot, 'downloads');
  const archivePath = join(downloadsDir, BLENDER_SETUP.portableArchive);
  const archiveTempPath = `${archivePath}.tmp`;
  mkdirSyncImpl(downloadsDir, { recursive: true });
  if (!existsSyncImpl(archivePath)) {
    rmSyncImpl(archiveTempPath, { force: true });
    logInfo(`Downloading Blender ${BLENDER_SETUP.portableVersion} LTS for Linux x64...`);
    execFileSyncImpl(
      'curl',
      [
        '-fL',
        '--retry',
        '3',
        '--connect-timeout',
        '20',
        '--output',
        archiveTempPath,
        BLENDER_SETUP.portableDownloadUrl,
      ],
      {
        cwd: rootDir,
        stdio: 'inherit',
      }
    );
    renameSyncImpl(archiveTempPath, archivePath);
  }

  rmSyncImpl(runtimeDir, { recursive: true, force: true });
  logInfo(`Extracting Blender into ${runtimeRoot}...`);
  execFileSyncImpl('tar', ['-xJf', archivePath, '-C', runtimeRoot], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  chmodSyncImpl(executablePath, 0o755);
  if (!verifyBlenderExecutableImpl(executablePath)) {
    throw new Error('Managed Blender executable failed its version check after extraction.');
  }
  return executablePath;
}

export async function installBlenderRuntime(
  simulatorCompatibilityReport = null,
  {
    rootDir = process.cwd(),
    env = process.env,
    resolveBlenderExecutableForSetupImpl = resolveBlenderExecutableForSetup,
    shouldInstallBlenderRuntimeImpl = shouldInstallBlenderRuntime,
    installManagedLinuxBlenderRuntimeImpl = installManagedLinuxBlenderRuntime,
    buildCompatibilityResult = buildSimulatorCompatibilityInstallResult,
    buildOptionalRuntimeInstallFailureImpl = buildOptionalRuntimeInstallFailure,
    logArrow = () => {},
    logInfo = () => {},
    logSuccess = () => {},
    logWarning = () => {},
  } = {}
) {
  const existingExecutable = resolveBlenderExecutableForSetupImpl({ rootDir, env });
  if (existingExecutable) {
    return buildSetupResult({
      installed: true,
      skipped: false,
      executable: existingExecutable,
    });
  }

  if (!shouldInstallBlenderRuntimeImpl({ env })) {
    return buildSetupResult({ installed: false, skipped: true });
  }

  const compatibilityResult = buildCompatibilityResult({
    simulatorCompatibilityReport,
    simulatorId: 'blender',
    setupName: 'Blender',
    forceInstallEnv: BLENDER_FORCE_INSTALL_ENV,
    env,
    logWarning,
    logInfo,
  });
  if (compatibilityResult) {
    return compatibilityResult;
  }

  try {
    logArrow('Installing Blender workspace runtime');
    const executable = installManagedLinuxBlenderRuntimeImpl({ rootDir, env, logInfo });
    logSuccess(`Blender workspace runtime installed: ${executable}`);
    return buildSetupResult({
      changed: true,
      installed: true,
      skipped: false,
      executable,
    });
  } catch (error) {
    logWarning('✗ Failed to install Blender workspace runtime');
    logInfo(error?.message || String(error));
    logInfo(`Set ${BLENDER_PATH_ENV}=/path/to/blender if Blender is already installed.`);
    if (!isTruthyEnvValue(env[BLENDER_FORCE_INSTALL_ENV])) {
      logInfo(`Continuing without Blender. Set ${BLENDER_FORCE_INSTALL_ENV}=1 to require it during setup.`);
    }
    return buildOptionalRuntimeInstallFailureImpl({
      forceInstallEnv: BLENDER_FORCE_INSTALL_ENV,
      error,
      env,
    });
  }
}
