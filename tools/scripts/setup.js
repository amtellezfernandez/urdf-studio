#!/usr/bin/env node

import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve } from 'path';
import { execFileSync, execSync, spawnSync } from 'child_process';
import readline from 'readline';
import { maskToken, resolveSetupGitHubToken } from './githubAuth.js';
import {
  buildSetupSummarySections,
  isTruthyEnvValue,
  selectInstalledSupersededPythonDependencies,
  shouldInstallGlobalIlu,
} from './setupHelpers.js';
import { OPENARM_HARDWARE_PIP_DEPENDENCIES } from './openArmHardwareParams.js';
import { buildOpenArmHardwareVerifyImportScript } from './openArmHardwareRuntime.js';
import { buildUrdfOpsRuntime, isUrdfOpsCheckoutAvailable } from './urdfOpsIntegration.js';
import {
  URDF_OPS_REPO_URL,
  URDF_OPS_ROOT_ENV,
  URDF_OPS_SKIP_SETUP_ENV,
} from './urdfOpsParams.js';
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
  GENESIS_FORCE_INSTALL_ENV,
  GENESIS_PYTHON_DEPENDENCIES,
  GENESIS_SKIP_AUTO_INSTALL_ENV,
  GENESIS_VERIFY_IMPORT_SCRIPT,
  GITHUB_CLI_LOGIN_COMMAND,
  GITHUB_FINE_GRAINED_TOKEN_URL,
  GLOBAL_ILU_INSTALL_COMMAND,
  HUGGING_FACE_TOKEN_URL,
  LEROBOT_TOOLCHAIN_DIRNAME,
  LEROBOT_TRAINING_DEPENDENCIES,
  LEROBOT_TRAINING_VERIFY_IMPORT_SCRIPT,
  LOCAL_ILU_COMMAND,
  MJLAB_DEPENDENCIES,
  MJLAB_FORCE_INSTALL_ENV,
  MJLAB_SKIP_AUTO_INSTALL_ENV,
  MJX_SYSTEM_ID_DEPENDENCIES,
  MJLAB_VERIFY_IMPORT_SCRIPT,
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

const banner = `
${colors.pinkBright}    __  ______  ____  ______   _____ __            ___    ${colors.reset}
${colors.pinkBright}   / / / / __ \\/ __ \\/ ____/  / ___// /___  ______/ (_)___ ${colors.reset}
${colors.pink}  / / / / /_/ / / / / /_      \\__ \\/ __/ / / / __  / / __ \\${colors.reset}
${colors.pink} / /_/ / _, _/ /_/ / __/     ___/ / /_/ /_/ / /_/ / / /_/ /${colors.reset}
${colors.pinkLight} \\____/_/ |_/_____/_/       /____/\\__/\\__,_/\\__,_/_/\\____/ ${colors.reset}
${colors.reset}                                                            

${colors.gray}─────────────────────────────────────────────────────────────${colors.reset}
`;

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

function getUvEnv() {
  const uvCacheDir = process.env.UV_CACHE_DIR || join(rootDir, '.uv-cache');
  const env = { ...process.env, UV_CACHE_DIR: uvCacheDir };
  const rosLibPath = resolveRosUrdfdomLibPath();
  if (rosLibPath) {
    env.LD_LIBRARY_PATH = [rosLibPath, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  }
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
  logArrow('Installing dependencies...');

  try {
    const nodeModulesPath = join(rootDir, 'node_modules');
    const viteBin = join(nodeModulesPath, '.bin', 'vite');
    if (!existsSync(nodeModulesPath) || !existsSync(viteBin)) {
      runNpmInstall(['install', ...SETUP_NPM_INSTALL_FLAGS]);
    } else {
      const inquirerPath = join(rootDir, 'node_modules', 'inquirer');
      if (!existsSync(inquirerPath)) {
        logInfo('Installing inquirer...');
        runNpmInstall(['install', 'inquirer', ...SETUP_NPM_INSTALL_FLAGS]);
      }
    }
    logSuccess('Dependencies installed successfully');
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
}

async function verifyIluRuntimeContract() {
  log('');
  logArrow('Checking i-love-urdf runtime');
  log('');

  try {
    const modules = await import('./urdfCoreModules.js');
    assertIluRuntimeContract(modules);
    logSuccess('i-love-urdf runtime ready');
    return true;
  } catch (error) {
    log('✗ i-love-urdf runtime check failed', colors.yellow);
    logInfo(error?.message || String(error));
    logInfo('Run npm install, then rerun npm run setup.');
    return false;
  }
}

async function setupUrdfOpsWorkspace() {
  if (isTruthyEnvValue(process.env[URDF_OPS_SKIP_SETUP_ENV])) {
    return true;
  }

  log('');
  logArrow('🧭 Setting up URDF Ops workspace');
  log('');

  const opsRuntime = buildUrdfOpsRuntime({ studioRootDir: rootDir });
  if (!isUrdfOpsCheckoutAvailable(opsRuntime)) {
    logInfo(`Cloning ${URDF_OPS_REPO_URL} into ${opsRuntime.root}`);
    try {
      execFileSync('git', ['clone', URDF_OPS_REPO_URL, opsRuntime.root], {
        cwd: dirname(rootDir),
        stdio: 'inherit',
      });
    } catch (error) {
      log('✗ Failed to clone URDF Ops', colors.yellow);
      logInfo(`Set ${URDF_OPS_ROOT_ENV}=/path/to/urdf-ops if you already cloned it elsewhere.`);
      logInfo(`Set ${URDF_OPS_SKIP_SETUP_ENV}=1 to continue without URDF Ops.`);
      return false;
    }
  }

  try {
    const lockfilePath = join(opsRuntime.root, 'package-lock.json');
    const viteBinPath = join(
      opsRuntime.nodeModulesPath,
      '.bin',
      process.platform === 'win32' ? 'vite.cmd' : 'vite'
    );
    if (existsSync(opsRuntime.nodeModulesPath) && existsSync(viteBinPath)) {
      logSuccess('URDF Ops dependencies already installed');
      return true;
    }

    const installCommand = existsSync(lockfilePath) ? 'ci' : 'install';
    logInfo(`Installing URDF Ops dependencies with npm ${installCommand}...`);
    runNpmInstallIn(opsRuntime.root, [installCommand, ...SETUP_NPM_INSTALL_FLAGS], {
      stdio: 'inherit',
    });
    logSuccess('URDF Ops dependencies installed');
    return true;
  } catch (error) {
    log('✗ Failed to install URDF Ops dependencies', colors.yellow);
    return false;
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
  if (process.env.URDF_STUDIO_SKIP_TOKENS || !isInteractive()) {
    return;
  }

  log('');
  logArrow('🤗 HuggingFace Authentication');
  log('');
  
  const config = loadConfig();
  const currentToken = config.huggingfaceToken || '';
  const configPath = getConfigPath();

  const hfAnswer = (await question('  Set up HuggingFace token now? (y/N): ')).trim().toLowerCase();
  if (hfAnswer !== 'y' && hfAnswer !== 'yes') {
    return;
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
      return;
    }
    if (action !== 's' && action !== 'substitute' && action !== 'update') {
      logInfo('Token unchanged (keeping current token).');
      return;
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
  }
}

async function setupGitHub() {
  if (process.env.URDF_STUDIO_SKIP_TOKENS || !isInteractive()) {
    return;
  }

  log('');
  logArrow('🐙 GitHub Access');
  log('');
  
  const config = loadConfig();
  const currentToken = config.githubToken || '';
  const configPath = getConfigPath();

  const ghAnswer = (await question('  Configure GitHub access now? (y/N): ')).trim().toLowerCase();
  if (ghAnswer !== 'y' && ghAnswer !== 'yes') {
    return;
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
      return;
    }
    if (action !== 's' && action !== 'substitute' && action !== 'update') {
      logInfo('Token unchanged (keeping current token).');
      return;
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
      return;
    }
    if (detectedAction === 's' || detectedAction === 'save') {
      config.githubToken = detectedGitHubAuth.token;
      saveConfig(config);
      logSuccess('GitHub token saved');
      logInfo(`   Source: ${colors.gray}${detectedGitHubAuth.source}${colors.reset}`);
      logInfo(`   Location: ${colors.gray}${configPath}${colors.reset}`);
      return;
    }
    if (detectedAction !== 'm' && detectedAction !== 'manual') {
      logInfo('Detected GitHub access not saved. You can still enter a token manually later.');
      return;
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
  }
}

async function installOptionalGlobalIlu() {
  if (!shouldInstallGlobalIlu()) {
    return {
      attempted: false,
      installed: false,
    };
  }

  const localIluPackagePath = join(rootDir, 'node_modules', 'i-love-urdf');
  if (!existsSync(localIluPackagePath)) {
    log('✗ Global ilu install requested, but i-love-urdf is not installed locally.', colors.yellow);
    logInfo(`Local CLI still works via ${LOCAL_ILU_COMMAND}`);
    return {
      attempted: true,
      installed: false,
    };
  }

  log('');
  logArrow('🧰 Installing global i-love-urdf CLI');
  log('');

  try {
    runNpmInstall(['install', '-g', localIluPackagePath, ...SETUP_NPM_INSTALL_FLAGS]);
    logSuccess('Global ilu CLI installed');
    return {
      attempted: true,
      installed: true,
    };
  } catch (_error) {
    log('✗ Failed to install the global ilu CLI', colors.yellow);
    logInfo(`Retry later with: ${GLOBAL_ILU_INSTALL_COMMAND}`);
    logInfo(`Local CLI still works via ${LOCAL_ILU_COMMAND}`);
    return {
      attempted: true,
      installed: false,
    };
  }
}

function printSetupSummary({
  globalIluResult,
  genesisRuntimeResult,
  mjlabRuntimeResult,
  pybulletRuntimeResult,
} = {}) {
  const sections = buildSetupSummarySections({
    globalIluAttempted: Boolean(globalIluResult?.attempted),
    globalIluInstalled: Boolean(globalIluResult?.installed),
    genesisRuntimeResult,
    mjlabRuntimeResult,
    pybulletRuntimeResult,
  });
  log('');
  logArrow('Setup summary');
  sections.forEach((section) => {
    logInfo(`${section.heading}:`);
    section.lines.forEach((line) => logInfo(`  ${line}`));
  });
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
    return;
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
  log('');
  logArrow('🦀 Checking native IKD toolchain');
  log('');

  const appConfig = loadAppConfig();
  const ikdConfig = appConfig?.ikd || {};
  const ikdEnabled = Boolean(ikdConfig.enabled);
  const ikdManifest = join(rootDir, 'ikd', 'Cargo.toml');
  const ikdPresent = existsSync(ikdManifest);
  let cargoPath = findCargo();

  if (!ikdEnabled && !ikdPresent) {
    logInfo('ikd is not enabled and native daemon files were not found.');
    return true;
  }

  if (!ikdEnabled && ikdPresent) {
    logInfo('ikd is present in this repo. Installing Rust prerequisites automatically.');
  }

  if (!cargoPath) {
    log('✗ ikd is enabled, but cargo was not found.', colors.yellow);
    let shouldInstall = shouldAutoInstallRust();

    if (shouldInstall) {
      try {
        installRustToolchain();
        ensureCargoPathInShellRc();
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
      return false;
    }
  }

  ensureCargoPathInShellRc();
  const cargoCheck = spawnSync(cargoPath, ['--version'], {
    cwd: rootDir,
    encoding: 'utf-8',
  });
  if (cargoCheck.status !== 0 || cargoCheck.error) {
    printCapturedCommandOutput(cargoCheck);
    log('✗ cargo exists but failed to run.', colors.yellow);
    logInfo('Reinstall Rust toolchain or disable ikd in config/app.config.json.');
    return false;
  }
  if (!existsSync(ikdManifest)) {
    log('✗ ikd is enabled but ikd/Cargo.toml is missing.', colors.yellow);
    logInfo('Check your branch or set ikd.enabled=false.');
    return false;
  }

  logSuccess('ikd toolchain prerequisites look good');
  return true;
}

function getManagedPythonPath() {
  return join(rootDir, PYTHON_ENV_DIRNAME, 'bin', 'python3');
}

async function setupPythonBackendEnvironment() {
  log('');
  logArrow('🔍 Setting up unified Python backend/training environment');
  log('');

  const venvPath = join(rootDir, PYTHON_ENV_DIRNAME);
  const venvPython = getManagedPythonPath();

  const uvPath = findUv();
  if (!uvPath) {
    log('✗ uv not found. Please install uv first:', colors.yellow);
    log('');
    logInfo('Install uv with:');
    logInfo('  curl -LsSf https://astral.sh/uv/install.sh | sh');
    log('');
    return false;
  }

  if (existsSync(venvPython)) {
    logSuccess('Unified Python environment ready');
    return true;
  }

  const pythonResolution = resolvePythonForLeRobotVenv();
  if (!pythonResolution) {
    log('✗ URDF_STUDIO_LEROBOT_BOOTSTRAP_PYTHON must point to Python 3.12+.', colors.yellow);
    logPythonBootstrapHelp();
    return false;
  }

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
    logSuccess('Unified Python environment ready');
    return true;
  } catch (e) {
    log('✗ Failed to create unified Python environment', colors.yellow);
    logPythonBootstrapHelp();
    return false;
  }
}

function getConfiguredPythonForLeRobot() {
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

function findPythonForLeRobot() {
  const configuredPython = getConfiguredPythonForLeRobot();
  if (!configuredPython) {
    return null;
  }
  return isSupportedPythonExecutable(configuredPython) ? configuredPython : null;
}

function resolvePythonForLeRobotVenv() {
  const configuredPython = getConfiguredPythonForLeRobot();
  if (!configuredPython) {
    return {
      python: '3.12',
      usesUvManagedPython: true,
    };
  }

  const pythonPath = findPythonForLeRobot();
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
  logInfo('Optional manual override: URDF_STUDIO_LEROBOT_BOOTSTRAP_PYTHON=/path/to/python3.12');
}

function shouldInstallOfficialLeRobot() {
  if (isTruthyEnvValue(process.env.URDF_STUDIO_SKIP_LEROBOT_AUTO_INSTALL)) {
    return false;
  }
  if (isTruthyEnvValue(process.env.URDF_STUDIO_INSTALL_LEROBOT)) {
    return true;
  }
  return process.platform !== 'darwin';
}

function getLeRobotToolchainSkipMessage() {
  if (isTruthyEnvValue(process.env.URDF_STUDIO_SKIP_LEROBOT_AUTO_INSTALL)) {
    return 'Official LeRobot training runtime skipped by URDF_STUDIO_SKIP_LEROBOT_AUTO_INSTALL.';
  }
  return 'Official LeRobot training runtime skipped on macOS. Set URDF_STUDIO_INSTALL_LEROBOT=1 to force install.';
}

function shouldInstallMjlab() {
  return shouldInstallOptionalPythonRuntime({
    skipAutoInstallEnv: MJLAB_SKIP_AUTO_INSTALL_ENV,
    forceInstallEnv: MJLAB_FORCE_INSTALL_ENV,
    defaultInstall: process.platform !== 'darwin',
  });
}

function shouldInstallOpenArmHardwareRuntime() {
  if (isTruthyEnvValue(process.env.URDF_STUDIO_SKIP_OPENARM_AUTO_INSTALL)) {
    return false;
  }
  if (isTruthyEnvValue(process.env.URDF_STUDIO_INSTALL_OPENARM_HARDWARE)) {
    return true;
  }
  return process.platform !== 'darwin';
}

function getOpenArmHardwareRuntimeSkipMessage() {
  if (isTruthyEnvValue(process.env.URDF_STUDIO_SKIP_OPENARM_AUTO_INSTALL)) {
    return 'OpenArm hardware runtime skipped by URDF_STUDIO_SKIP_OPENARM_AUTO_INSTALL.';
  }
  return 'OpenArm hardware runtime skipped on macOS. Set URDF_STUDIO_INSTALL_OPENARM_HARDWARE=1 to force install.';
}

function shouldInstallBackendNativeSimRuntime() {
  if (isTruthyEnvValue(process.env[BACKEND_NATIVE_SIM_SKIP_ENV])) {
    return false;
  }
  if (isTruthyEnvValue(process.env[BACKEND_NATIVE_SIM_FORCE_ENV])) {
    return true;
  }
  return process.platform !== 'darwin';
}

function getBackendNativeSimSkipMessage() {
  if (isTruthyEnvValue(process.env[BACKEND_NATIVE_SIM_SKIP_ENV])) {
    return `Native simulation backend runtime skipped by ${BACKEND_NATIVE_SIM_SKIP_ENV}.`;
  }
  if (process.platform === 'darwin') {
    return [
      'Native simulation backend runtime skipped on macOS.',
      'The pinned JAX/MJX system-id packages are not available for every macOS architecture.',
      `Set ${BACKEND_NATIVE_SIM_FORCE_ENV}=1 to force install.`,
    ].join(' ');
  }
  return `Native simulation backend runtime skipped. Set ${BACKEND_NATIVE_SIM_FORCE_ENV}=1 to force install.`;
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

function getBackendCollisionStackSkipMessage() {
  if (isTruthyEnvValue(process.env[BACKEND_COLLISION_STACK_SKIP_ENV])) {
    return `Backend collision stack skipped by ${BACKEND_COLLISION_STACK_SKIP_ENV}.`;
  }
  if (process.platform === 'darwin') {
    return [
      'Backend collision stack skipped on macOS.',
      'The pinned Placo/Pinocchio native libraries are not consistently relocatable across macOS Python environments.',
      `Set ${BACKEND_COLLISION_STACK_FORCE_ENV}=1 to force install.`,
    ].join(' ');
  }
  return `Backend collision stack skipped. Set ${BACKEND_COLLISION_STACK_FORCE_ENV}=1 to force install.`;
}

function resolveBackendPythonDependencies() {
  const baseDependencies = [...BACKEND_PYTHON_PORTABLE_DEPENDENCIES];
  if (shouldInstallBackendCollisionStack()) {
    baseDependencies.push(...BACKEND_PYTHON_PLACO_DEPENDENCIES);
  }
  if (!shouldInstallBackendNativeSimRuntime()) {
    return baseDependencies;
  }
  return [
    ...baseDependencies,
    ...BACKEND_PYTHON_JAX_DEPENDENCIES,
    ...MJX_SYSTEM_ID_DEPENDENCIES,
  ];
}

function resolveBackendPythonVerifyImportScript() {
  const portableScript = shouldInstallBackendCollisionStack()
    ? BACKEND_PYTHON_PORTABLE_VERIFY_IMPORT_SCRIPT
    : BACKEND_PYTHON_CORE_VERIFY_IMPORT_SCRIPT;
  if (!shouldInstallBackendNativeSimRuntime()) {
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

function getGenesisRuntimeSkipMessage() {
  if (isTruthyEnvValue(process.env[GENESIS_SKIP_AUTO_INSTALL_ENV])) {
    return `Genesis workspace adapter runtime skipped by ${GENESIS_SKIP_AUTO_INSTALL_ENV}.`;
  }
  return [
    `Genesis workspace adapter runtime skipped on ${process.platform}.`,
    `Set ${GENESIS_FORCE_INSTALL_ENV}=1 to force install.`,
  ].join(' ');
}

function getMjlabRuntimeSkipMessage() {
  if (isTruthyEnvValue(process.env[MJLAB_SKIP_AUTO_INSTALL_ENV])) {
    return `MJLab validation runtime skipped by ${MJLAB_SKIP_AUTO_INSTALL_ENV}.`;
  }
  if (process.platform === 'darwin') {
    return [
      'MJLab validation runtime skipped on macOS.',
      'The pinned MuJoCo-Warp/Warp wheels are not available for every macOS architecture.',
      `Set ${MJLAB_FORCE_INSTALL_ENV}=1 to force install.`,
    ].join(' ');
  }
  return `MJLab validation runtime skipped. Set ${MJLAB_FORCE_INSTALL_ENV}=1 to force install.`;
}

function shouldInstallPybulletRuntime() {
  return shouldInstallOptionalPythonRuntime({
    skipAutoInstallEnv: PYBULLET_SKIP_AUTO_INSTALL_ENV,
    forceInstallEnv: PYBULLET_FORCE_INSTALL_ENV,
    defaultInstall: true,
  });
}

function getPybulletRuntimeSkipMessage() {
  if (isTruthyEnvValue(process.env[PYBULLET_SKIP_AUTO_INSTALL_ENV])) {
    return `PyBullet workspace adapter runtime skipped by ${PYBULLET_SKIP_AUTO_INSTALL_ENV}.`;
  }
  return `PyBullet workspace adapter runtime skipped. Set ${PYBULLET_FORCE_INSTALL_ENV}=1 to force install.`;
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
    env: getUvEnv(),
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

async function installOfficialLeRobotToolchain() {
  if (!shouldInstallOfficialLeRobot()) {
    log('');
    logArrow('🤖 Checking official LeRobot training toolchain');
    log('');
    logInfo(getLeRobotToolchainSkipMessage());
    return true;
  }

  log('');
  logArrow('🤖 Installing official LeRobot training toolchain');
  log('');

  const uvPath = findUv();
  if (!uvPath) {
    log('✗ uv not found. Official LeRobot dataset merge requires uv.', colors.yellow);
    return false;
  }

  const toolchainPath = join(rootDir, LEROBOT_TOOLCHAIN_DIRNAME);
  const toolchainPython = join(toolchainPath, 'bin', 'python3');
  if (!existsSync(toolchainPython)) {
    const pythonResolution = resolvePythonForLeRobotVenv();
    if (!pythonResolution) {
      log('✗ URDF_STUDIO_LEROBOT_BOOTSTRAP_PYTHON must point to Python 3.12+.', colors.yellow);
      logPythonBootstrapHelp();
      return false;
    }
    if (pythonResolution.usesUvManagedPython) {
      logInfo('Using uv-managed Python 3.12 for the official LeRobot runtime.');
    }
    logInfo(`Creating ${toolchainPath} with ${pythonResolution.python}`);
    execFileSync(uvPath, ['venv', '--python', pythonResolution.python, toolchainPath], {
      cwd: rootDir,
      stdio: 'inherit',
      env: getUvEnv(),
    });
  }

  const existingTrainingCheck = runPythonImportCheck(toolchainPython, LEROBOT_TRAINING_VERIFY_IMPORT_SCRIPT);
  if (existingTrainingCheck.ok) {
    logSuccess('Official LeRobot training runtime ready');
    return true;
  }
  logInfo(`Installing official LeRobot training packages in ${LEROBOT_TOOLCHAIN_DIRNAME}...`);

  try {
    execFileSync(uvPath, ['pip', 'install', '--python', toolchainPython, ...LEROBOT_TRAINING_DEPENDENCIES], {
      cwd: rootDir,
      stdio: 'inherit',
      env: getUvEnv(),
    });
    const installedTrainingCheck = runPythonImportCheck(toolchainPython, LEROBOT_TRAINING_VERIFY_IMPORT_SCRIPT);
    if (!installedTrainingCheck.ok) {
      printCapturedCommandOutput(installedTrainingCheck);
      throw new Error(installedTrainingCheck.output || 'LeRobot training import check failed after install.');
    }
    logSuccess('Official LeRobot training runtime installed');
    logInfo(`Backend will use unified Python: ${toolchainPython}`);
    return true;
  } catch (e) {
    log('✗ Failed to install official LeRobot training runtime', colors.yellow);
    logInfo('Try manually:');
    logInfo(`  "${uvPath}" pip install --python ${LEROBOT_TOOLCHAIN_DIRNAME}/bin/python3 ${LEROBOT_TRAINING_DEPENDENCIES.join(' ')}`);
    return false;
  }
}

async function installOpenArmHardwareRuntime() {
  if (!shouldInstallOpenArmHardwareRuntime()) {
    log('');
    logArrow('🦾 Checking OpenArm hardware runtime');
    log('');
    logInfo(getOpenArmHardwareRuntimeSkipMessage());
    return true;
  }

  log('');
  logArrow('🦾 Installing OpenArm hardware runtime');
  log('');

  const venvPython = getManagedPythonPath();
  const uvPath = findUv();
  if (!existsSync(venvPython)) {
    logInfo(`Unified Python environment not found at ${venvPython}. Run setup first.`);
    return false;
  }
  if (!uvPath) {
    log('✗ uv not found. OpenArm hardware setup requires uv.', colors.yellow);
    return false;
  }

  const verifyScript = buildOpenArmHardwareVerifyImportScript();
  const existingOpenArmCheck = runPythonImportCheck(venvPython, verifyScript);
  if (existingOpenArmCheck.ok) {
    logSuccess('OpenArm hardware runtime ready');
    return true;
  }
  logInfo(`Installing OpenArm hardware packages in ${PYTHON_ENV_DIRNAME}...`);

  try {
    execFileSync(
      uvPath,
      ['pip', 'install', '--python', venvPython, ...OPENARM_HARDWARE_PIP_DEPENDENCIES],
      {
        cwd: rootDir,
        stdio: 'inherit',
        env: getUvEnv(),
      }
    );
    const installedOpenArmCheck = runPythonImportCheck(venvPython, verifyScript);
    if (!installedOpenArmCheck.ok) {
      printCapturedCommandOutput(installedOpenArmCheck);
      throw new Error(installedOpenArmCheck.output || 'OpenArm hardware import check failed after install.');
    }
    logSuccess('OpenArm hardware runtime installed');
    return true;
  } catch (e) {
    log('✗ Failed to install OpenArm hardware runtime', colors.yellow);
    logInfo('Try manually:');
    const manualDependencies = OPENARM_HARDWARE_PIP_DEPENDENCIES
      .map((dependency) => JSON.stringify(dependency))
      .join(' ');
    logInfo(`  "${uvPath}" pip install --python ${PYTHON_ENV_DIRNAME}/bin/python3 ${manualDependencies}`);
    return false;
  }
}

async function installOptionalPythonRuntime({
  shouldInstall,
  skipMessage,
  icon,
  displayName,
  setupName,
  dependencies,
  verifyImportScript,
  forceInstallEnv,
  manualInstallIntro = 'Try manually:',
}) {
  if (!shouldInstall()) {
    log('');
    logArrow(`${icon} Checking ${displayName}`);
    log('');
    logInfo(skipMessage());
    return { ok: true, installed: false, skipped: true };
  }

  log('');
  logArrow(`${icon} Installing ${displayName}`);
  log('');

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
    logSuccess(`${displayName} ready`);
    return { ok: true, installed: true, skipped: false };
  }

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
    return { ok: true, installed: true, skipped: false };
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

async function installMjlabRuntime() {
  return installOptionalPythonRuntime({
    shouldInstall: shouldInstallMjlab,
    skipMessage: getMjlabRuntimeSkipMessage,
    icon: '🧪',
    displayName: 'MJLab validation runtime',
    setupName: 'MJLab',
    dependencies: MJLAB_DEPENDENCIES,
    verifyImportScript: MJLAB_VERIFY_IMPORT_SCRIPT,
    forceInstallEnv: MJLAB_FORCE_INSTALL_ENV,
  });
}

async function installPybulletRuntime() {
  return installOptionalPythonRuntime({
    shouldInstall: shouldInstallPybulletRuntime,
    skipMessage: getPybulletRuntimeSkipMessage,
    icon: '🧱',
    displayName: 'PyBullet workspace adapter runtime',
    setupName: 'PyBullet',
    dependencies: PYBULLET_DEPENDENCIES,
    verifyImportScript: PYBULLET_VERIFY_IMPORT_SCRIPT,
    forceInstallEnv: PYBULLET_FORCE_INSTALL_ENV,
  });
}

async function installBackendDeps() {
  log('');
  logArrow('🔧 Installing backend Python dependencies');
  log('');

  const venvPython = getManagedPythonPath();
  const uvPath = findUv();

  if (!existsSync(venvPython)) {
    logInfo(`Unified Python environment not found at ${venvPython}. Run setup first.`);
    return false;
  }
  if (!uvPath) {
    log('✗ uv not found. Please install uv first:', colors.yellow);
    return false;
  }

  const backendPythonDependencies = resolveBackendPythonDependencies();
  const backendVerifyImportScript = resolveBackendPythonVerifyImportScript();
  if (!shouldInstallBackendNativeSimRuntime()) {
    logInfo(getBackendNativeSimSkipMessage());
  }
  if (!shouldInstallBackendCollisionStack()) {
    logInfo(getBackendCollisionStackSkipMessage());
  }

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
    }
  } catch (e) {
    logInfo('Continuing after superseded backend package cleanup could not inspect or remove superseded packages.');
  }

  const existingBackendCheck = runPythonImportCheck(venvPython, backendVerifyImportScript);
  if (existingBackendCheck.ok) {
    logSuccess('Backend Python runtime ready');
    return true;
  }
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
    return true;
  } catch (e) {
    log('✗ Failed to install backend dependencies', colors.yellow);
    logInfo(`   You can try installing manually:`);
    logInfo(`     "${uvPath}" pip install --python ${PYTHON_ENV_DIRNAME}/bin/python3 ${backendPythonDependencies.map((dependency) => JSON.stringify(dependency)).join(' ')}`);
    return false;
  }
}

async function installGenesisRuntime() {
  return installOptionalPythonRuntime({
    shouldInstall: shouldInstallGenesisRuntime,
    skipMessage: getGenesisRuntimeSkipMessage,
    icon: '🌐',
    displayName: 'Genesis workspace adapter runtime',
    setupName: 'Genesis',
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
    return;
  }

  const twinScript = join(rootDir, 'scripts', 'twin.js');
  if (!existsSync(twinScript)) {
    log('✗ Twin setup requested but scripts/twin.js was not found', colors.yellow);
    throw new Error('Missing scripts/twin.js');
  }

  log('');
  logArrow('🧬 Installing VGGT ("twin") dependencies');
  log('');
  execFileSync('node', [twinScript, '--twin'], { cwd: rootDir, stdio: 'inherit' });
}

async function runSetupSequence(overrides = {}) {
  const steps = {
    installDependencies,
    verifyIluRuntimeContract,
    setupUrdfOpsWorkspace,
    setupPythonBackendEnvironment,
    installBackendDeps,
    installGenesisRuntime,
    installPybulletRuntime,
    installOfficialLeRobotToolchain,
    installOpenArmHardwareRuntime,
    installMjlabRuntime,
    installTwinDepsIfRequested,
    checkIkd,
    setupHuggingFace,
    setupGitHub,
    installOptionalGlobalIlu,
    ...overrides,
  };

  await steps.installDependencies();
  const iluRuntimeReady = await steps.verifyIluRuntimeContract();
  if (!iluRuntimeReady) {
    throw new Error('i-love-urdf runtime setup failed');
  }
  const urdfOpsInstalled = await steps.setupUrdfOpsWorkspace();
  if (!urdfOpsInstalled) {
    throw new Error('URDF Ops setup failed');
  }
  const pythonBackendEnvironmentReady = await steps.setupPythonBackendEnvironment();
  if (!pythonBackendEnvironmentReady) {
    throw new Error('Unified Python environment setup failed');
  }
  const backendDepsInstalled = await steps.installBackendDeps();
  if (!backendDepsInstalled) {
    throw new Error('Backend dependencies installation failed');
  }
  const genesisRuntimeResult = await steps.installGenesisRuntime();
  if (shouldFailSetupForRuntimeResult(genesisRuntimeResult)) {
    throw new Error('Genesis workspace adapter runtime installation failed');
  }
  const pybulletRuntimeResult = await steps.installPybulletRuntime();
  if (shouldFailSetupForRuntimeResult(pybulletRuntimeResult)) {
    throw new Error('PyBullet workspace adapter runtime installation failed');
  }
  const lerobotToolchainInstalled = await steps.installOfficialLeRobotToolchain();
  if (!lerobotToolchainInstalled) {
    throw new Error('Official LeRobot dataset toolchain installation failed');
  }
  const openArmHardwareRuntimeInstalled = await steps.installOpenArmHardwareRuntime();
  if (!openArmHardwareRuntimeInstalled) {
    throw new Error('OpenArm hardware runtime installation failed');
  }
  const mjlabRuntimeResult = await steps.installMjlabRuntime();
  if (shouldFailSetupForRuntimeResult(mjlabRuntimeResult)) {
    throw new Error('MJLab validation runtime installation failed');
  }
  await steps.installTwinDepsIfRequested();
  await steps.checkIkd();
  await steps.setupHuggingFace();
  await steps.setupGitHub();
  const globalIluResult = await steps.installOptionalGlobalIlu();
  return { globalIluResult, genesisRuntimeResult, mjlabRuntimeResult, pybulletRuntimeResult };
}

async function main() {
  console.log(banner);

  try {
    const {
      globalIluResult,
      genesisRuntimeResult,
      mjlabRuntimeResult,
      pybulletRuntimeResult,
    } = await runSetupSequence();
    logSuccess('Setup complete');
    printSetupSummary({ globalIluResult, genesisRuntimeResult, mjlabRuntimeResult, pybulletRuntimeResult });
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
  findPythonForLeRobot,
  resolvePythonForLeRobotVenv,
  runSetupSequence,
  verifyIluRuntimeContract,
};
