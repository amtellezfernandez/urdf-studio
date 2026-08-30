#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, '..', '..');
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const declaredPackages = [
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
];
const missingPackages = declaredPackages.filter(
  (packageName) => !existsSync(join(rootDir, 'node_modules', packageName))
);

if (missingPackages.length === 0) {
  process.exit(0);
}

console.log(`Installing missing Node dependencies: ${missingPackages.join(', ')}`);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCommand, ['install', '--no-audit', '--no-fund'], {
  cwd: rootDir,
  stdio: 'inherit',
});

if (result.status !== 0 || result.error) {
  throw result.error ?? new Error(`npm install failed with exit code ${result.status}`);
}
