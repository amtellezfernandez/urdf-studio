import test from 'node:test';
import assert from 'node:assert/strict';

import { resolvePythonForLeRobotVenv, runSetupSequence } from './setup.js';

test('setup uses uv-managed Python 3.12 by default', () => {
  const originalBootstrapPython = process.env.URDF_STUDIO_LEROBOT_BOOTSTRAP_PYTHON;
  delete process.env.URDF_STUDIO_LEROBOT_BOOTSTRAP_PYTHON;

  try {
    assert.deepEqual(resolvePythonForLeRobotVenv(), {
      python: '3.12',
      usesUvManagedPython: true,
    });
  } finally {
    if (originalBootstrapPython === undefined) {
      delete process.env.URDF_STUDIO_LEROBOT_BOOTSTRAP_PYTHON;
    } else {
      process.env.URDF_STUDIO_LEROBOT_BOOTSTRAP_PYTHON = originalBootstrapPython;
    }
  }
});

test('setup rejects an invalid explicit Python override', () => {
  const originalBootstrapPython = process.env.URDF_STUDIO_LEROBOT_BOOTSTRAP_PYTHON;
  process.env.URDF_STUDIO_LEROBOT_BOOTSTRAP_PYTHON = '/definitely/not/python3.12';

  try {
    assert.equal(resolvePythonForLeRobotVenv(), null);
  } finally {
    if (originalBootstrapPython === undefined) {
      delete process.env.URDF_STUDIO_LEROBOT_BOOTSTRAP_PYTHON;
    } else {
      process.env.URDF_STUDIO_LEROBOT_BOOTSTRAP_PYTHON = originalBootstrapPython;
    }
  }
});

test('setup stops before backend dependency installation when unified Python setup fails', async () => {
  const calls = [];
  const record = (name, result) => async () => {
    calls.push(name);
    return result;
  };
  const unreachable = (name) => async () => {
    calls.push(name);
    throw new Error(`${name} should not be reached`);
  };

  await assert.rejects(
    runSetupSequence({
      installDependencies: record('installDependencies'),
      setupUrdfOpsWorkspace: record('setupUrdfOpsWorkspace', true),
      setupPythonBackendEnvironment: record('setupPythonBackendEnvironment', false),
      installBackendDeps: unreachable('installBackendDeps'),
      installGenesisRuntime: unreachable('installGenesisRuntime'),
      installOfficialLeRobotToolchain: unreachable('installOfficialLeRobotToolchain'),
      installOpenArmHardwareRuntime: unreachable('installOpenArmHardwareRuntime'),
      installMjlabRuntime: unreachable('installMjlabRuntime'),
      installTwinDepsIfRequested: unreachable('installTwinDepsIfRequested'),
      checkIkd: unreachable('checkIkd'),
      setupHuggingFace: unreachable('setupHuggingFace'),
      setupGitHub: unreachable('setupGitHub'),
      installOptionalGlobalIlu: unreachable('installOptionalGlobalIlu'),
    }),
    /Unified Python environment setup failed/
  );

  assert.deepEqual(calls, [
    'installDependencies',
    'setupUrdfOpsWorkspace',
    'setupPythonBackendEnvironment',
  ]);
});
