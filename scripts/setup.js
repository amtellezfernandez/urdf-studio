#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

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

async function installDependencies() {
  logArrow('Installing dependencies...');
  
  try {
    if (!existsSync(join(rootDir, 'node_modules'))) {
      execSync('npm install', { stdio: 'inherit', cwd: rootDir, shell: true });
    } else {
      const inquirerPath = join(rootDir, 'node_modules', 'inquirer');
      if (!existsSync(inquirerPath)) {
        logInfo('Installing inquirer...');
        execSync('npm install inquirer', { stdio: 'inherit', cwd: rootDir, shell: true });
      }
    }
    logSuccess('Dependencies installed successfully');
  } catch (error) {
    log('✗ Failed to install dependencies', colors.yellow);
    throw error;
  }
}

function getConfigPath() {
  return join(rootDir, '.urdf-studio-config.json');
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
  log('');
  logArrow('🤗 HuggingFace Authentication (Optional)');
  log('');
  
  const config = loadConfig();
  const currentToken = config.huggingfaceToken || '';
  const configPath = getConfigPath();
  
  if (currentToken) {
    const maskedToken = currentToken.substring(0, 8) + '...' + currentToken.substring(currentToken.length - 4);
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
    logUrl('https://huggingface.co/settings/tokens', 'Visit');
    logInfo('1. Click "New token"');
    logInfo('2. Set permissions: Read access to repos + Write access to repos');
    logInfo('3. Copy the token (starts with hf_)');
    log('');
  }
  
  logInfo(`${colors.yellow}⚠ Security: Your token will be saved locally on your computer, keep it private and never share it.${colors.reset}`);
  logInfo(`   Saved to: ${colors.gray}${configPath}${colors.reset}`);
  log('');
  
  // Ask for token input (completely hidden)
  const inquirer = (await import('inquirer')).default;
  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: `${colors.pinkBright}  Enter your HuggingFace token (or press Enter to skip):${colors.reset}`,
      mask: '', // Completely hidden
    },
  ]);
  
  if (token?.trim()) {
    config.huggingfaceToken = token.trim();
    saveConfig(config);
    logSuccess('HuggingFace token saved');
    logInfo(`   Location: ${colors.gray}${configPath}${colors.reset}`);
  } else {
    logInfo('No token entered. Token setup cancelled.');
  }
}

async function setupGitHub() {
  log('');
  logArrow('🐙 GitHub Authentication (Optional)');
  log('');
  
  const config = loadConfig();
  const currentToken = config.githubToken || '';
  const configPath = getConfigPath();
  
  if (currentToken) {
    const maskedToken = currentToken.substring(0, 8) + '...' + currentToken.substring(currentToken.length - 4);
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
  } else {
    logInfo('A GitHub token is required for loading, editing, and saving content from GitHub repositories, including private repos and creating pull requests.');
    log('');
    logInfo('To create a token:');
    logUrl('https://github.com/settings/tokens?type=beta', 'Visit');
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
  const inquirer = (await import('inquirer')).default;
  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: `${colors.purpleBright}  Enter your GitHub token (or press Enter to skip):${colors.reset}`,
      mask: '', // Completely hidden
    },
  ]);
  
  if (token?.trim()) {
    config.githubToken = token.trim();
    saveConfig(config);
    logSuccess('GitHub token saved');
    logInfo(`   Location: ${colors.gray}${configPath}${colors.reset}`);
  } else {
    logInfo('No token entered. Token setup cancelled.');
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
  try {
    const result = execSync('command -v uv', { stdio: 'pipe', encoding: 'utf-8', shell: true }).trim();
    if (result && existsSync(result)) {
      return result;
    }
  } catch (e) {
    // Not in PATH
  }

  return null;
}

async function checkRerun() {
  log('');
  logArrow('🔍 Setting up Python environment and Rerun');
  log('');

  const venvPath = join(rootDir, '.venv');
  const venvPython = join(venvPath, 'bin', 'python3');

  // Check if uv is available
  const uvPath = findUv();
  if (!uvPath) {
    log('✗ uv not found. Please install uv first:', colors.yellow);
    log('');
    logInfo('Install uv with:');
    logInfo('  curl -LsSf https://astral.sh/uv/install.sh | sh');
    log('');
    logInfo(`${colors.yellow}⚠ You can still use URDF Studio without Rerun, but the Rerun Viewer feature will not work.${colors.reset}`);
    return false;
  }

  logSuccess(`Found uv at: ${uvPath}`);

  // Create virtual environment if it doesn't exist
  if (!existsSync(venvPath)) {
    logInfo('Creating Python virtual environment...');
    try {
      // Try to find system Python (non-conda)
      let pythonPath = '/usr/bin/python3';
      if (!existsSync(pythonPath)) {
        // Fallback to any available python3
        pythonPath = 'python3';
      }
      execSync(`"${uvPath}" venv --python ${pythonPath}`, { cwd: rootDir, stdio: 'inherit', shell: true });
      logSuccess('Virtual environment created');
    } catch (e) {
      log('✗ Failed to create virtual environment', colors.yellow);
      return false;
    }
  } else {
    logInfo('Virtual environment already exists');
  }

  // Check if rerun-sdk is already installed
  try {
    execSync(`${venvPython} -c "import rerun; print(rerun.__version__)"`, { stdio: 'pipe' });
    const version = execSync(`${venvPython} -c "import rerun; print(rerun.__version__)"`, {
      stdio: 'pipe',
      encoding: 'utf-8'
    }).trim();
    logSuccess(`Rerun SDK already installed (version ${version})`);
    return true;
  } catch (e) {
    // Not installed, proceed with installation
  }

  // Install rerun-sdk in the virtual environment
  logInfo('Installing rerun-sdk in virtual environment...');
  try {
    execSync(`"${uvPath}" pip install --python ${venvPython} rerun-sdk`, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true
    });

    // Verify installation
    const version = execSync(`${venvPython} -c "import rerun; print(rerun.__version__)"`, {
      stdio: 'pipe',
      encoding: 'utf-8'
    }).trim();
    logSuccess(`Rerun SDK installed successfully (version ${version})`);
    logInfo('   Virtual environment: .venv/');
    return true;
  } catch (installError) {
    log('✗ Failed to install rerun-sdk', colors.yellow);
    logInfo('   You can try installing manually:');
    logInfo(`     "${uvPath}" pip install --python .venv/bin/python3 rerun-sdk`);
    log('');
    logInfo(`${colors.yellow}⚠ You can still use URDF Studio without Rerun, but the Rerun Viewer feature will not work.${colors.reset}`);
    return false;
  }
}

async function main() {
  console.log(banner);
  
  try {
    await installDependencies();
    await checkRerun();
    await setupHuggingFace();
    await setupGitHub();
    
    log('');
    logSuccess('Setup complete');
    log('');
  } catch (error) {
    log('');
    log('✗ Setup failed', colors.yellow);
    process.exit(1);
  }
}

main();

