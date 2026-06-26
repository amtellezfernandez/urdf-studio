import test from 'node:test';
import assert from 'node:assert/strict';
import { delimiter, join } from 'node:path';

import {
  assertIluRuntimeContract,
  didSpawnSyncFail,
  prependNativeLibraryPath,
  resolveBlenderExecutableForSetup,
  resolveManagedCmeelLibPathFromSitePackages,
  resolvePythonForLeRobotVenv,
  runSetupSequence,
} from './setup.js';

test('setup validates the i-love-urdf simulator transfer contract', () => {
  assert.doesNotThrow(() =>
    assertIluRuntimeContract(
      {
        urdfCore: {
          convertURDFToMJCF: () => ({ mjcfContent: '<mujoco model="demo"/>' }),
          convertURDFToUSD: () => ({ usdContent: '#usda 1.0' }),
        },
        urdfCoreBundleMeshAssetsNode: {
          bundleMeshAssetsForUrdfFile: () => ({}),
        },
        urdfCoreNodeDomRuntime: {
          installNodeDomGlobals: () => {},
        },
      },
      {
        DOMParser: function DOMParser() {},
        XMLSerializer: function XMLSerializer() {},
      }
    )
  );
});

test('setup rejects an incomplete i-love-urdf simulator transfer contract', () => {
  assert.throws(
    () =>
      assertIluRuntimeContract(
        {
          urdfCore: {},
          urdfCoreBundleMeshAssetsNode: {},
          urdfCoreNodeDomRuntime: {},
        },
        {}
      ),
    /convertURDFToMJCF/
  );
});

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

test('setup resolves managed cmeel library path from Python site-package paths', () => {
  const sitePackagePath = join('/tmp', 'studio-env', 'lib', 'python3.13', 'site-packages');
  const existingPath = join(sitePackagePath, 'cmeel.prefix', 'lib');
  assert.equal(
    resolveManagedCmeelLibPathFromSitePackages(
      [
        '',
        join('/tmp', 'empty-site-packages'),
        sitePackagePath,
      ],
      (candidatePath) => candidatePath === existingPath
    ),
    existingPath
  );
});

test('setup prepends native library path without duplicating existing entries', () => {
  const env = {
    LD_LIBRARY_PATH: ['/opt/other/lib', '/tmp/cmeel/lib'].join(delimiter),
  };

  prependNativeLibraryPath(env, '/tmp/cmeel/lib');

  assert.equal(env.LD_LIBRARY_PATH, ['/tmp/cmeel/lib', '/opt/other/lib'].join(delimiter));
});

test('setup leaves native library path unchanged when no candidate is available', () => {
  const env = { LD_LIBRARY_PATH: '/opt/other/lib' };

  prependNativeLibraryPath(env, null);

  assert.equal(env.LD_LIBRARY_PATH, '/opt/other/lib');
});

test('setup treats zero-status spawn results as successful despite stale error metadata', () => {
  assert.equal(
    didSpawnSyncFail({
      status: 0,
      signal: null,
      error: new Error('spawnSync cargo EPERM'),
    }),
    false
  );
});

test('setup treats nonzero or interrupted spawn results as failures', () => {
  assert.equal(didSpawnSyncFail({ status: 1, signal: null }), true);
  assert.equal(didSpawnSyncFail({ status: null, signal: null, error: new Error('EPERM') }), true);
  assert.equal(didSpawnSyncFail({ status: 0, signal: 'SIGTERM' }), true);
});

test('setup ignores Windows Blender executables on non-Windows hosts', () => {
  if (process.platform === 'win32') return;
  const originalBlenderPath = process.env.URDF_STUDIO_BLENDER_PATH;
  process.env.URDF_STUDIO_BLENDER_PATH =
    'C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe';

  try {
    assert.equal(resolveBlenderExecutableForSetup(), null);
  } finally {
    if (originalBlenderPath === undefined) {
      delete process.env.URDF_STUDIO_BLENDER_PATH;
    } else {
      process.env.URDF_STUDIO_BLENDER_PATH = originalBlenderPath;
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
      verifyIluRuntimeContract: record('verifyIluRuntimeContract', true),
      setupUrdfOpsWorkspace: record('setupUrdfOpsWorkspace', true),
      setupPythonBackendEnvironment: record('setupPythonBackendEnvironment', false),
      installBackendDeps: unreachable('installBackendDeps'),
      installGenesisRuntime: unreachable('installGenesisRuntime'),
      installPybulletRuntime: unreachable('installPybulletRuntime'),
      installBlenderRuntime: unreachable('installBlenderRuntime'),
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
    'verifyIluRuntimeContract',
    'setupUrdfOpsWorkspace',
    'setupPythonBackendEnvironment',
  ]);
});

test('setup stops before workspace setup when i-love-urdf runtime check fails', async () => {
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
      setupUrdfOpsWorkspace: unreachable('setupUrdfOpsWorkspace'),
      setupPythonBackendEnvironment: unreachable('setupPythonBackendEnvironment'),
      installBackendDeps: unreachable('installBackendDeps'),
      installGenesisRuntime: unreachable('installGenesisRuntime'),
      installPybulletRuntime: unreachable('installPybulletRuntime'),
      installBlenderRuntime: unreachable('installBlenderRuntime'),
      installOfficialLeRobotToolchain: unreachable('installOfficialLeRobotToolchain'),
      installOpenArmHardwareRuntime: unreachable('installOpenArmHardwareRuntime'),
      installMjlabRuntime: unreachable('installMjlabRuntime'),
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

test('setup continues when optional simulator adapters are unavailable', async () => {
  const calls = [];
  const record = (name, result) => async () => {
    calls.push(name);
    return result;
  };

  const result = await runSetupSequence({
    installDependencies: record('installDependencies'),
    verifyIluRuntimeContract: record('verifyIluRuntimeContract', true),
    setupUrdfOpsWorkspace: record('setupUrdfOpsWorkspace', true),
    setupPythonBackendEnvironment: record('setupPythonBackendEnvironment', true),
    installBackendDeps: record('installBackendDeps', true),
    installGenesisRuntime: record('installGenesisRuntime', {
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
    installOfficialLeRobotToolchain: record('installOfficialLeRobotToolchain', true),
    installOpenArmHardwareRuntime: record('installOpenArmHardwareRuntime', true),
    installMjlabRuntime: record('installMjlabRuntime', {
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
  assert.equal(result.pybulletRuntimeResult.ok, false);
  assert.equal(result.mjlabRuntimeResult.ok, false);
  assert.equal(result.blenderRuntimeResult.ok, false);
  assert.deepEqual(calls, [
    'installDependencies',
    'verifyIluRuntimeContract',
    'setupUrdfOpsWorkspace',
    'setupPythonBackendEnvironment',
    'installBackendDeps',
    'installOfficialLeRobotToolchain',
    'installGenesisRuntime',
    'installPybulletRuntime',
    'installBlenderRuntime',
    'installOpenArmHardwareRuntime',
    'installMjlabRuntime',
    'installTwinDepsIfRequested',
    'checkIkd',
    'setupHuggingFace',
    'setupGitHub',
    'installOptionalGlobalIlu',
  ]);
});

test('setup fails when a forced simulator adapter install fails', async () => {
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
      setupUrdfOpsWorkspace: record('setupUrdfOpsWorkspace', true),
      setupPythonBackendEnvironment: record('setupPythonBackendEnvironment', true),
      installBackendDeps: record('installBackendDeps', true),
      installOfficialLeRobotToolchain: record('installOfficialLeRobotToolchain', true),
      installGenesisRuntime: record('installGenesisRuntime', {
        ok: false,
        installed: false,
        skipped: false,
        fatal: true,
      }),
      installPybulletRuntime: unreachable('installPybulletRuntime'),
      installBlenderRuntime: unreachable('installBlenderRuntime'),
      installOpenArmHardwareRuntime: unreachable('installOpenArmHardwareRuntime'),
      installMjlabRuntime: unreachable('installMjlabRuntime'),
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
    'setupUrdfOpsWorkspace',
    'setupPythonBackendEnvironment',
    'installBackendDeps',
    'installOfficialLeRobotToolchain',
    'installGenesisRuntime',
  ]);
});
