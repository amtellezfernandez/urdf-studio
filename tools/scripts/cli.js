#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..', '..');

const command = process.argv[2];

if (command === 'setup') {
  // Run setup script
  const setupScript = join(__dirname, 'setup.js');
  const setupProcess = spawn('node', [setupScript], {
    stdio: 'inherit',
    shell: true,
    cwd: rootDir,
  });
  
  setupProcess.on('exit', (code) => {
    process.exit(code || 0);
  });
} else if (command === 'start' || !command) {
  // Run the app (default)
  const runScript = join(__dirname, 'run.js');
  const runProcess = spawn('node', [runScript], {
    stdio: 'inherit',
    shell: true,
    cwd: rootDir,
  });
  
  runProcess.on('exit', (code) => {
    process.exit(code || 0);
  });
} else if (command === '--help' || command === '-h') {
  console.log('URDF Studio - Robot Learning Dataset Management');
  console.log('');
  console.log('Usage: urdf-studio [command]');
  console.log('');
  console.log('Commands:');
  console.log('  setup   Install dependencies and configure HuggingFace');
  console.log('  start   Start URDF Studio (default)');
  console.log('  --help  Show this help message');
  process.exit(0);
} else {
  console.log(`Unknown command: ${command}`);
  console.log('Run "urdf-studio --help" for usage information');
  process.exit(1);
}
