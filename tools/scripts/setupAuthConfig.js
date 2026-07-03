import { existsSync, readFileSync, writeFileSync } from 'fs';
import readline from 'readline';
import { join } from 'path';

import { maskToken, resolveSetupGitHubToken } from './githubAuth.js';
import { isTruthyEnvValue } from './setupHelpers.js';
import { buildSetupResult } from './setupCommandResults.js';
import {
  GITHUB_CLI_LOGIN_COMMAND,
  GITHUB_FINE_GRAINED_TOKEN_URL,
  HUGGING_FACE_TOKEN_URL,
} from './setupParams.js';

export function isInteractive({
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

export function createQuestionPrompt({
  stdin = process.stdin,
  stdout = process.stdout,
  createInterface = readline.createInterface,
} = {}) {
  return (query) => {
    const rl = createInterface({
      input: stdin,
      output: stdout,
    });
    return new Promise((resolve) => {
      rl.question(query, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  };
}

export function shouldOfferTokenSetup({
  env = process.env,
  argv = process.argv,
} = {}) {
  if (env.URDF_STUDIO_SKIP_TOKENS) {
    return false;
  }
  return (
    argv.includes('--auth') ||
    argv.includes('--tokens') ||
    isTruthyEnvValue(env.URDF_STUDIO_SETUP_TOKENS)
  );
}

export function getSetupConfigPath(rootDir) {
  return join(rootDir, '.urdf-studio-config.json');
}

export function getAppConfigPath(rootDir) {
  return join(rootDir, 'config', 'app.config.json');
}

export function loadJsonConfig(
  configPath,
  {
    existsSyncImpl = existsSync,
    readFileSyncImpl = readFileSync,
  } = {}
) {
  if (!existsSyncImpl(configPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSyncImpl(configPath, 'utf-8'));
  } catch (_error) {
    return {};
  }
}

export function loadAppConfig(rootDir, options = {}) {
  return loadJsonConfig(getAppConfigPath(rootDir), options);
}

export function loadSetupConfig(rootDir, options = {}) {
  return loadJsonConfig(getSetupConfigPath(rootDir), options);
}

export function saveSetupConfig(
  rootDir,
  config,
  {
    writeFileSyncImpl = writeFileSync,
  } = {}
) {
  const configPath = getSetupConfigPath(rootDir);
  writeFileSyncImpl(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export async function promptHiddenToken({
  message,
  fallbackQuery,
  question,
  logInfo = () => {},
  importInquirer = () => import('inquirer'),
}) {
  try {
    const inquirer = (await importInquirer()).default;
    const { token } = await inquirer.prompt([
      {
        type: 'password',
        name: 'token',
        message,
        mask: '',
      },
    ]);
    return token || '';
  } catch (error) {
    logInfo(`Token prompt unavailable (${error?.message || 'unknown error'}).`);
    return (await question(fallbackQuery)).trim();
  }
}

function normalizedAnswer(value) {
  return String(value || '').trim().toLowerCase();
}

function shouldContinueTokenSetup(answer) {
  const normalized = normalizedAnswer(answer);
  return normalized === 'y' || normalized === 'yes';
}

function shouldRemoveToken(answer) {
  const normalized = normalizedAnswer(answer);
  return normalized === 'r' || normalized === 'remove';
}

function shouldUpdateToken(answer) {
  const normalized = normalizedAnswer(answer);
  return normalized === 's' || normalized === 'substitute' || normalized === 'update';
}

function shouldKeepDetectedGitHubAccess(answer) {
  const normalized = normalizedAnswer(answer);
  return normalized === '' || normalized === 'k' || normalized === 'keep';
}

function shouldSaveDetectedGitHubAccess(answer) {
  const normalized = normalizedAnswer(answer);
  return normalized === 's' || normalized === 'save';
}

function shouldEnterManualGitHubToken(answer) {
  const normalized = normalizedAnswer(answer);
  return normalized === 'm' || normalized === 'manual';
}

function colorText(text, color, reset) {
  return color ? `${color}${text}${reset || ''}` : text;
}

function buildAuthRuntimeOptions({
  rootDir,
  env = process.env,
  argv = process.argv,
  stdin = process.stdin,
  stdout = process.stdout,
  colors = {},
  question = null,
  loadConfig = null,
  saveConfig = null,
  shouldOfferTokenSetupImpl = shouldOfferTokenSetup,
  isInteractiveImpl = isInteractive,
  maskTokenImpl = maskToken,
  importInquirer,
  log = () => {},
  logArrow = () => {},
  logInfo = () => {},
  logSuccess = () => {},
  logUrl = () => {},
} = {}) {
  const root = rootDir || process.cwd();
  return {
    rootDir: root,
    env,
    argv,
    stdin,
    stdout,
    colors,
    question: question || createQuestionPrompt({ stdin, stdout }),
    loadConfig: loadConfig || (() => loadSetupConfig(root)),
    saveConfig: saveConfig || ((config) => saveSetupConfig(root, config)),
    shouldOfferTokenSetupImpl,
    isInteractiveImpl,
    maskTokenImpl,
    importInquirer,
    log,
    logArrow,
    logInfo,
    logSuccess,
    logUrl,
  };
}

export async function setupHuggingFace(options = {}) {
  const runtime = buildAuthRuntimeOptions(options);
  if (
    !runtime.shouldOfferTokenSetupImpl({ env: runtime.env, argv: runtime.argv }) ||
    !runtime.isInteractiveImpl({ stdin: runtime.stdin, stdout: runtime.stdout })
  ) {
    return buildSetupResult();
  }

  const configPath = getSetupConfigPath(runtime.rootDir);
  const config = runtime.loadConfig();
  const currentToken = config.huggingfaceToken || '';
  const reset = runtime.colors.reset || '';
  const pinkBright = runtime.colors.pinkBright || '';
  const yellow = runtime.colors.yellow || '';
  const gray = runtime.colors.gray || '';

  runtime.log('');
  runtime.logArrow('Hugging Face authentication');
  runtime.log('');

  const hfAnswer = await runtime.question('  Set up HuggingFace token now? (y/N): ');
  if (!shouldContinueTokenSetup(hfAnswer)) {
    return buildSetupResult();
  }

  if (currentToken) {
    runtime.logInfo(`Current token: ${colorText(runtime.maskTokenImpl(currentToken), pinkBright, reset)}`);
    runtime.log('');
    runtime.logInfo('Options:');
    runtime.logInfo('  [r] Remove token');
    runtime.logInfo('  [s] Substitute/Update token');
    runtime.logInfo('  [Enter] Skip (keep current)');
    runtime.log('');

    const action = await runtime.question(`  Choose an option: ${pinkBright}`);
    if (shouldRemoveToken(action)) {
      delete config.huggingfaceToken;
      runtime.saveConfig(config);
      runtime.logSuccess('HuggingFace token removed');
      return buildSetupResult({ changed: true });
    }
    if (!shouldUpdateToken(action)) {
      runtime.logInfo('Token unchanged (keeping current token).');
      return buildSetupResult();
    }
  } else {
    runtime.logInfo('A token is only needed for private Hugging Face resources. Public simulator transfer does not require it.');
    runtime.log('');
    runtime.logInfo('To create a token:');
    runtime.logUrl(HUGGING_FACE_TOKEN_URL, 'Visit');
    runtime.logInfo('1. Click "New token"');
    runtime.logInfo('2. Set permissions for the private resources you need');
    runtime.logInfo('3. Copy the token (starts with hf_)');
    runtime.log('');
  }

  runtime.logInfo(`${yellow}Security: Your token will be saved locally on your computer; keep it private and never share it.${reset}`);
  runtime.logInfo(`   Saved to: ${gray}${configPath}${reset}`);
  runtime.log('');

  const token = await promptHiddenToken({
    message: `${pinkBright}  Enter your HuggingFace token (or press Enter to skip):${reset}`,
    fallbackQuery: '  Enter your HuggingFace token (visible input, or press Enter to skip): ',
    question: runtime.question,
    logInfo: runtime.logInfo,
    importInquirer: runtime.importInquirer,
  });

  if (token?.trim()) {
    config.huggingfaceToken = token.trim();
    runtime.saveConfig(config);
    runtime.logSuccess('HuggingFace token saved');
    runtime.logInfo(`   Location: ${gray}${configPath}${reset}`);
    return buildSetupResult({ changed: true });
  }
  return buildSetupResult();
}

export async function setupGitHub(options = {}) {
  const runtime = buildAuthRuntimeOptions(options);
  const resolveSetupGitHubTokenImpl = options.resolveSetupGitHubTokenImpl || resolveSetupGitHubToken;
  if (
    !runtime.shouldOfferTokenSetupImpl({ env: runtime.env, argv: runtime.argv }) ||
    !runtime.isInteractiveImpl({ stdin: runtime.stdin, stdout: runtime.stdout })
  ) {
    return buildSetupResult();
  }

  const configPath = getSetupConfigPath(runtime.rootDir);
  const config = runtime.loadConfig();
  const currentToken = config.githubToken || '';
  const reset = runtime.colors.reset || '';
  const purpleBright = runtime.colors.purpleBright || '';
  const yellow = runtime.colors.yellow || '';
  const gray = runtime.colors.gray || '';

  runtime.log('');
  runtime.logArrow('GitHub access');
  runtime.log('');

  const ghAnswer = await runtime.question('  Configure GitHub access now? (y/N): ');
  if (!shouldContinueTokenSetup(ghAnswer)) {
    return buildSetupResult();
  }

  if (currentToken) {
    runtime.logInfo(`Current token: ${colorText(runtime.maskTokenImpl(currentToken), purpleBright, reset)}`);
    runtime.log('');
    runtime.logInfo('Options:');
    runtime.logInfo('  [r] Remove token');
    runtime.logInfo('  [s] Substitute/Update token');
    runtime.logInfo('  [Enter] Skip (keep current)');
    runtime.log('');

    const action = await runtime.question(`  Choose an option: ${purpleBright}`);
    if (shouldRemoveToken(action)) {
      delete config.githubToken;
      runtime.saveConfig(config);
      runtime.logSuccess('GitHub token removed');
      return buildSetupResult({ changed: true });
    }
    if (!shouldUpdateToken(action)) {
      runtime.logInfo('Token unchanged (keeping current token).');
      return buildSetupResult();
    }
  }

  const detectedGitHubAuth = resolveSetupGitHubTokenImpl();
  if (!currentToken && detectedGitHubAuth.token) {
    const maskedDetectedToken = runtime.maskTokenImpl(detectedGitHubAuth.token);
    runtime.logInfo(
      `Detected GitHub access via ${colorText(detectedGitHubAuth.source, purpleBright, reset)}: ${colorText(maskedDetectedToken, purpleBright, reset)}`
    );
    runtime.logInfo('URDF Studio can already reuse this access without saving a local token.');
    runtime.log('');
    runtime.logInfo('Options:');
    runtime.logInfo('  [Enter] Keep using detected access (recommended)');
    runtime.logInfo('  [s] Save detected token locally');
    runtime.logInfo('  [m] Enter a different token manually');
    runtime.log('');

    const detectedAction = await runtime.question(`  Choose an option: ${purpleBright}`);
    if (shouldKeepDetectedGitHubAccess(detectedAction)) {
      runtime.logInfo('Detected GitHub access will be reused without saving a local token.');
      return buildSetupResult();
    }
    if (shouldSaveDetectedGitHubAccess(detectedAction)) {
      config.githubToken = detectedGitHubAuth.token;
      runtime.saveConfig(config);
      runtime.logSuccess('GitHub token saved');
      runtime.logInfo(`   Source: ${gray}${detectedGitHubAuth.source}${reset}`);
      runtime.logInfo(`   Location: ${gray}${configPath}${reset}`);
      return buildSetupResult({ changed: true });
    }
    if (!shouldEnterManualGitHubToken(detectedAction)) {
      runtime.logInfo('Detected GitHub access not saved. You can still enter a token manually later.');
      return buildSetupResult();
    }
    runtime.logInfo('Detected GitHub access not saved. Enter a different token below if you still want a local fallback.');
    runtime.log('');
  }

  if (!currentToken) {
    runtime.logInfo('Recommended GitHub access options:');
    runtime.logInfo(`1. Run ${purpleBright}${GITHUB_CLI_LOGIN_COMMAND}${reset} (recommended, nothing stored locally)`);
    runtime.logInfo('2. Export GITHUB_TOKEN or GH_TOKEN in your shell');
    runtime.logInfo('3. Save a fine-grained token locally for URDF Studio only');
    runtime.log('');
    runtime.logInfo('If you want to create a token:');
    runtime.logUrl(GITHUB_FINE_GRAINED_TOKEN_URL, 'Visit');
    runtime.logInfo('1. Click "Generate new token (Fine-grained)"');
    runtime.logInfo('2. Under Repository access, choose:');
    runtime.logInfo('   Only select repositories');
    runtime.logInfo('   (Pick the repos you want URDF Studio to access)');
    runtime.logInfo('3. Under Repository permissions, enable:');
    runtime.logInfo('   Contents -> Read and write');
    runtime.logInfo('   Pull requests -> Read and write');
    runtime.logInfo('   Metadata -> Read (usually enabled by default)');
    runtime.logInfo('4. Generate the token and copy it (it will look like github_pat_...)');
    runtime.log('');
  }

  runtime.logInfo(`${yellow}Security: Your token is stored locally on your computer only.${reset}`);
  runtime.logInfo(`   It is never shared or uploaded anywhere.${reset}`);
  runtime.logInfo(`   Saved to: ${gray}${configPath}${reset}`);
  runtime.log('');

  const token = await promptHiddenToken({
    message: `${purpleBright}  Enter your GitHub token (or press Enter to skip):${reset}`,
    fallbackQuery: '  Enter your GitHub token (visible input, or press Enter to skip): ',
    question: runtime.question,
    logInfo: runtime.logInfo,
    importInquirer: runtime.importInquirer,
  });

  if (token?.trim()) {
    config.githubToken = token.trim();
    runtime.saveConfig(config);
    runtime.logSuccess('GitHub token saved');
    runtime.logInfo(`   Location: ${gray}${configPath}${reset}`);
    return buildSetupResult({ changed: true });
  }
  return buildSetupResult();
}
