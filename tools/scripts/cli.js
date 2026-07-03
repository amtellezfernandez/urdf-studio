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

function runNodeScript(scriptName, args = commandArgs) {
  const childProcess = spawnNodeScript(join(__dirname, scriptName), args);
  childProcess.on('exit', (code) => {
    process.exit(code || 0);
  });
}

function printHelp() {
  console.log('URDF Studio - URDF loading and simulator transfer');
  console.log('');
  console.log('Usage: urdf-studio [command]');
  console.log('');
  console.log('Commands:');
  console.log('  setup   Install deps, local ilu CLI access, and optional auth');
  console.log('  start   Start URDF Studio locally (run "urdf-studio start --help" for options)');
  console.log('  world   Validate/publish/list world packages');
  console.log('  --help  Show this help message');
}

if (command === 'setup') {
  runNodeScript('setup.js');
} else if (command === 'start' || !command) {
  runNodeScript('run.js');
} else if (command === 'world') {
  runNodeScript('world-package-cli.js');
} else if (command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
} else {
  console.log(`Unknown command: ${command}`);
  console.log('Run "urdf-studio --help" for usage information');
  process.exit(1);
}
