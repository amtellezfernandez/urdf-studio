#!/usr/bin/env node

import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PYTHON_ENV_DIRNAME } from '../tools/scripts/setupParams.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

function isTruthy(value) {
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function run(command, options = {}) {
  execSync(command, { stdio: 'inherit', shell: true, ...options });
}

function runQuiet(command, options = {}) {
  return execSync(command, { stdio: 'pipe', encoding: 'utf-8', shell: true, ...options }).trim();
}

function findUv() {
  const candidates = [
    join(process.env.HOME || '', '.local', 'bin', 'uv'),
    join(process.env.HOME || '', '.cargo', 'bin', 'uv'),
    '/usr/local/bin/uv',
    '/usr/bin/uv',
  ];

  for (const uvPath of candidates) {
    if (existsSync(uvPath)) return uvPath;
  }

  try {
    const inPath = runQuiet('command -v uv');
    if (inPath && existsSync(inPath)) return inPath;
  } catch {
    // ignore
  }

  return null;
}

function findPythonForUnifiedEnv() {
  const candidates = [
    process.env.URDF_STUDIO_LEROBOT_BOOTSTRAP_PYTHON,
    'python3.13',
    'python3.12',
    '/usr/bin/python3.13',
    '/usr/bin/python3.12',
    join(process.env.HOME || '', 'miniconda3', 'bin', 'python3.13'),
    join(process.env.HOME || '', 'miniconda3', 'bin', 'python3.12'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const version = runQuiet(
        `${candidate} -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"`
      );
      const [major, minor] = version.split('.').map(Number);
      if (major > 3 || (major === 3 && minor >= 12)) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function ensureVenv() {
  const venvPath = join(rootDir, PYTHON_ENV_DIRNAME);
  const venvPython = join(venvPath, 'bin', 'python3');

  if (existsSync(venvPython)) return { venvPath, venvPython };

  const pythonPath = findPythonForUnifiedEnv();
  if (!pythonPath) {
    throw new Error('Python 3.12+ is required for the unified Python environment');
  }

  const uvPath = findUv();
  if (uvPath) {
    run(`"${uvPath}" venv --python "${pythonPath}" "${PYTHON_ENV_DIRNAME}"`, { cwd: rootDir });
  } else {
    run(`"${pythonPath}" -m venv "${PYTHON_ENV_DIRNAME}"`, { cwd: rootDir });
  }

  if (!existsSync(venvPython)) {
    throw new Error(`Failed to create ${PYTHON_ENV_DIRNAME} (missing ${PYTHON_ENV_DIRNAME}/bin/python3)`);
  }

  try {
    runQuiet(`${venvPython} -m pip --version`, { cwd: rootDir });
  } catch {
    run(`${venvPython} -m ensurepip --upgrade`, { cwd: rootDir });
  }

  return { venvPath, venvPython };
}

function ensureVggtRepo() {
  const vggtDir = join(rootDir, 'vggt');
  if (existsSync(vggtDir)) return vggtDir;

  try {
    run('git clone git@github.com:facebookresearch/vggt.git vggt', { cwd: rootDir });
  } catch (sshError) {
    run('git clone https://github.com/facebookresearch/vggt.git vggt', { cwd: rootDir });
  }

  if (!existsSync(vggtDir)) {
    throw new Error('Failed to clone VGGT into ./vggt');
  }
  return vggtDir;
}

function installVggtRequirements(venvPython, vggtDir) {
  const requirementsPath = join(vggtDir, 'requirements.txt');
  if (!existsSync(requirementsPath)) {
    throw new Error(`Missing requirements file: ${requirementsPath}`);
  }

  const env = {
    ...process.env,
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
  };

  run(`${venvPython} -m pip install -r requirements.txt`, { cwd: vggtDir, env });
}

async function main() {
  const shouldInstallTwin =
    process.argv.includes('--twin') ||
    isTruthy(process.env.npm_config_twin) ||
    isTruthy(process.env.TWIN);

  if (!shouldInstallTwin) return;

  console.log('[twin] Installing optional VGGT dependencies...');

  const { venvPython } = ensureVenv();
  const vggtDir = ensureVggtRepo();
  installVggtRequirements(venvPython, vggtDir);

  console.log('[twin] Done.');
}

main().catch((err) => {
  console.error('[twin] Failed:', err?.message || err);
  process.exit(1);
});
