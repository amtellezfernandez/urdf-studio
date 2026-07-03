import test from 'node:test';
import assert from 'node:assert/strict';

import { runSetupSequence } from './setupSequence.js';

test('setup sequence stops before backend dependency installation when unified Python setup fails', async () => {
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
      verifyIluRuntimeContract: record('verifyIluRuntimeContract', true),
      setupPythonBackendEnvironment: record('setupPythonBackendEnvironment', false),
      checkSimulatorCompatibility: unreachable('checkSimulatorCompatibility'),
      installBackendDeps: unreachable('installBackendDeps'),
      installGenesisRuntime: unreachable('installGenesisRuntime'),
      installMjlabRuntime: unreachable('installMjlabRuntime'),
      installPybulletRuntime: unreachable('installPybulletRuntime'),
      installBlenderRuntime: unreachable('installBlenderRuntime'),
      installSimulatorContainers: unreachable('installSimulatorContainers'),
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
    'verifyIluRuntimeContract',
    'setupPythonBackendEnvironment',
  ]);
});

test('setup sequence stops before workspace setup when i-love-urdf runtime check fails', async () => {
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
      verifyIluRuntimeContract: record('verifyIluRuntimeContract', false),
      setupPythonBackendEnvironment: unreachable('setupPythonBackendEnvironment'),
      checkSimulatorCompatibility: unreachable('checkSimulatorCompatibility'),
      installBackendDeps: unreachable('installBackendDeps'),
      installGenesisRuntime: unreachable('installGenesisRuntime'),
      installMjlabRuntime: unreachable('installMjlabRuntime'),
      installPybulletRuntime: unreachable('installPybulletRuntime'),
      installBlenderRuntime: unreachable('installBlenderRuntime'),
      installSimulatorContainers: unreachable('installSimulatorContainers'),
      installTwinDepsIfRequested: unreachable('installTwinDepsIfRequested'),
      checkIkd: unreachable('checkIkd'),
      setupHuggingFace: unreachable('setupHuggingFace'),
      setupGitHub: unreachable('setupGitHub'),
      installOptionalGlobalIlu: unreachable('installOptionalGlobalIlu'),
    }),
    /i-love-urdf runtime setup failed/
  );

  assert.deepEqual(calls, [
    'installDependencies',
    'verifyIluRuntimeContract',
  ]);
});

test('setup sequence continues when optional simulator adapters are unavailable', async () => {
  const calls = [];
  const record = (name, result) => async () => {
    calls.push(name);
    return result;
  };

  const result = await runSetupSequence({
    installDependencies: record('installDependencies'),
    verifyIluRuntimeContract: record('verifyIluRuntimeContract', true),
    setupPythonBackendEnvironment: record('setupPythonBackendEnvironment', true),
    checkSimulatorCompatibility: record('checkSimulatorCompatibility', { report: { targets: {} } }),
    installBackendDeps: record('installBackendDeps', true),
    installGenesisRuntime: record('installGenesisRuntime', {
      ok: false,
      installed: false,
      skipped: false,
      fatal: false,
    }),
    installMjlabRuntime: record('installMjlabRuntime', {
      ok: false,
      installed: false,
      skipped: false,
      fatal: false,
    }),
    installPybulletRuntime: record('installPybulletRuntime', {
      ok: false,
      installed: false,
      skipped: false,
      fatal: false,
    }),
    installBlenderRuntime: record('installBlenderRuntime', {
      ok: false,
      installed: false,
      skipped: false,
      fatal: false,
    }),
    installSimulatorContainers: record('installSimulatorContainers', {
      ok: false,
      installed: false,
      skipped: false,
      fatal: false,
    }),
    installTwinDepsIfRequested: record('installTwinDepsIfRequested'),
    checkIkd: record('checkIkd'),
    setupHuggingFace: record('setupHuggingFace'),
    setupGitHub: record('setupGitHub'),
    installOptionalGlobalIlu: record('installOptionalGlobalIlu', {
      attempted: false,
      installed: false,
    }),
  });

  assert.equal(result.genesisRuntimeResult.ok, false);
  assert.equal(result.mjlabRuntimeResult.ok, false);
  assert.equal(result.pybulletRuntimeResult.ok, false);
  assert.equal(result.blenderRuntimeResult.ok, false);
  assert.deepEqual(calls, [
    'installDependencies',
    'verifyIluRuntimeContract',
    'setupPythonBackendEnvironment',
    'checkSimulatorCompatibility',
    'installBackendDeps',
    'installGenesisRuntime',
    'installMjlabRuntime',
    'installPybulletRuntime',
    'installBlenderRuntime',
    'installSimulatorContainers',
    'installTwinDepsIfRequested',
    'checkIkd',
    'setupHuggingFace',
    'setupGitHub',
    'installOptionalGlobalIlu',
  ]);
});

test('setup sequence reports no changes when everything is already ready', async () => {
  const ready = { ok: true, changed: false };
  const result = await runSetupSequence({
    installDependencies: async () => ready,
    verifyIluRuntimeContract: async () => ready,
    setupPythonBackendEnvironment: async () => ready,
    checkSimulatorCompatibility: async () => ({ ok: true, changed: false, report: { targets: {} } }),
    installBackendDeps: async () => ready,
    installGenesisRuntime: async () => ({ ...ready, installed: true, skipped: false }),
    installMjlabRuntime: async () => ({ ...ready, installed: true, skipped: false }),
    installPybulletRuntime: async () => ({ ...ready, installed: true, skipped: false }),
    installBlenderRuntime: async () => ({ ...ready, installed: true, skipped: false }),
    installSimulatorContainers: async () => ({ ...ready, installed: true, skipped: false }),
    installTwinDepsIfRequested: async () => ready,
    checkIkd: async () => ready,
    setupHuggingFace: async () => ready,
    setupGitHub: async () => ready,
    installOptionalGlobalIlu: async () => ({ ...ready, attempted: false, installed: false }),
  });

  assert.equal(result.changed, false);
});

test('setup sequence reports changes when a step installs or repairs runtime files', async () => {
  const ready = { ok: true, changed: false };
  const result = await runSetupSequence({
    installDependencies: async () => ready,
    verifyIluRuntimeContract: async () => ready,
    setupPythonBackendEnvironment: async () => ({ ok: true, changed: true }),
    checkSimulatorCompatibility: async () => ({ ok: true, changed: false, report: { targets: {} } }),
    installBackendDeps: async () => ready,
    installGenesisRuntime: async () => ({ ...ready, installed: true, skipped: false }),
    installMjlabRuntime: async () => ({ ...ready, installed: true, skipped: false }),
    installPybulletRuntime: async () => ({ ...ready, installed: true, skipped: false }),
    installBlenderRuntime: async () => ({ ...ready, installed: true, skipped: false }),
    installSimulatorContainers: async () => ({ ...ready, installed: true, skipped: false }),
    installTwinDepsIfRequested: async () => ready,
    checkIkd: async () => ready,
    setupHuggingFace: async () => ready,
    setupGitHub: async () => ready,
    installOptionalGlobalIlu: async () => ({ ...ready, attempted: false, installed: false }),
  });

  assert.equal(result.changed, true);
});

test('setup sequence fails when a forced simulator adapter install fails', async () => {
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
      verifyIluRuntimeContract: record('verifyIluRuntimeContract', true),
      setupPythonBackendEnvironment: record('setupPythonBackendEnvironment', true),
      checkSimulatorCompatibility: record('checkSimulatorCompatibility', { report: { targets: {} } }),
      installBackendDeps: record('installBackendDeps', true),
      installGenesisRuntime: record('installGenesisRuntime', {
        ok: false,
        installed: false,
        skipped: false,
        fatal: true,
      }),
      installMjlabRuntime: unreachable('installMjlabRuntime'),
      installPybulletRuntime: unreachable('installPybulletRuntime'),
      installBlenderRuntime: unreachable('installBlenderRuntime'),
      installSimulatorContainers: unreachable('installSimulatorContainers'),
      installTwinDepsIfRequested: unreachable('installTwinDepsIfRequested'),
      checkIkd: unreachable('checkIkd'),
      setupHuggingFace: unreachable('setupHuggingFace'),
      setupGitHub: unreachable('setupGitHub'),
      installOptionalGlobalIlu: unreachable('installOptionalGlobalIlu'),
    }),
    /Genesis workspace adapter runtime installation failed/
  );

  assert.deepEqual(calls, [
    'installDependencies',
    'verifyIluRuntimeContract',
    'setupPythonBackendEnvironment',
    'checkSimulatorCompatibility',
    'installBackendDeps',
    'installGenesisRuntime',
  ]);
});
