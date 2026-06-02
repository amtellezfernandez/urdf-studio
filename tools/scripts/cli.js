#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..', '..');

const command = process.argv[2];
const commandArgs = process.argv.slice(3);

function spawnNodeScript(scriptPath, args = []) {
  return spawn(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    shell: false,
    cwd: rootDir,
  });
}

if (command === 'setup') {
  // Run setup script
  const setupScript = join(__dirname, 'setup.js');
  const setupProcess = spawnNodeScript(setupScript, commandArgs);
  
  setupProcess.on('exit', (code) => {
    process.exit(code || 0);
  });
} else if (command === 'start' || !command) {
  // Run the app (default)
  const runScript = join(__dirname, 'run.js');
  const runProcess = spawnNodeScript(runScript, commandArgs);
  
  runProcess.on('exit', (code) => {
    process.exit(code || 0);
  });
} else if (command === 'world') {
  const worldScript = join(__dirname, 'world-package-cli.js');
  const worldProcess = spawnNodeScript(worldScript, commandArgs);

  worldProcess.on('exit', (code) => {
    process.exit(code || 0);
  });
} else if (command === '--help' || command === '-h') {
  console.log('URDF Studio - Robot Learning Dataset Management');
  console.log('');
  console.log('Usage: urdf-studio [command]');
  console.log('');
  console.log('Commands:');
  console.log('  setup   Install deps, local ilu CLI access, and optional auth');
  console.log('  start   Start URDF Studio locally (run "urdf-studio start --help" for options)');
  console.log('  world   Validate/publish/list world packages');
  console.log('  --help  Show this help message');
  process.exit(0);
} else {
  console.log(`Unknown command: ${command}`);
  console.log('Run "urdf-studio --help" for usage information');
  process.exit(1);
}
