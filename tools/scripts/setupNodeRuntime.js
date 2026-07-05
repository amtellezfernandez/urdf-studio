import { existsSync } from 'fs';
import { join } from 'path';
import { execFileSync, spawnSync } from 'child_process';

import {
  GLOBAL_ILU_INSTALL_COMMAND,
  LOCAL_ILU_COMMAND,
  SETUP_NPM_INSTALL_FLAGS,
} from './setupParams.js';
import {
  isTruthyEnvValue,
  shouldInstallGlobalIlu,
} from './setupHelpers.js';
import { buildSetupResult } from './setupCommandResults.js';

export function getNpmCommand({
  env = process.env,
  platform = process.platform,
  execPath = process.execPath,
} = {}) {
  const npmExecPath = typeof env.npm_execpath === 'string' ? env.npm_execpath.trim() : '';
  if (npmExecPath) {
    return {
      command: execPath,
      argsPrefix: [npmExecPath],
    };
  }

  return {
    command: platform === 'win32' ? 'npm.cmd' : 'npm',
    argsPrefix: [],
  };
}

export function runNpmInstall(
  args,
  {
    rootDir = process.cwd(),
    env = process.env,
    platform = process.platform,
    execPath = process.execPath,
    spawnSyncImpl = spawnSync,
    stdio = 'inherit',
    stdout = process.stdout,
    stderr = process.stderr,
    ...options
  } = {}
) {
  const { command, argsPrefix } = getNpmCommand({ env, platform, execPath });
  const result = spawnSyncImpl(command, [...argsPrefix, ...args], {
    cwd: rootDir,
    encoding: stdio === 'inherit' ? undefined : 'utf-8',
    stdio,
    ...options,
  });
  if (result.status === 0 && !result.error) {
    return;
  }
  if (result.stdout) {
    stdout.write(result.stdout);
  }
  if (result.stderr) {
    stderr.write(result.stderr);
  }
  throw result.error || new Error(`npm ${args.join(' ')} failed with exit code ${result.status}`);
}

export async function installDependencies({
  rootDir = process.cwd(),
  existsSyncImpl = existsSync,
  runNpmInstallImpl = runNpmInstall,
  logArrow = () => {},
  logInfo = () => {},
  logSuccess = () => {},
  logWarning = () => {},
} = {}) {
  try {
    logArrow('Checking Node dependencies');
    let changed = false;
    const nodeModulesPath = join(rootDir, 'node_modules');
    const viteBin = join(nodeModulesPath, '.bin', 'vite');
    if (!existsSyncImpl(nodeModulesPath) || !existsSyncImpl(viteBin)) {
      logInfo('Streaming npm install output below. This can take a while on the first run.');
      runNpmInstallImpl(['install', ...SETUP_NPM_INSTALL_FLAGS], { rootDir });
      changed = true;
    } else {
      const inquirerPath = join(rootDir, 'node_modules', 'inquirer');
      if (!existsSyncImpl(inquirerPath)) {
        logInfo('Installing missing setup dependency: inquirer');
        logInfo('Streaming npm install output below.');
        runNpmInstallImpl(['install', 'inquirer', ...SETUP_NPM_INSTALL_FLAGS], { rootDir });
        changed = true;
      }
    }
    logSuccess('Node dependencies ready');
    return buildSetupResult({ changed });
  } catch (error) {
    logWarning('✗ Failed to install dependencies');
    throw error;
  }
}

export async function installOptionalGlobalIlu({
  rootDir = process.cwd(),
  existsSyncImpl = existsSync,
  shouldInstall = shouldInstallGlobalIlu,
  runNpmInstallImpl = runNpmInstall,
  log = () => {},
  logArrow = () => {},
  logSuccess = () => {},
  logInfo = () => {},
  warningColor = null,
} = {}) {
  if (!shouldInstall()) {
    return buildSetupResult({
      attempted: false,
      installed: false,
    });
  }

  const localIluPackagePath = join(rootDir, 'node_modules', 'i-love-urdf');
  if (!existsSyncImpl(localIluPackagePath)) {
    log('✗ Global ilu install requested, but i-love-urdf is not installed locally.', warningColor);
    logInfo(`Local CLI still works via ${LOCAL_ILU_COMMAND}`);
    return buildSetupResult({
      attempted: true,
      installed: false,
    });
  }

  log('');
  logArrow('Installing global i-love-urdf CLI');
  logInfo('Streaming npm install output below.');
  log('');

  try {
    runNpmInstallImpl(['install', '-g', localIluPackagePath, ...SETUP_NPM_INSTALL_FLAGS], { rootDir });
    logSuccess('Global ilu CLI installed');
    return buildSetupResult({
      changed: true,
      attempted: true,
      installed: true,
    });
  } catch (_error) {
    log('✗ Failed to install the global ilu CLI', warningColor);
    logInfo(`Retry later with: ${GLOBAL_ILU_INSTALL_COMMAND}`);
    logInfo(`Local CLI still works via ${LOCAL_ILU_COMMAND}`);
    return buildSetupResult({
      attempted: true,
      installed: false,
    });
  }
}

export function shouldInstallTwinDeps({
  argv = process.argv,
  env = process.env,
} = {}) {
  return (
    argv.includes('--twin') ||
    argv.includes('--install-twin') ||
    isTruthyEnvValue(env.npm_config_twin) ||
    isTruthyEnvValue(env.TWIN)
  );
}

export async function installTwinDepsIfRequested({
  rootDir = process.cwd(),
  argv = process.argv,
  env = process.env,
  existsSyncImpl = existsSync,
  execFileSyncImpl = execFileSync,
  nodeCommand = process.execPath,
  log = () => {},
  logArrow = () => {},
  warningColor = null,
} = {}) {
  if (!shouldInstallTwinDeps({ argv, env })) {
    return buildSetupResult();
  }

  const twinScript = join(rootDir, 'scripts', 'twin.js');
  if (!existsSyncImpl(twinScript)) {
    log('✗ Twin setup requested but scripts/twin.js was not found', warningColor);
    throw new Error('Missing scripts/twin.js');
  }

  log('');
  logArrow('Installing VGGT ("twin") dependencies');
  log('');
  execFileSyncImpl(nodeCommand, [twinScript, '--twin'], { cwd: rootDir, stdio: 'inherit' });
  return buildSetupResult({ changed: true });
}
