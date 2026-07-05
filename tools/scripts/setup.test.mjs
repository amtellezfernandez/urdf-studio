import test from 'node:test';
import assert from 'node:assert/strict';
import { delimiter, join } from 'node:path';

import {
  didSpawnSyncFail,
  installSimulatorContainers,
  prependNativeLibraryPath,
  renderSetupSections,
  resolveBlenderExecutableForSetup,
  resolveManagedCmeelLibPathFromSitePackages,
  resolvePythonForBackendVenv,
} from './setup.js';
import { SIMULATOR_CONTAINER_INSTALL_ENV } from './setupParams.js';

test('setup uses uv-managed Python 3.12 by default', () => {
  const originalBootstrapPython = process.env.URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON;
  delete process.env.URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON;

  try {
    assert.deepEqual(resolvePythonForBackendVenv(), {
      python: '3.12',
      usesUvManagedPython: true,
    });
  } finally {
    if (originalBootstrapPython === undefined) {
      delete process.env.URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON;
    } else {
      process.env.URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON = originalBootstrapPython;
    }
  }
});

test('setup rejects an invalid explicit Python override', () => {
  const originalBootstrapPython = process.env.URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON;
  process.env.URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON = '/definitely/not/python3.12';

  try {
    assert.equal(resolvePythonForBackendVenv(), null);
  } finally {
    if (originalBootstrapPython === undefined) {
      delete process.env.URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON;
    } else {
      process.env.URDF_STUDIO_BACKEND_BOOTSTRAP_PYTHON = originalBootstrapPython;
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

function managedContainerReport() {
  return {
    targets: {
      mjx: {
        id: 'mjx',
        label: 'MJX',
        compatible: true,
        deployment: {
          mode: 'container',
          accelerator: 'cuda13-jax',
          image: 'ghcr.io/urdf-studio/sim-mjx:cuda13',
          env: {},
          container: {
            image: 'ghcr.io/urdf-studio/sim-mjx:cuda13',
            build: {
              context: '.',
              dockerfile: 'docker/sim-mjx/Dockerfile',
              args: { JAX_CUDA_EXTRA: 'cuda13' },
            },
          },
        },
      },
    },
  };
}

async function withMutedConsole(callback) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await callback();
  } finally {
    console.log = originalLog;
  }
}

test('setup skips compatible managed simulator container images unless requested', async () => {
  let imageProbeCalled = false;

  const result = await withMutedConsole(() =>
    installSimulatorContainers(managedContainerReport(), {
      imageExists: () => {
        imageProbeCalled = true;
        return false;
      },
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.installed, false);
  assert.equal(result.skipped, true);
  assert.equal(imageProbeCalled, false);
});

test('setup prepares missing compatible managed simulator container images when requested', async () => {
  const observedPlans = [];

  const result = await withMutedConsole(() =>
    installSimulatorContainers(managedContainerReport(), {
      env: { [SIMULATOR_CONTAINER_INSTALL_ENV]: '1' },
      imageExists: () => false,
      runBuildPlan: (plan) => {
        observedPlans.push(plan);
        return { status: 0, signal: null };
      },
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.deepEqual(result.built, ['mjx']);
  assert.deepEqual(result.ready, ['mjx']);
  assert.equal(observedPlans.length, 1);
  assert.equal(observedPlans[0].command, 'docker');
  assert.ok(observedPlans[0].args.includes('JAX_CUDA_EXTRA=cuda13'));
});

test('setup skips simulator container builds when images already exist', async () => {
  let buildCalled = false;

  const result = await installSimulatorContainers(managedContainerReport(), {
    env: { [SIMULATOR_CONTAINER_INSTALL_ENV]: '1' },
    imageExists: () => true,
    runBuildPlan: () => {
      buildCalled = true;
      return { status: 0, signal: null };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.installed, true);
  assert.deepEqual(result.built, []);
  assert.deepEqual(result.ready, ['mjx']);
  assert.equal(buildCalled, false);
});

test('setup section renderer prints headings and lines in order', () => {
  const lines = [];
  renderSetupSections(
    [
      {
        heading: 'Installed By Setup',
        lines: ['Node app dependencies in node_modules', 'Unified Python runtime in .venv'],
      },
    ],
    {
      logImpl: (line) => lines.push(line),
      logArrowImpl: (line) => lines.push(line),
      logInfoImpl: (line) => lines.push(line),
    }
  );

  assert.equal(lines.length, 4);
  assert.equal(lines[0], '');
  assert.match(lines[1], /Installed By Setup/);
  assert.match(lines[2], /Node app dependencies in node_modules/);
  assert.match(lines[3], /Unified Python runtime in \.venv/);
});
