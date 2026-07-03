import { delimiter, join } from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';

import { buildSetupResult } from './setupCommandResults.js';
import { PYTHON_ENV_DIRNAME } from './setupParams.js';

const CMEEL_LAYOUT = {
  prefixDirname: 'cmeel.prefix',
  libDirname: 'lib',
};

export function getManagedPythonPath(rootDir) {
  return join(rootDir, PYTHON_ENV_DIRNAME, 'bin', 'python3');
}

export function resolveRosUrdfdomLibPath({ existsSyncImpl = existsSync } = {}) {
  const candidates = [
    '/opt/ros/jazzy/lib/x86_64-linux-gnu',
    '/opt/ros/rolling/lib/x86_64-linux-gnu',
    '/opt/ros/humble/lib/x86_64-linux-gnu',
    '/opt/ros/kilted/lib/x86_64-linux-gnu',
  ];
  for (const dir of candidates) {
    if (existsSyncImpl(join(dir, 'liburdfdom_sensor.so.4.0'))) return dir;
  }
  return null;
}

export function prependNativeLibraryPath(env, libPath) {
  if (!libPath) {
    return env;
  }
  const existingPaths = String(env.LD_LIBRARY_PATH || '')
    .split(delimiter)
    .filter(Boolean)
    .filter((existingPath) => existingPath !== libPath);
  env.LD_LIBRARY_PATH = [libPath, ...existingPaths].join(delimiter);
  return env;
}

export function resolveManagedCmeelLibPathFromSitePackages(
  sitePackagePaths,
  pathExists = existsSync
) {
  for (const sitePackagePath of sitePackagePaths) {
    if (typeof sitePackagePath !== 'string' || sitePackagePath.trim() === '') {
      continue;
    }
    const cmeelLibPath = join(sitePackagePath, CMEEL_LAYOUT.prefixDirname, CMEEL_LAYOUT.libDirname);
    if (pathExists(cmeelLibPath)) {
      return cmeelLibPath;
    }
  }
  return null;
}

export function resolveManagedCmeelLibPath(
  venvPython,
  {
    rootDir = process.cwd(),
    env = process.env,
    existsSyncImpl = existsSync,
    execFileSyncImpl = execFileSync,
  } = {}
) {
  if (!venvPython || !existsSyncImpl(venvPython)) {
    return null;
  }

  const script = [
    'import json',
    'import site',
    'paths = []',
    'for path in site.getsitepackages() + [site.getusersitepackages()]:',
    '    if path and path not in paths:',
    '        paths.append(path)',
    'print(json.dumps(paths))',
  ].join('\n');

  try {
    const output = execFileSyncImpl(venvPython, ['-c', script], {
      cwd: rootDir,
      encoding: 'utf-8',
      env: getUvEnv({ rootDir, env, existsSyncImpl, execFileSyncImpl }),
    }).trim();
    return resolveManagedCmeelLibPathFromSitePackages(JSON.parse(output), existsSyncImpl);
  } catch (_error) {
    return null;
  }
}

export function getUvEnv({
  rootDir = process.cwd(),
  env = process.env,
  managedPythonPath = null,
  existsSyncImpl = existsSync,
  execFileSyncImpl = execFileSync,
} = {}) {
  const uvCacheDir = env.UV_CACHE_DIR || join(rootDir, '.uv-cache');
  const uvEnv = { ...env, UV_CACHE_DIR: uvCacheDir };
  const rosLibPath = resolveRosUrdfdomLibPath({ existsSyncImpl });
  if (rosLibPath) {
    prependNativeLibraryPath(uvEnv, rosLibPath);
  }
  prependNativeLibraryPath(
    uvEnv,
    resolveManagedCmeelLibPath(managedPythonPath, {
      rootDir,
      env,
      existsSyncImpl,
      execFileSyncImpl,
    })
  );
  return uvEnv;
}

export function getConfiguredPythonForBackend({ env = process.env } = {}) {
  if (typeof env.URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON === 'string') {
    return env.URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON.trim();
  }
  return '';
}

export function isSupportedPythonExecutable(
  candidate,
  { execFileSyncImpl = execFileSync } = {}
) {
  try {
    const version = execFileSyncImpl(
      candidate,
      ['-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'],
      { encoding: 'utf-8' }
    ).trim();
    const [major, minor] = version.split('.').map(Number);
    return major > 3 || (major === 3 && minor >= 12);
  } catch (_error) {
    return false;
  }
}

export function findPythonForBackend({
  env = process.env,
  execFileSyncImpl = execFileSync,
} = {}) {
  const configuredPython = getConfiguredPythonForBackend({ env });
  if (!configuredPython) {
    return null;
  }
  return isSupportedPythonExecutable(configuredPython, { execFileSyncImpl })
    ? configuredPython
    : null;
}

export function resolvePythonForBackendVenv({
  env = process.env,
  execFileSyncImpl = execFileSync,
} = {}) {
  const configuredPython = getConfiguredPythonForBackend({ env });
  if (!configuredPython) {
    return {
      python: '3.12',
      usesUvManagedPython: true,
    };
  }

  const pythonPath = findPythonForBackend({ env, execFileSyncImpl });
  if (pythonPath) {
    return {
      python: pythonPath,
      usesUvManagedPython: false,
    };
  }
  return null;
}

export function logPythonBootstrapHelp({ logInfo = () => {} } = {}) {
  logInfo('Use uv for Python 3.12: uv python install 3.12');
  logInfo('Then rerun: npm run setup');
  logInfo('Optional manual override: URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON=/path/to/python3.12');
}

export async function setupPythonBackendEnvironment({
  rootDir = process.cwd(),
  findUv = () => null,
  getManagedPythonPathImpl = getManagedPythonPath,
  resolvePythonForBackendVenvImpl = resolvePythonForBackendVenv,
  getUvEnvImpl = getUvEnv,
  existsSyncImpl = existsSync,
  execFileSyncImpl = execFileSync,
  logArrow = () => {},
  logInfo = () => {},
  logSuccess = () => {},
  logWarning = () => {},
} = {}) {
  const venvPath = join(rootDir, PYTHON_ENV_DIRNAME);
  const venvPython = getManagedPythonPathImpl(rootDir);
  const uvPath = findUv();
  if (!uvPath) {
    logWarning('✗ uv not found. Please install uv first:');
    logWarning('');
    logInfo('Install uv with:');
    logInfo('  curl -LsSf https://astral.sh/uv/install.sh | sh');
    logWarning('');
    return buildSetupResult({ ok: false });
  }

  if (existsSyncImpl(venvPython)) {
    return buildSetupResult();
  }

  const pythonResolution = resolvePythonForBackendVenvImpl();
  if (!pythonResolution) {
    logWarning('✗ URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON must point to Python 3.12+.');
    logPythonBootstrapHelp({ logInfo });
    return buildSetupResult({ ok: false });
  }

  logArrow('Setting up Python backend');
  if (pythonResolution.usesUvManagedPython) {
    logInfo('Using uv-managed Python 3.12 for the unified runtime.');
  }

  logInfo(`Creating ${venvPath} with ${pythonResolution.python}`);
  try {
    execFileSyncImpl(uvPath, ['venv', '--python', pythonResolution.python, venvPath], {
      cwd: rootDir,
      stdio: 'inherit',
      env: getUvEnvImpl({ rootDir }),
    });
    logSuccess('Python backend environment ready');
    return buildSetupResult({ changed: true });
  } catch (_error) {
    logWarning('✗ Failed to create unified Python environment');
    logPythonBootstrapHelp({ logInfo });
    return buildSetupResult({ ok: false });
  }
}

export function listInstalledPythonPackageNames(
  venvPython,
  {
    rootDir = process.cwd(),
    spawnSyncImpl = spawnSync,
  } = {}
) {
  const script = [
    'import importlib.metadata as metadata',
    'import json',
    'names = []',
    'for distribution in metadata.distributions():',
    '    name = distribution.metadata.get("Name")',
    '    if name:',
    '        names.append(name)',
    'print(json.dumps(names))',
  ].join('\n');

  const result = spawnSyncImpl(venvPython, ['-c', script], {
    cwd: rootDir,
    encoding: 'utf-8',
  });

  if (result.status !== 0 || !result.stdout) {
    const stderr = String(result.stderr || '').trim();
    throw new Error(stderr || 'Installed Python package inspection failed');
  }

  return JSON.parse(result.stdout);
}

export function runPythonImportCheck(
  venvPython,
  script,
  {
    rootDir = process.cwd(),
    env = process.env,
    spawnSyncImpl = spawnSync,
    existsSyncImpl = existsSync,
    execFileSyncImpl = execFileSync,
  } = {}
) {
  const result = spawnSyncImpl(venvPython, ['-c', script], {
    cwd: rootDir,
    encoding: 'utf-8',
    env: getUvEnv({
      rootDir,
      env,
      managedPythonPath: venvPython,
      existsSyncImpl,
      execFileSyncImpl,
    }),
  });
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  return {
    ok: result.status === 0,
    stdout,
    stderr,
    output: [stdout, stderr].filter(Boolean).join('\n'),
  };
}
