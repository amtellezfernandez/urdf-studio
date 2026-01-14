#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync, spawn } from 'child_process';

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
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  underline: '\x1b[4m',
};

const verbose = /^(1|true|yes)$/i.test(process.env.URDF_STUDIO_VERBOSE || '');

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logArrow(message) {
  log(`→ ${message}`, colors.pink);
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

const banner = `
${colors.pinkBright}    __  ______  ____  ______   _____ __            ___    ${colors.reset}
${colors.pinkBright}   / / / / __ \\/ __ \\/ ____/  / ___// /___  ______/ (_)___ ${colors.reset}
${colors.pink}  / / / / /_/ / / / / /_      \\__ \\/ __/ / / / __  / / __ \\${colors.reset}
${colors.pink} / /_/ / _, _/ /_/ / __/     ___/ / /_/ /_/ / /_/ / / /_/ /${colors.reset}
${colors.pinkLight} \\____/_/ |_/_____/_/       /____/\\__/\\__,_/\\__,_/_/\\____/ ${colors.reset}
${colors.reset}                                                            

${colors.gray}─────────────────────────────────────────────────────────────${colors.reset}
`;

function filterViteOutput(data) {
  if (verbose) {
    return true;
  }
  const output = data.toString();
  
  // Filter out vite's default output
  if (output.includes('VITE') || 
      output.includes('ready in') || 
      output.includes('Local:') ||
      output.includes('Network:') ||
      output.includes('➜')) {
    return false; // Don't show vite's output
  }
  
  // Show errors and warnings
  if (output.includes('Error') || output.includes('Warning') || output.includes('error')) {
    return true;
  }
  
  return false; // Hide most vite output
}

function main() {
  console.log(banner);
  logArrow('Starting URDF Studio...');
  
  const config = loadConfig();
  const hfToken = config.huggingfaceToken;
  const githubToken = config.githubToken;
  
  // Set environment variables if tokens exist
  const env = { ...process.env };
  if (hfToken) {
    env.VITE_HUGGINGFACE_TOKEN = hfToken;
  }
  if (githubToken) {
    env.VITE_GITHUB_TOKEN = githubToken;
  }
  
  // Check if node_modules exists
  if (!existsSync(join(rootDir, 'node_modules'))) {
    log('⚠ Dependencies not installed. Run "urdf-studio setup" first.', colors.yellow);
    process.exit(1);
  }
  
  log('');
  log('  Frontend:', colors.reset);
  log(`  ${colors.pinkBright}${colors.underline}http://localhost:5173${colors.reset}`, colors.reset);
  log('  Backend API:', colors.reset);
  log(`  ${colors.pinkBright}${colors.underline}http://localhost:8000${colors.reset}`, colors.reset);
  log('');
  log('  Press Ctrl+C to stop', colors.gray);
  log('');

  // Start Python FastAPI backend
  const venvPython = join(rootDir, '.venv', 'bin', 'python3');
  let pythonBackendProcess = null;

  if (existsSync(venvPython)) {
    pythonBackendProcess = spawn(venvPython, ['-m', 'uvicorn', 'backend.server:app', '--reload', '--port', '8000', '--app-dir', 'apps'], {
      cwd: rootDir,
      env,
      shell: true,
      stdio: 'pipe',
    });

    // Only show errors from Python backend
    pythonBackendProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (verbose || output.includes('ERROR') || output.includes('Error') || output.includes('WARNING')) {
        process.stdout.write(`[Backend] ${data}`);
      }
    });

    pythonBackendProcess.stderr.on('data', (data) => {
      process.stderr.write(`[Backend] ${data}`);
    });
  } else {
    log('  ⚠ Python backend not started (run npm run setup first)', colors.yellow);
  }

  // Start the dev server with filtered output
  const viteProcess = spawn('npm', ['run', 'dev'], {
    cwd: rootDir,
    env,
    shell: true,
  });
  
  // Capture and filter stdout
  viteProcess.stdout.on('data', (data) => {
    if (filterViteOutput(data)) {
      process.stdout.write(data);
    }
  });
  
  // Capture and filter stderr
  viteProcess.stderr.on('data', (data) => {
    if (filterViteOutput(data)) {
      process.stderr.write(data);
    }
  });
  
  viteProcess.on('error', (error) => {
    log(`✗ Failed to start: ${error.message}`, colors.red);
    process.exit(1);
  });
  
  // Handle process termination
  process.on('SIGINT', () => {
    log('');
    log('  Stopping URDF Studio...', colors.gray);
    viteProcess.kill('SIGINT');
    if (pythonBackendProcess) {
      pythonBackendProcess.kill('SIGINT');
    }
    setTimeout(() => {
      process.exit(0);
    }, 500);
  });

  process.on('SIGTERM', () => {
    viteProcess.kill('SIGTERM');
    if (pythonBackendProcess) {
      pythonBackendProcess.kill('SIGTERM');
    }
    process.exit(0);
  });
}

main();
