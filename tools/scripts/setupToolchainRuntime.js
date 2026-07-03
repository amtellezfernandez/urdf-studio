import { appendFileSync, existsSync, readFileSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { delimiter, join } from 'path';

import {
  buildSetupResult,
  didSpawnSyncFail,
  printCapturedCommandOutput,
} from './setupCommandResults.js';

export function findExecutableOnPath(
  executableName,
  preferredPaths,
  {
    env = process.env,
    existsSyncImpl = existsSync,
    pathDelimiter = delimiter,
  } = {}
) {
  for (const executablePath of preferredPaths) {
    if (executablePath && existsSyncImpl(executablePath)) {
      return executablePath;
    }
  }

  for (const directory of String(env.PATH || '').split(pathDelimiter)) {
    if (!directory) {
      continue;
    }
    const candidatePath = join(directory, executableName);
    if (existsSyncImpl(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

export function findUv({
  env = process.env,
  existsSyncImpl = existsSync,
  pathDelimiter = delimiter,
} = {}) {
  return findExecutableOnPath(
    'uv',
    [
      join(env.HOME || '', '.local', 'bin', 'uv'),
      join(env.HOME || '', '.cargo', 'bin', 'uv'),
      '/usr/local/bin/uv',
      '/usr/bin/uv',
    ],
    { env, existsSyncImpl, pathDelimiter }
  );
}

export function findCargo({
  env = process.env,
  existsSyncImpl = existsSync,
  pathDelimiter = delimiter,
} = {}) {
  return findExecutableOnPath(
    'cargo',
    [
      join(env.HOME || '', '.cargo', 'bin', 'cargo'),
      '/usr/local/bin/cargo',
      '/usr/bin/cargo',
    ],
    { env, existsSyncImpl, pathDelimiter }
  );
}

export function ensureCargoPathInShellRc({
  env = process.env,
  existsSyncImpl = existsSync,
  readFileSyncImpl = readFileSync,
  appendFileSyncImpl = appendFileSync,
  pathDelimiter = delimiter,
  logSuccess = () => {},
  logInfo = () => {},
} = {}) {
  const home = env.HOME || '';
  if (!home) {
    return false;
  }

  const bashRc = join(home, '.bashrc');
  const exportLine = 'export PATH="$HOME/.cargo/bin:$PATH"';
  const marker = '# Added by URDF Studio setup: Rust cargo bin';

  let needsAppend = true;
  if (existsSyncImpl(bashRc)) {
    try {
      const content = readFileSyncImpl(bashRc, 'utf-8');
      if (content.includes(exportLine)) {
        needsAppend = false;
      }
    } catch (_error) {
      needsAppend = true;
    }
  }

  if (needsAppend) {
    try {
      appendFileSyncImpl(bashRc, `\n${marker}\n${exportLine}\n`, 'utf-8');
      logSuccess('Added Rust cargo path to ~/.bashrc');
    } catch (_error) {
      logInfo('Could not update ~/.bashrc automatically. You may need to add cargo path manually.');
    }
  }

  const cargoBin = join(home, '.cargo', 'bin');
  const pathEntries = String(env.PATH || '').split(pathDelimiter);
  if (!pathEntries.includes(cargoBin)) {
    env.PATH = [cargoBin, ...pathEntries.filter(Boolean)].join(pathDelimiter);
  }
  return needsAppend;
}

export function shouldAutoInstallRust({ env = process.env } = {}) {
  const isExplicitTrue = (value) => /^(1|true|yes)$/i.test(String(value || ''));
  const isExplicitFalse = (value) => /^(0|false|no)$/i.test(String(value || ''));

  if (isExplicitTrue(env.URDF_STUDIO_SKIP_RUST_AUTO_INSTALL)) {
    return false;
  }
  if (isExplicitFalse(env.URDF_STUDIO_AUTO_INSTALL_RUST)) {
    return false;
  }
  if (isExplicitTrue(env.URDF_STUDIO_AUTO_INSTALL_RUST)) {
    return true;
  }
  return true;
}

export function installRustToolchain({
  rootDir = process.cwd(),
  execSyncImpl = execSync,
  logInfo = () => {},
} = {}) {
  logInfo('Installing Rust toolchain with rustup (minimal profile)...');
  execSyncImpl(
    'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal',
    {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true,
    }
  );
}

export async function checkIkd({
  rootDir = process.cwd(),
  env = process.env,
  loadAppConfig = () => ({}),
  existsSyncImpl = existsSync,
  spawnSyncImpl = spawnSync,
  findCargoImpl = findCargo,
  ensureCargoPathInShellRcImpl = ensureCargoPathInShellRc,
  shouldAutoInstallRustImpl = shouldAutoInstallRust,
  installRustToolchainImpl = installRustToolchain,
  didSpawnSyncFailImpl = didSpawnSyncFail,
  printCapturedCommandOutputImpl = printCapturedCommandOutput,
  logArrow = () => {},
  logInfo = () => {},
  logSuccess = () => {},
  logWarning = () => {},
} = {}) {
  const appConfig = loadAppConfig();
  const ikdConfig = appConfig?.ikd || {};
  const ikdEnabled = Boolean(ikdConfig.enabled);
  const ikdManifest = join(rootDir, 'ikd', 'Cargo.toml');
  const findCargoOptions = { env, existsSyncImpl };
  let cargoPath = findCargoImpl(findCargoOptions);
  let changed = false;

  if (!ikdEnabled && !existsSyncImpl(ikdManifest)) {
    return buildSetupResult();
  }

  if (!ikdEnabled) {
    logArrow('Checking native IKD toolchain');
    logInfo('ikd is present in this repo. Installing Rust prerequisites automatically.');
  }

  if (!cargoPath) {
    logWarning('✗ ikd requires Rust cargo, but cargo was not found.');

    if (shouldAutoInstallRustImpl({ env })) {
      try {
        logArrow('Installing Rust toolchain');
        installRustToolchainImpl({ rootDir, logInfo });
        changed = true;
        changed = ensureCargoPathInShellRcImpl({ env, logSuccess, logInfo }) || changed;
        cargoPath = findCargoImpl(findCargoOptions);
      } catch (_error) {
        logWarning('✗ Rust auto-install failed.');
      }
    }

    if (!cargoPath) {
      logInfo('Install Rust toolchain manually:');
      logInfo('  curl --proto \"=https\" --tlsv1.2 -sSf https://sh.rustup.rs | sh');
      logInfo('Then restart your shell and run setup again.');
      logInfo('Auto-install is enabled by default; disable with URDF_STUDIO_SKIP_RUST_AUTO_INSTALL=1');
      logInfo('Or disable ikd with: config/app.config.json -> ikd.enabled=false');
      return buildSetupResult({ ok: false, changed });
    }
  }

  changed = ensureCargoPathInShellRcImpl({ env, logSuccess, logInfo }) || changed;
  const cargoCheck = spawnSyncImpl(cargoPath, ['--version'], {
    cwd: rootDir,
    encoding: 'utf-8',
  });
  if (didSpawnSyncFailImpl(cargoCheck)) {
    printCapturedCommandOutputImpl(cargoCheck);
    logWarning('✗ cargo exists but failed to run.');
    logInfo('Reinstall Rust toolchain or disable ikd in config/app.config.json.');
    return buildSetupResult({ ok: false, changed });
  }
  if (!existsSyncImpl(ikdManifest)) {
    logWarning('✗ ikd is enabled but ikd/Cargo.toml is missing.');
    logInfo('Check your branch or set ikd.enabled=false.');
    return buildSetupResult({ ok: false, changed });
  }

  return buildSetupResult({ changed });
}
