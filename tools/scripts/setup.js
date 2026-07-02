#!/usr/bin/env node

import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { delimiter, dirname, join, resolve } from 'path';
import { execFileSync, execSync, spawnSync } from 'child_process';
import readline from 'readline';
import { maskToken, resolveSetupGitHubToken } from './githubAuth.js';
import {
  formatSimulatorCompatibilitySummary,
  getSimulatorCompatibilityReport,
  getSimulatorCompatibilityTarget,
  isManagedSimulatorInstallAllowed,
} from './simulatorCompatibility.js';
import {
  isTruthyEnvValue,
  selectInstalledSupersededPythonDependencies,
  shouldInstallGlobalIlu,
} from './setupHelpers.js';
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
  BLENDER_FORCE_INSTALL_ENV,
  BLENDER_PATH_ENV,
  BLENDER_SETUP,
  BLENDER_SKIP_AUTO_INSTALL_ENV,
  GENESIS_FORCE_INSTALL_ENV,
  GENESIS_PYTHON_DEPENDENCIES,
  GENESIS_SKIP_AUTO_INSTALL_ENV,
  GENESIS_VERIFY_IMPORT_SCRIPT,
  GITHUB_CLI_LOGIN_COMMAND,
  GITHUB_FINE_GRAINED_TOKEN_URL,
  GLOBAL_ILU_INSTALL_COMMAND,
  HUGGING_FACE_TOKEN_URL,
  LOCAL_ILU_COMMAND,
  MJLAB_DEPENDENCIES,
  MJLAB_FORCE_INSTALL_ENV,
  MJLAB_SKIP_AUTO_INSTALL_ENV,
  MJLAB_VERIFY_IMPORT_SCRIPT,
  MJX_SYSTEM_ID_DEPENDENCIES,
  PYBULLET_DEPENDENCIES,
  PYBULLET_FORCE_INSTALL_ENV,
  PYBULLET_SKIP_AUTO_INSTALL_ENV,
  PYBULLET_VERIFY_IMPORT_SCRIPT,
  PYTHON_ENV_DIRNAME,
  SETUP_NPM_INSTALL_FLAGS,
} from './setupParams.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..', '..');
const CMEEL_LAYOUT = {
  prefixDirname: 'cmeel.prefix',
  libDirname: 'lib',
};

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  pink: '\x1b[35m',      // Magenta/pink
  pinkBright: '\x1b[95m', // Bright magenta
  pinkLight: '\x1b[38;5;213m', // Light pink
  pinkDark: '\x1b[38;5;162m',  // Dark pink
  purple: '\x1b[38;5;129m',    // Purple
  purpleBright: '\x1b[38;5;141m', // Bright purple
  purpleLight: '\x1b[38;5;183m',   // Light purple
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
  underline: '\x1b[4m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logArrow(message) {
  log(`→ ${message}`, colors.pink);
}

function logSuccess(message) {
  log(`✓ ${message}`, colors.green);
}

function logInfo(message) {
  log(`  ${message}`, colors.gray);
}

function logUrl(url, text) {
  const underline = '\x1b[4m';
  log(`  ${text}: ${colors.pinkBright}${underline}${url}${colors.reset}`);
}

function buildSetupResult({ ok = true, changed = false, ...rest } = {}) {
  return { ok, changed, ...rest };
}

function isSetupStepReady(result) {
  return result !== false && result?.ok !== false;
}

function didSetupStepChange(result) {
  return Boolean(result?.changed);
}

function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function resolveRosUrdfdomLibPath() {
  const candidates = [
    '/opt/ros/jazzy/lib/x86_64-linux-gnu',
    '/opt/ros/rolling/lib/x86_64-linux-gnu',
    '/opt/ros/humble/lib/x86_64-linux-gnu',
    '/opt/ros/kilted/lib/x86_64-linux-gnu',
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'liburdfdom_sensor.so.4.0'))) return dir;
  }
  return null;
}

function prependNativeLibraryPath(env, libPath) {
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

function resolveManagedCmeelLibPathFromSitePackages(sitePackagePaths, pathExists = existsSync) {
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

function resolveManagedCmeelLibPath(venvPython) {
  if (!venvPython || !existsSync(venvPython)) {
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
    const output = execFileSync(venvPython, ['-c', script], {
      cwd: rootDir,
      encoding: 'utf-8',
      env: getUvEnv(),
    }).trim();
    return resolveManagedCmeelLibPathFromSitePackages(JSON.parse(output));
  } catch (e) {
    return null;
  }
}

function getUvEnv({ managedPythonPath = null } = {}) {
  const uvCacheDir = process.env.UV_CACHE_DIR || join(rootDir, '.uv-cache');
  const env = { ...process.env, UV_CACHE_DIR: uvCacheDir };
  const rosLibPath = resolveRosUrdfdomLibPath();
  if (rosLibPath) {
    prependNativeLibraryPath(env, rosLibPath);
  }
  prependNativeLibraryPath(env, resolveManagedCmeelLibPath(managedPythonPath));
  return env;
}

function question(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function shouldOfferTokenSetup() {
  if (process.env.URDF_STUDIO_SKIP_TOKENS) {
    return false;
  }
  return (
    process.argv.includes('--auth') ||
    process.argv.includes('--tokens') ||
    isTruthyEnvValue(process.env.URDF_STUDIO_SETUP_TOKENS)
  );
}

function getNpmCommand() {
  const npmExecPath = typeof process.env.npm_execpath === 'string' ? process.env.npm_execpath.trim() : '';
  if (npmExecPath) {
    return {
      command: process.execPath,
      argsPrefix: [npmExecPath],
    };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    argsPrefix: [],
  };
}

function runNpmInstall(args, options = {}) {
  const { command, argsPrefix } = getNpmCommand();
  const result = spawnSync(command, [...argsPrefix, ...args], {
    cwd: rootDir,
    encoding: 'utf-8',
    ...options,
  });
  if (result.status === 0 && !result.error) {
    return;
  }
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  throw result.error || new Error(`npm ${args.join(' ')} failed with exit code ${result.status}`);
}

function runNpmInstallIn(cwd, args, options = {}) {
  runNpmInstall(args, { cwd, ...options });
}

async function installDependencies() {
  try {
    let changed = false;
    const nodeModulesPath = join(rootDir, 'node_modules');
    const viteBin = join(nodeModulesPath, '.bin', 'vite');
    if (!existsSync(nodeModulesPath) || !existsSync(viteBin)) {
      logArrow('Installing Node dependencies');
      runNpmInstall(['install', ...SETUP_NPM_INSTALL_FLAGS]);
      changed = true;
    } else {
      const inquirerPath = join(rootDir, 'node_modules', 'inquirer');
      if (!existsSync(inquirerPath)) {
        logArrow('Installing missing setup dependency');
        runNpmInstall(['install', 'inquirer', ...SETUP_NPM_INSTALL_FLAGS]);
        changed = true;
      }
    }
    if (changed) {
      logSuccess('Node dependencies ready');
    }
    return buildSetupResult({ changed });
  } catch (error) {
    log('✗ Failed to install dependencies', colors.yellow);
    throw error;
  }
}

function assertIluRuntimeContract(
  {
    urdfCore,
    urdfCoreBundleMeshAssetsNode,
    urdfCoreNodeDomRuntime,
  },
  domGlobals = globalThis
) {
  const missingApis = [];
  if (typeof urdfCore?.convertURDFToMJCF !== 'function') {
    missingApis.push('convertURDFToMJCF');
  }
  if (typeof urdfCore?.convertURDFToUSD !== 'function') {
    missingApis.push('convertURDFToUSD');
  }
  if (typeof urdfCoreBundleMeshAssetsNode?.bundleMeshAssetsForUrdfFile !== 'function') {
    missingApis.push('bundleMeshAssetsForUrdfFile');
  }
  if (typeof urdfCoreNodeDomRuntime?.installNodeDomGlobals !== 'function') {
    missingApis.push('installNodeDomGlobals');
  }
  if (typeof domGlobals.DOMParser !== 'function') {
    missingApis.push('DOMParser');
  }
  if (typeof domGlobals.XMLSerializer !== 'function') {
    missingApis.push('XMLSerializer');
  }
  if (missingApis.length > 0) {
    throw new Error(`i-love-urdf runtime is missing required API(s): ${missingApis.join(', ')}`);
  }

  const conversion = urdfCore.convertURDFToMJCF(
    '<robot name="setup_check"><link name="base"/></robot>'
  );
  if (typeof conversion?.mjcfContent !== 'string' || !conversion.mjcfContent.includes('<mujoco')) {
    throw new Error('i-love-urdf MJCF conversion check failed.');
  }

  const usdConversion = urdfCore.convertURDFToUSD(
    '<robot name="setup_check"><link name="base"/></robot>'
  );
  if (typeof usdConversion?.usdContent !== 'string' || !usdConversion.usdContent.includes('#usda')) {
    throw new Error('i-love-urdf USD conversion check failed.');
  }
}

async function verifyIluRuntimeContract() {
  try {
    const modules = await import('./urdfCoreModules.js');
    assertIluRuntimeContract(modules);
    return buildSetupResult();
  } catch (error) {
    log('✗ i-love-urdf runtime check failed', colors.yellow);
    logInfo(error?.message || String(error));
    logInfo('Run npm install, then rerun npm run setup.');
    return buildSetupResult({ ok: false });
  }
}

function getConfigPath() {
  return join(rootDir, '.urdf-studio-config.json');
}

function getAppConfigPath() {
  return join(rootDir, 'config', 'app.config.json');
}

function loadAppConfig() {
  const appConfigPath = getAppConfigPath();
  if (!existsSync(appConfigPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(appConfigPath, 'utf-8'));
  } catch (e) {
    return {};
  }
}

function loadConfig() {
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      return {};
    }
  }
  return {};
}

function saveConfig(config) {
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

async function setupHuggingFace() {
  if (!shouldOfferTokenSetup() || !isInteractive()) {
    return buildSetupResult();
  }

  log('');
  logArrow('Hugging Face authentication');
  log('');
  
  const config = loadConfig();
  const currentToken = config.huggingfaceToken || '';
  const configPath = getConfigPath();

  const hfAnswer = (await question('  Set up HuggingFace token now? (y/N): ')).trim().toLowerCase();
  if (hfAnswer !== 'y' && hfAnswer !== 'yes') {
    return buildSetupResult();
  }

  if (currentToken) {
    const maskedToken = maskToken(currentToken);
    logInfo(`Current token: ${colors.pinkBright}${maskedToken}${colors.reset}`);
    log('');
    logInfo('Options:');
    logInfo('  [r] Remove token');
    logInfo('  [s] Substitute/Update token');
    logInfo('  [Enter] Skip (keep current)');
    log('');
    
    const action = (await question(`  Choose an option: ${colors.pinkBright}`)).trim().toLowerCase();
    
    if (action === 'r' || action === 'remove') {
      delete config.huggingfaceToken;
      saveConfig(config);
      logSuccess('HuggingFace token removed');
      return buildSetupResult({ changed: true });
    }
    if (action !== 's' && action !== 'substitute' && action !== 'update') {
      logInfo('Token unchanged (keeping current token).');
      return buildSetupResult();
    }
  } else {
    logInfo('A token is required for uploading and managing datasets.');
    log('');
    logInfo('To create a token:');
    logUrl(HUGGING_FACE_TOKEN_URL, 'Visit');
    logInfo('1. Click "New token"');
    logInfo('2. Set permissions: Read access to repos + Write access to repos');
    logInfo('3. Copy the token (starts with hf_)');
    log('');
  }
  
  logInfo(`${colors.yellow}⚠ Security: Your token will be saved locally on your computer, keep it private and never share it.${colors.reset}`);
  logInfo(`   Saved to: ${colors.gray}${configPath}${colors.reset}`);
  log('');
  
  // Ask for token input (completely hidden)
  let token = '';
  try {
    const inquirer = (await import('inquirer')).default;
    ({ token } = await inquirer.prompt([
      {
        type: 'password',
        name: 'token',
        message: `${colors.pinkBright}  Enter your HuggingFace token (or press Enter to skip):${colors.reset}`,
        mask: '', // Completely hidden
      },
    ]));
  } catch (e) {
    logInfo(`Token prompt unavailable (${e?.message || 'unknown error'}).`);
    token = (await question('  Enter your HuggingFace token (visible input, or press Enter to skip): ')).trim();
  }
  
  if (token?.trim()) {
    config.huggingfaceToken = token.trim();
    saveConfig(config);
    logSuccess('HuggingFace token saved');
    logInfo(`   Location: ${colors.gray}${configPath}${colors.reset}`);
    return buildSetupResult({ changed: true });
  }
  return buildSetupResult();
}

async function setupGitHub() {
  if (!shouldOfferTokenSetup() || !isInteractive()) {
    return buildSetupResult();
  }

  log('');
  logArrow('GitHub access');
  log('');
  
  const config = loadConfig();
  const currentToken = config.githubToken || '';
  const configPath = getConfigPath();

  const ghAnswer = (await question('  Configure GitHub access now? (y/N): ')).trim().toLowerCase();
  if (ghAnswer !== 'y' && ghAnswer !== 'yes') {
    return buildSetupResult();
  }

  if (currentToken) {
    const maskedToken = maskToken(currentToken);
    logInfo(`Current token: ${colors.purpleBright}${maskedToken}${colors.reset}`);
    log('');
    logInfo('Options:');
    logInfo('  [r] Remove token');
    logInfo('  [s] Substitute/Update token');
    logInfo('  [Enter] Skip (keep current)');
    log('');
    
    const action = (await question(`  Choose an option: ${colors.purpleBright}`)).trim().toLowerCase();
    
    if (action === 'r' || action === 'remove') {
      delete config.githubToken;
      saveConfig(config);
      logSuccess('GitHub token removed');
      return buildSetupResult({ changed: true });
    }
    if (action !== 's' && action !== 'substitute' && action !== 'update') {
      logInfo('Token unchanged (keeping current token).');
      return buildSetupResult();
    }
  }

  const detectedGitHubAuth = resolveSetupGitHubToken();
  if (!currentToken && detectedGitHubAuth.token) {
    const maskedDetectedToken = maskToken(detectedGitHubAuth.token);
    logInfo(
      `Detected GitHub access via ${colors.purpleBright}${detectedGitHubAuth.source}${colors.reset}: ${colors.purpleBright}${maskedDetectedToken}${colors.reset}`
    );
    logInfo('URDF Studio can already reuse this access without saving a local token.');
    log('');
    logInfo('Options:');
    logInfo('  [Enter] Keep using detected access (recommended)');
    logInfo('  [s] Save detected token locally');
    logInfo('  [m] Enter a different token manually');
    log('');

    const detectedAction = (await question(`  Choose an option: ${colors.purpleBright}`)).trim().toLowerCase();
    if (detectedAction === '' || detectedAction === 'k' || detectedAction === 'keep') {
      logInfo('Detected GitHub access will be reused without saving a local token.');
      return buildSetupResult();
    }
    if (detectedAction === 's' || detectedAction === 'save') {
      config.githubToken = detectedGitHubAuth.token;
      saveConfig(config);
      logSuccess('GitHub token saved');
      logInfo(`   Source: ${colors.gray}${detectedGitHubAuth.source}${colors.reset}`);
      logInfo(`   Location: ${colors.gray}${configPath}${colors.reset}`);
      return buildSetupResult({ changed: true });
    }
    if (detectedAction !== 'm' && detectedAction !== 'manual') {
      logInfo('Detected GitHub access not saved. You can still enter a token manually later.');
      return buildSetupResult();
    }
    logInfo('Detected GitHub access not saved. Enter a different token below if you still want a local fallback.');
    log('');
  }

  if (!currentToken) {
    logInfo('Recommended GitHub access options:');
    logInfo(`1. Run ${colors.purpleBright}${GITHUB_CLI_LOGIN_COMMAND}${colors.reset} (recommended, nothing stored locally)`);
    logInfo('2. Export GITHUB_TOKEN or GH_TOKEN in your shell');
    logInfo('3. Save a fine-grained token locally for URDF Studio only');
    log('');
    logInfo('If you want to create a token:');
    logUrl(GITHUB_FINE_GRAINED_TOKEN_URL, 'Visit');
    logInfo('1. Click "Generate new token (Fine-grained)"');
    logInfo('2. Under Repository access, choose:');
    logInfo('   ✓ Only select repositories');
    logInfo('   (Pick the repos you want URDF Studio to access)');
    logInfo('3. Under Repository permissions, enable:');
    logInfo('   Contents → Read and write');
    logInfo('   Pull requests → Read and write');
    logInfo('   Metadata → Read (usually enabled by default)');
    logInfo('4. Generate the token and copy it (it will look like github_pat_...)');
    log('');
  }

  logInfo(`${colors.yellow}⚠ Security: Your token is stored locally on your computer only.${colors.reset}`);
  logInfo(`   It is never shared or uploaded anywhere.${colors.reset}`);
  logInfo(`   Saved to: ${colors.gray}${configPath}${colors.reset}`);
  log('');
  
  // Ask for token input (completely hidden)
  let token = '';
  try {
    const inquirer = (await import('inquirer')).default;
    ({ token } = await inquirer.prompt([
      {
        type: 'password',
        name: 'token',
        message: `${colors.purpleBright}  Enter your GitHub token (or press Enter to skip):${colors.reset}`,
        mask: '', // Completely hidden
      },
    ]));
  } catch (e) {
    logInfo(`Token prompt unavailable (${e?.message || 'unknown error'}).`);
    token = (await question('  Enter your GitHub token (visible input, or press Enter to skip): ')).trim();
  }
  
  if (token?.trim()) {
    config.githubToken = token.trim();
    saveConfig(config);
    logSuccess('GitHub token saved');
    logInfo(`   Location: ${colors.gray}${configPath}${colors.reset}`);
    return buildSetupResult({ changed: true });
  }
  return buildSetupResult();
}

async function installOptionalGlobalIlu() {
  if (!shouldInstallGlobalIlu()) {
    return buildSetupResult({
      attempted: false,
      installed: false,
    });
  }

  const localIluPackagePath = join(rootDir, 'node_modules', 'i-love-urdf');
  if (!existsSync(localIluPackagePath)) {
    log('✗ Global ilu install requested, but i-love-urdf is not installed locally.', colors.yellow);
    logInfo(`Local CLI still works via ${LOCAL_ILU_COMMAND}`);
    return buildSetupResult({
      attempted: true,
      installed: false,
    });
  }

  log('');
  logArrow('Installing global i-love-urdf CLI');
  log('');

  try {
    runNpmInstall(['install', '-g', localIluPackagePath, ...SETUP_NPM_INSTALL_FLAGS]);
    logSuccess('Global ilu CLI installed');
    return buildSetupResult({
      changed: true,
      attempted: true,
      installed: true,
    });
  } catch (_error) {
    log('✗ Failed to install the global ilu CLI', colors.yellow);
    logInfo(`Retry later with: ${GLOBAL_ILU_INSTALL_COMMAND}`);
    logInfo(`Local CLI still works via ${LOCAL_ILU_COMMAND}`);
    return buildSetupResult({
      attempted: true,
      installed: false,
    });
  }
}

function findUv() {
  // Check common installation locations for uv
  const uvLocations = [
    join(process.env.HOME || '', '.local', 'bin', 'uv'),
    join(process.env.HOME || '', '.cargo', 'bin', 'uv'),
    '/usr/local/bin/uv',
    '/usr/bin/uv',
  ];

  for (const uvPath of uvLocations) {
    if (existsSync(uvPath)) {
      return uvPath;
    }
  }

  // Try to find uv in PATH
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(':')) {
    if (!dir) {
      continue;
    }
    const candidate = join(dir, 'uv');
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function findCargo() {
  const cargoLocations = [
    join(process.env.HOME || '', '.cargo', 'bin', 'cargo'),
    '/usr/local/bin/cargo',
    '/usr/bin/cargo',
  ];

  for (const cargoPath of cargoLocations) {
    if (existsSync(cargoPath)) {
      return cargoPath;
    }
  }

  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(':')) {
    if (!dir) {
      continue;
    }
    const candidate = join(dir, 'cargo');
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function ensureCargoPathInShellRc() {
  const home = process.env.HOME || '';
  if (!home) {
    return false;
  }

  const bashRc = join(home, '.bashrc');
  const exportLine = 'export PATH="$HOME/.cargo/bin:$PATH"';
  const marker = '# Added by URDF Studio setup: Rust cargo bin';

  let needsAppend = true;
  if (existsSync(bashRc)) {
    try {
      const content = readFileSync(bashRc, 'utf-8');
      if (content.includes(exportLine)) {
        needsAppend = false;
      }
    } catch (e) {
      needsAppend = true;
    }
  }

  if (needsAppend) {
    try {
      appendFileSync(bashRc, `\n${marker}\n${exportLine}\n`, 'utf-8');
      logSuccess('Added Rust cargo path to ~/.bashrc');
    } catch (e) {
      logInfo('Could not update ~/.bashrc automatically. You may need to add cargo path manually.');
    }
  }

  // Make cargo visible to subsequent setup steps in this process.
  const cargoBin = join(home, '.cargo', 'bin');
  if (!String(process.env.PATH || '').split(':').includes(cargoBin)) {
    process.env.PATH = `${cargoBin}:${process.env.PATH || ''}`;
  }
  return needsAppend;
}

function shouldAutoInstallRust() {
  if (/^(1|true|yes)$/i.test(process.env.URDF_STUDIO_SKIP_RUST_AUTO_INSTALL || '')) {
    return false;
  }
  if (/^(0|false|no)$/i.test(process.env.URDF_STUDIO_AUTO_INSTALL_RUST || '')) {
    return false;
  }
  if (/^(1|true|yes)$/i.test(process.env.URDF_STUDIO_AUTO_INSTALL_RUST || '')) {
    return true;
  }
  // Default to auto-install so ikd setup is turnkey when enabled.
  return true;
}

function installRustToolchain() {
  logInfo('Installing Rust toolchain with rustup (minimal profile)...');
  execSync(
    'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal',
    {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true,
    }
  );
}

async function checkIkd() {
  const appConfig = loadAppConfig();
  const ikdConfig = appConfig?.ikd || {};
  const ikdEnabled = Boolean(ikdConfig.enabled);
  const ikdManifest = join(rootDir, 'ikd', 'Cargo.toml');
  const ikdPresent = existsSync(ikdManifest);
  let cargoPath = findCargo();
  let changed = false;

  if (!ikdEnabled && !ikdPresent) {
    return buildSetupResult();
  }

  if (!ikdEnabled && ikdPresent) {
    logArrow('Checking native IKD toolchain');
    logInfo('ikd is present in this repo. Installing Rust prerequisites automatically.');
  }

  if (!cargoPath) {
    log('✗ ikd is enabled, but cargo was not found.', colors.yellow);
    let shouldInstall = shouldAutoInstallRust();

    if (shouldInstall) {
      try {
        logArrow('Installing Rust toolchain');
        installRustToolchain();
        changed = true;
        changed = ensureCargoPathInShellRc() || changed;
        cargoPath = findCargo();
      } catch (e) {
        log('✗ Rust auto-install failed.', colors.yellow);
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

  changed = ensureCargoPathInShellRc() || changed;
  const cargoCheck = spawnSync(cargoPath, ['--version'], {
    cwd: rootDir,
    encoding: 'utf-8',
  });
  if (didSpawnSyncFail(cargoCheck)) {
    printCapturedCommandOutput(cargoCheck);
    log('✗ cargo exists but failed to run.', colors.yellow);
    logInfo('Reinstall Rust toolchain or disable ikd in config/app.config.json.');
    return buildSetupResult({ ok: false, changed });
  }
  if (!existsSync(ikdManifest)) {
    log('✗ ikd is enabled but ikd/Cargo.toml is missing.', colors.yellow);
    logInfo('Check your branch or set ikd.enabled=false.');
    return buildSetupResult({ ok: false, changed });
  }

  return buildSetupResult({ changed });
}

function getManagedPythonPath() {
  return join(rootDir, PYTHON_ENV_DIRNAME, 'bin', 'python3');
}

async function setupPythonBackendEnvironment() {
  const venvPath = join(rootDir, PYTHON_ENV_DIRNAME);
  const venvPython = getManagedPythonPath();

  const uvPath = findUv();
  if (!uvPath) {
    log('✗ uv not found. Please install uv first:', colors.yellow);
    log('');
    logInfo('Install uv with:');
    logInfo('  curl -LsSf https://astral.sh/uv/install.sh | sh');
    log('');
    return buildSetupResult({ ok: false });
  }

  if (existsSync(venvPython)) {
    return buildSetupResult();
  }

  const pythonResolution = resolvePythonForBackendVenv();
  if (!pythonResolution) {
    log('✗ URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON must point to Python 3.12+.', colors.yellow);
    logPythonBootstrapHelp();
    return buildSetupResult({ ok: false });
  }

  logArrow('Setting up Python backend');
  if (pythonResolution.usesUvManagedPython) {
    logInfo('Using uv-managed Python 3.12 for the unified runtime.');
  }

  logInfo(`Creating ${venvPath} with ${pythonResolution.python}`);
  try {
    execFileSync(uvPath, ['venv', '--python', pythonResolution.python, venvPath], {
      cwd: rootDir,
      stdio: 'inherit',
      env: getUvEnv(),
    });
    logSuccess('Python backend environment ready');
    return buildSetupResult({ changed: true });
  } catch (e) {
    log('✗ Failed to create unified Python environment', colors.yellow);
    logPythonBootstrapHelp();
    return buildSetupResult({ ok: false });
  }
}

function getConfiguredPythonForBackend() {
  if (typeof process.env.URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON === 'string') {
    return process.env.URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON.trim();
  }
  return typeof process.env.URDF_STUDIO_LEROBOT_BOOTSTRAP_PYTHON === 'string'
    ? process.env.URDF_STUDIO_LEROBOT_BOOTSTRAP_PYTHON.trim()
    : '';
}

function isSupportedPythonExecutable(candidate) {
  try {
    const version = execFileSync(
      candidate,
      ['-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'],
      { encoding: 'utf-8' }
    ).trim();
    const [major, minor] = version.split('.').map(Number);
    return major > 3 || (major === 3 && minor >= 12);
  } catch (e) {
    return false;
  }
}

function findPythonForBackend() {
  const configuredPython = getConfiguredPythonForBackend();
  if (!configuredPython) {
    return null;
  }
  return isSupportedPythonExecutable(configuredPython) ? configuredPython : null;
}

function resolvePythonForBackendVenv() {
  const configuredPython = getConfiguredPythonForBackend();
  if (!configuredPython) {
    return {
      python: '3.12',
      usesUvManagedPython: true,
    };
  }

  const pythonPath = findPythonForBackend();
  if (pythonPath) {
    return {
      python: pythonPath,
      usesUvManagedPython: false,
    };
  }
  return null;
}

function logPythonBootstrapHelp() {
  logInfo('Use uv for Python 3.12: uv python install 3.12');
  logInfo('Then rerun: npm run setup');
  logInfo('Optional manual override: URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON=/path/to/python3.12');
}

function shouldInstallBackendNativeSimRuntime(simulatorCompatibilityReport = null) {
  if (isTruthyEnvValue(process.env[BACKEND_NATIVE_SIM_SKIP_ENV])) {
    return false;
  }
  if (isTruthyEnvValue(process.env[BACKEND_NATIVE_SIM_FORCE_ENV])) {
    return true;
  }
  return process.platform !== 'darwin' && isManagedSimulatorInstallAllowed(simulatorCompatibilityReport, 'mjx');
}

function shouldInstallBackendCollisionStack() {
  if (isTruthyEnvValue(process.env[BACKEND_COLLISION_STACK_SKIP_ENV])) {
    return false;
  }
  if (isTruthyEnvValue(process.env[BACKEND_COLLISION_STACK_FORCE_ENV])) {
    return true;
  }
  return process.platform !== 'darwin';
}

function resolveBackendPythonDependencies(simulatorCompatibilityReport = null) {
  const baseDependencies = [...BACKEND_PYTHON_PORTABLE_DEPENDENCIES];
  if (shouldInstallBackendCollisionStack()) {
    baseDependencies.push(...BACKEND_PYTHON_PLACO_DEPENDENCIES);
  }
  if (!shouldInstallBackendNativeSimRuntime(simulatorCompatibilityReport)) {
    return baseDependencies;
  }
  return [
    ...baseDependencies,
    ...BACKEND_PYTHON_JAX_DEPENDENCIES,
    ...MJX_SYSTEM_ID_DEPENDENCIES,
  ];
}

function resolveBackendPythonVerifyImportScript(simulatorCompatibilityReport = null) {
  const portableScript = shouldInstallBackendCollisionStack()
    ? BACKEND_PYTHON_PORTABLE_VERIFY_IMPORT_SCRIPT
    : BACKEND_PYTHON_CORE_VERIFY_IMPORT_SCRIPT;
  if (!shouldInstallBackendNativeSimRuntime(simulatorCompatibilityReport)) {
    return portableScript;
  }
  return [portableScript, BACKEND_PYTHON_NATIVE_SIM_VERIFY_IMPORT_SCRIPT].join('\n');
}

function shouldInstallGenesisRuntime() {
  return shouldInstallOptionalPythonRuntime({
    skipAutoInstallEnv: GENESIS_SKIP_AUTO_INSTALL_ENV,
    forceInstallEnv: GENESIS_FORCE_INSTALL_ENV,
    defaultInstall: process.platform !== 'win32',
  });
}

function shouldInstallPybulletRuntime() {
  return shouldInstallOptionalPythonRuntime({
    skipAutoInstallEnv: PYBULLET_SKIP_AUTO_INSTALL_ENV,
    forceInstallEnv: PYBULLET_FORCE_INSTALL_ENV,
    defaultInstall: process.platform !== 'darwin',
  });
}

function shouldInstallMjlabRuntime() {
  return shouldInstallOptionalPythonRuntime({
    skipAutoInstallEnv: MJLAB_SKIP_AUTO_INSTALL_ENV,
    forceInstallEnv: MJLAB_FORCE_INSTALL_ENV,
    defaultInstall: process.platform !== 'win32',
  });
}

function getManagedBlenderRuntimeRoot() {
  return join(rootDir, '.cache', 'blender-runtime');
}

function getManagedBlenderExecutablePath() {
  return join(
    getManagedBlenderRuntimeRoot(),
    `blender-${BLENDER_SETUP.portableVersion}-${BLENDER_SETUP.portablePlatform}`,
    process.platform === 'win32' ? 'blender.exe' : 'blender'
  );
}

function isExecutableFile(path) {
  try {
    const stats = statSync(path);
    if (!stats.isFile()) return false;
    if (stats.size <= 0) return false;
    return process.platform === 'win32' || (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function findExecutableInPath(name) {
  const pathDelimiter = process.platform === 'win32' ? ';' : ':';
  for (const directory of (process.env.PATH || '').split(pathDelimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveBlenderCandidate(candidate) {
  const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
  if (!trimmed) return null;
  if (process.platform !== 'win32' && trimmed.toLowerCase().endsWith('.exe')) {
    return null;
  }
  if (trimmed.endsWith('.app')) {
    const appBinary = join(trimmed, 'Contents', 'MacOS', 'Blender');
    return isExecutableFile(appBinary) ? appBinary : null;
  }
  try {
    const stats = statSync(trimmed);
    if (stats.isDirectory()) {
      const executableName = process.platform === 'win32' ? 'blender.exe' : 'blender';
      const executablePath = join(trimmed, executableName);
      return isExecutableFile(executablePath) ? executablePath : null;
    }
  } catch {
    // Try direct file and PATH resolution below.
  }
  if (isExecutableFile(trimmed)) return trimmed;
  return findExecutableInPath(trimmed);
}

function verifyBlenderExecutable(executablePath) {
  const result = spawnSync(
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

function resolveBlenderExecutableForSetup() {
  const executableName = process.platform === 'win32' ? 'blender.exe' : 'blender';
  const configuredPath = typeof process.env[BLENDER_PATH_ENV] === 'string'
    ? process.env[BLENDER_PATH_ENV].trim()
    : '';
  if (configuredPath) {
    const resolved = resolveBlenderCandidate(configuredPath);
    return resolved && verifyBlenderExecutable(resolved) ? resolved : null;
  }
  const candidates = [
    getManagedBlenderExecutablePath(),
    executableName,
    process.platform === 'darwin' ? '/Applications/Blender.app' : '',
  ];
  for (const candidate of candidates) {
    const resolved = resolveBlenderCandidate(candidate);
    if (resolved && verifyBlenderExecutable(resolved)) {
      return resolved;
    }
  }
  return null;
}

function shouldInstallBlenderRuntime() {
  if (isTruthyEnvValue(process.env[BLENDER_SKIP_AUTO_INSTALL_ENV])) {
    return false;
  }
  if (isTruthyEnvValue(process.env[BLENDER_FORCE_INSTALL_ENV])) {
    return true;
  }
  return true;
}

function installManagedLinuxBlenderRuntime() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('Managed Blender install is currently available for Linux x64 only.');
  }

  const runtimeRoot = getManagedBlenderRuntimeRoot();
  const executablePath = getManagedBlenderExecutablePath();
  const runtimeDir = dirname(executablePath);
  if (verifyBlenderExecutable(executablePath)) {
    return executablePath;
  }

  const downloadsDir = join(runtimeRoot, 'downloads');
  const archivePath = join(downloadsDir, BLENDER_SETUP.portableArchive);
  const archiveTempPath = `${archivePath}.tmp`;
  mkdirSync(downloadsDir, { recursive: true });
  if (!existsSync(archivePath)) {
    rmSync(archiveTempPath, { force: true });
    logInfo(`Downloading Blender ${BLENDER_SETUP.portableVersion} LTS for Linux x64...`);
    execFileSync(
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
    renameSync(archiveTempPath, archivePath);
  }

  rmSync(runtimeDir, { recursive: true, force: true });
  logInfo(`Extracting Blender into ${runtimeRoot}...`);
  execFileSync('tar', ['-xJf', archivePath, '-C', runtimeRoot], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  chmodSync(executablePath, 0o755);
  if (!verifyBlenderExecutable(executablePath)) {
    throw new Error('Managed Blender executable failed its version check after extraction.');
  }
  return executablePath;
}

async function installBlenderRuntime(simulatorCompatibilityReport = null) {
  const existingExecutable = resolveBlenderExecutableForSetup();
  if (existingExecutable) {
    return buildSetupResult({
      installed: true,
      skipped: false,
      executable: existingExecutable,
    });
  }

  if (!shouldInstallBlenderRuntime()) {
    return buildSetupResult({ installed: false, skipped: true });
  }

  const compatibilityResult = buildSimulatorCompatibilityInstallResult({
    simulatorCompatibilityReport,
    simulatorId: 'blender',
    setupName: 'Blender',
    forceInstallEnv: BLENDER_FORCE_INSTALL_ENV,
  });
  if (compatibilityResult) {
    return compatibilityResult;
  }

  try {
    logArrow('Installing Blender workspace runtime');
    const executable = installManagedLinuxBlenderRuntime();
    logSuccess(`Blender workspace runtime installed: ${executable}`);
    return buildSetupResult({
      changed: true,
      installed: true,
      skipped: false,
      executable,
    });
  } catch (error) {
    log('✗ Failed to install Blender workspace runtime', colors.yellow);
    logInfo(error?.message || String(error));
    logInfo(`Set ${BLENDER_PATH_ENV}=/path/to/blender if Blender is already installed.`);
    if (!isTruthyEnvValue(process.env[BLENDER_FORCE_INSTALL_ENV])) {
      logInfo(`Continuing without Blender. Set ${BLENDER_FORCE_INSTALL_ENV}=1 to require it during setup.`);
    }
    return buildOptionalRuntimeInstallFailure({
      forceInstallEnv: BLENDER_FORCE_INSTALL_ENV,
      error,
    });
  }
}

function shouldInstallOptionalPythonRuntime({
  skipAutoInstallEnv,
  forceInstallEnv,
  defaultInstall,
}) {
  if (isTruthyEnvValue(process.env[skipAutoInstallEnv])) {
    return false;
  }
  if (isTruthyEnvValue(process.env[forceInstallEnv])) {
    return true;
  }
  return defaultInstall;
}

function listInstalledPythonPackageNames(venvPython) {
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

  const result = spawnSync(venvPython, ['-c', script], {
    cwd: rootDir,
    encoding: 'utf-8',
  });

  if (result.status !== 0 || !result.stdout) {
    const stderr = String(result.stderr || '').trim();
    throw new Error(stderr || 'Installed Python package inspection failed');
  }

  const output = result.stdout;
  return JSON.parse(output);
}

function runPythonImportCheck(venvPython, script) {
  const result = spawnSync(venvPython, ['-c', script], {
    cwd: rootDir,
    encoding: 'utf-8',
    env: getUvEnv({ managedPythonPath: venvPython }),
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

function printCapturedCommandOutput(result) {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

function didSpawnSyncFail(result) {
  if (result.status === 0 && !result.signal) {
    return false;
  }
  return result.status !== 0 || Boolean(result.signal) || Boolean(result.error);
}

function buildOptionalRuntimeInstallFailure({ forceInstallEnv, error = null }) {
  const fatal = isTruthyEnvValue(process.env[forceInstallEnv]);
  return {
    ok: false,
    installed: false,
    skipped: false,
    fatal,
    error: error instanceof Error ? error.message : null,
  };
}

function shouldFailSetupForRuntimeResult(result) {
  return result?.ok === false && result.fatal !== false;
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

function formatSimulatorInstallBlock(target) {
  if (!target) {
    return 'No compatibility result was available for this simulator.';
  }
  if (target.reasons.length > 0) {
    return target.reasons.join(' ');
  }
  if (target.setupMode === 'external') {
    return `${target.label} is an external runtime and is not installed by URDF Studio setup.`;
  }
  if (target.setupMode === 'planned') {
    return `${target.label} setup is planned but not available in this release.`;
  }
  if (target.setupMode === 'deprecated') {
    return `${target.label} is deprecated and is not installed by setup.`;
  }
  return `${target.label} is not installable by setup on this machine.`;
}

function buildSimulatorCompatibilityInstallResult({
  simulatorCompatibilityReport,
  simulatorId,
  setupName,
  forceInstallEnv,
}) {
  if (!simulatorCompatibilityReport || isManagedSimulatorInstallAllowed(simulatorCompatibilityReport, simulatorId)) {
    return null;
  }

  const target = getSimulatorCompatibilityTarget(simulatorCompatibilityReport, simulatorId);
  const reason = formatSimulatorInstallBlock(target);
  const forced = isTruthyEnvValue(process.env[forceInstallEnv]);
  log(forced ? `✗ ${setupName} is not compatible with this machine` : `Skipping ${setupName}`, colors.yellow);
  logInfo(reason);
  if (!forced) {
    logInfo(`Set ${forceInstallEnv}=1 only after fixing compatibility.`);
  }
  return buildSetupResult({
    ok: !forced,
    installed: false,
    skipped: !forced,
    fatal: forced,
    compatibility: target,
    reason,
  });
}

async function installOptionalPythonRuntime({
  shouldInstall,
  displayName,
  setupName,
  simulatorId,
  simulatorCompatibilityReport = null,
  dependencies,
  verifyImportScript,
  forceInstallEnv,
  manualInstallIntro = 'Try manually:',
}) {
  if (!shouldInstall()) {
    return buildSetupResult({ installed: false, skipped: true });
  }
  const compatibilityResult = buildSimulatorCompatibilityInstallResult({
    simulatorCompatibilityReport,
    simulatorId,
    setupName,
    forceInstallEnv,
  });
  if (compatibilityResult) {
    return compatibilityResult;
  }

  const venvPython = getManagedPythonPath();
  const uvPath = findUv();
  if (!existsSync(venvPython)) {
    logInfo(`Unified Python environment not found at ${venvPython}. Run setup first.`);
    return { ok: false, installed: false, skipped: false, fatal: true };
  }
  if (!uvPath) {
    log(`✗ uv not found. ${setupName} setup requires uv.`, colors.yellow);
    return { ok: false, installed: false, skipped: false, fatal: true };
  }

  const existingRuntimeCheck = runPythonImportCheck(venvPython, verifyImportScript);
  if (existingRuntimeCheck.ok) {
    return buildSetupResult({ installed: true, skipped: false });
  }

  logArrow(`Installing ${displayName}`);
  if (existingRuntimeCheck.output) {
    logInfo(`${displayName} check failed; reinstalling packages.`);
  }

  try {
    logInfo(`Installing ${displayName} packages in ${PYTHON_ENV_DIRNAME}...`);
    execFileSync(uvPath, ['pip', 'install', '--python', venvPython, ...dependencies], {
      cwd: rootDir,
      stdio: 'inherit',
      env: getUvEnv(),
    });

    const installedRuntimeCheck = runPythonImportCheck(venvPython, verifyImportScript);
    if (!installedRuntimeCheck.ok) {
      printCapturedCommandOutput(installedRuntimeCheck);
      throw new Error(installedRuntimeCheck.output || `${setupName} import check failed after install.`);
    }
    logSuccess(`${displayName} installed`);
    return buildSetupResult({ changed: true, installed: true, skipped: false });
  } catch (e) {
    log(`✗ Failed to install ${displayName}`, colors.yellow);
    logInfo(manualInstallIntro);
    logInfo(`  "${uvPath}" pip install --python ${PYTHON_ENV_DIRNAME}/bin/python3 ${dependencies.map((dependency) => JSON.stringify(dependency)).join(' ')}`);
    if (!isTruthyEnvValue(process.env[forceInstallEnv])) {
      logInfo(`Continuing without ${setupName}. Set ${forceInstallEnv}=1 to require it during setup.`);
    }
    return buildOptionalRuntimeInstallFailure({
      forceInstallEnv,
      error: e,
    });
  }
}

async function installPybulletRuntime(simulatorCompatibilityReport = null) {
  return installOptionalPythonRuntime({
    shouldInstall: shouldInstallPybulletRuntime,
    displayName: 'PyBullet workspace adapter runtime',
    setupName: 'PyBullet',
    simulatorId: 'pybullet',
    simulatorCompatibilityReport,
    dependencies: PYBULLET_DEPENDENCIES,
    verifyImportScript: PYBULLET_VERIFY_IMPORT_SCRIPT,
    forceInstallEnv: PYBULLET_FORCE_INSTALL_ENV,
  });
}

async function installMjlabRuntime(simulatorCompatibilityReport = null) {
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
  });
}

function shouldBlockForcedBackendNativeSimRuntime(simulatorCompatibilityReport = null) {
  return (
    isTruthyEnvValue(process.env[BACKEND_NATIVE_SIM_FORCE_ENV]) &&
    !isManagedSimulatorInstallAllowed(simulatorCompatibilityReport, 'mjx')
  );
}

async function installBackendDeps(simulatorCompatibilityReport = null) {
  const venvPython = getManagedPythonPath();
  const uvPath = findUv();

  if (!existsSync(venvPython)) {
    logInfo(`Unified Python environment not found at ${venvPython}. Run setup first.`);
    return buildSetupResult({ ok: false });
  }
  if (!uvPath) {
    log('✗ uv not found. Please install uv first:', colors.yellow);
    return buildSetupResult({ ok: false });
  }

  if (shouldBlockForcedBackendNativeSimRuntime(simulatorCompatibilityReport)) {
    const target = getSimulatorCompatibilityTarget(simulatorCompatibilityReport, 'mjx');
    log('✗ Native simulator dependencies are not compatible with this machine', colors.yellow);
    logInfo(formatSimulatorInstallBlock(target));
    return buildSetupResult({ ok: false });
  }

  const backendPythonDependencies = resolveBackendPythonDependencies(simulatorCompatibilityReport);
  const backendVerifyImportScript = resolveBackendPythonVerifyImportScript(simulatorCompatibilityReport);

  let changed = false;
  try {
    const installedPackageNames = listInstalledPythonPackageNames(venvPython);
    const installedSupersededDependencies = selectInstalledSupersededPythonDependencies({
      supersededDependencies: BACKEND_PYTHON_SUPERSEDED_DEPENDENCIES,
      installedPackageNames,
    });

    if (installedSupersededDependencies.length > 0) {
      logInfo(`Removing superseded backend packages: ${installedSupersededDependencies.join(', ')}`);
      execFileSync(
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
  } catch (e) {
    if (changed) {
      logInfo('Continuing after superseded backend package cleanup could not inspect or remove superseded packages.');
    }
  }

  const existingBackendCheck = runPythonImportCheck(venvPython, backendVerifyImportScript);
  if (existingBackendCheck.ok) {
    return buildSetupResult({ changed });
  }
  logArrow('Installing backend Python runtime');
  logInfo('Installing or repairing backend Python packages...');
  logInfo(`Installing: ${backendPythonDependencies.join(', ')}`);

  try {
    execFileSync(uvPath, ['pip', 'install', '--python', venvPython, ...backendPythonDependencies], {
      cwd: rootDir,
      stdio: 'inherit',
      env: getUvEnv()
    });
    logInfo('Verifying backend Python runtime...');
    const installedBackendCheck = runPythonImportCheck(venvPython, backendVerifyImportScript);
    if (!installedBackendCheck.ok) {
      printCapturedCommandOutput(installedBackendCheck);
      throw new Error(installedBackendCheck.output || 'Backend Python import check failed after install.');
    }
    logSuccess('Backend dependencies installed');
    return buildSetupResult({ changed: true });
  } catch (e) {
    log('✗ Failed to install backend dependencies', colors.yellow);
    logInfo(`   You can try installing manually:`);
    logInfo(`     "${uvPath}" pip install --python ${PYTHON_ENV_DIRNAME}/bin/python3 ${backendPythonDependencies.map((dependency) => JSON.stringify(dependency)).join(' ')}`);
    return buildSetupResult({ ok: false, changed });
  }
}

async function installGenesisRuntime(simulatorCompatibilityReport = null) {
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
  });
}

async function installTwinDepsIfRequested() {
  const shouldInstallTwin =
    process.argv.includes('--twin') ||
    process.argv.includes('--install-twin') ||
    process.env.npm_config_twin === 'true' ||
    process.env.npm_config_twin === '1' ||
    process.env.TWIN === 'true' ||
    process.env.TWIN === '1';

  if (!shouldInstallTwin) {
    return buildSetupResult();
  }

  const twinScript = join(rootDir, 'scripts', 'twin.js');
  if (!existsSync(twinScript)) {
    log('✗ Twin setup requested but scripts/twin.js was not found', colors.yellow);
    throw new Error('Missing scripts/twin.js');
  }

  log('');
  logArrow('Installing VGGT ("twin") dependencies');
  log('');
  execFileSync('node', [twinScript, '--twin'], { cwd: rootDir, stdio: 'inherit' });
  return buildSetupResult({ changed: true });
}

async function runSetupSequence(overrides = {}) {
  const steps = {
    installDependencies,
    verifyIluRuntimeContract,
    setupPythonBackendEnvironment,
    checkSimulatorCompatibility,
    installBackendDeps,
    installGenesisRuntime,
    installMjlabRuntime,
    installPybulletRuntime,
    installBlenderRuntime,
    installTwinDepsIfRequested,
    checkIkd,
    setupHuggingFace,
    setupGitHub,
    installOptionalGlobalIlu,
    ...overrides,
  };

  const setupResults = [];
  const recordResult = (result) => {
    setupResults.push(result);
    return result;
  };

  const dependenciesReady = recordResult(await steps.installDependencies());
  if (!isSetupStepReady(dependenciesReady)) {
    throw new Error('Node dependency installation failed');
  }
  const iluRuntimeReady = recordResult(await steps.verifyIluRuntimeContract());
  if (!isSetupStepReady(iluRuntimeReady)) {
    throw new Error('i-love-urdf runtime setup failed');
  }
  const pythonBackendEnvironmentReady = recordResult(await steps.setupPythonBackendEnvironment());
  if (!isSetupStepReady(pythonBackendEnvironmentReady)) {
    throw new Error('Unified Python environment setup failed');
  }
  const simulatorCompatibilityReady = recordResult(await steps.checkSimulatorCompatibility());
  if (!isSetupStepReady(simulatorCompatibilityReady)) {
    throw new Error('Simulator compatibility check failed');
  }
  const simulatorCompatibilityReport = simulatorCompatibilityReady?.report || null;
  const backendDepsInstalled = recordResult(await steps.installBackendDeps(simulatorCompatibilityReport));
  if (!isSetupStepReady(backendDepsInstalled)) {
    throw new Error('Backend dependencies installation failed');
  }
  const genesisRuntimeResult = recordResult(await steps.installGenesisRuntime(simulatorCompatibilityReport));
  if (shouldFailSetupForRuntimeResult(genesisRuntimeResult)) {
    throw new Error('Genesis workspace adapter runtime installation failed');
  }
  const mjlabRuntimeResult = recordResult(await steps.installMjlabRuntime(simulatorCompatibilityReport));
  if (shouldFailSetupForRuntimeResult(mjlabRuntimeResult)) {
    throw new Error('MJLab validation runtime installation failed');
  }
  const pybulletRuntimeResult = recordResult(await steps.installPybulletRuntime(simulatorCompatibilityReport));
  if (shouldFailSetupForRuntimeResult(pybulletRuntimeResult)) {
    throw new Error('PyBullet workspace adapter runtime installation failed');
  }
  const blenderRuntimeResult = recordResult(await steps.installBlenderRuntime(simulatorCompatibilityReport));
  if (shouldFailSetupForRuntimeResult(blenderRuntimeResult)) {
    throw new Error('Blender workspace runtime installation failed');
  }
  recordResult(await steps.installTwinDepsIfRequested());
  const ikdResult = recordResult(await steps.checkIkd());
  if (!isSetupStepReady(ikdResult)) {
    throw new Error('Native IKD toolchain setup failed');
  }
  recordResult(await steps.setupHuggingFace());
  recordResult(await steps.setupGitHub());
  const globalIluResult = recordResult(await steps.installOptionalGlobalIlu());
  return {
    changed: setupResults.some(didSetupStepChange),
    globalIluResult,
    genesisRuntimeResult,
    mjlabRuntimeResult,
    pybulletRuntimeResult,
    blenderRuntimeResult,
  };
}

async function main() {
  try {
    const { changed } = await runSetupSequence();
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
  prependNativeLibraryPath,
  resolveBlenderExecutableForSetup,
  resolveManagedCmeelLibPathFromSitePackages,
  resolvePythonForBackendVenv,
  runSetupSequence,
  verifyIluRuntimeContract,
};
