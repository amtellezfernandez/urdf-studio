import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SIMULATOR_CONTAINER_FORCE_ENV,
  SIMULATOR_CONTAINER_SKIP_ENV,
  installSimulatorContainers,
  simulatorContainerImageExists,
} from './setupSimulatorContainers.js';

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

test('container image existence probes Docker inspect in the requested root', () => {
  const calls = [];
  const exists = simulatorContainerImageExists('ghcr.io/urdf-studio/sim-mjx:cuda13', {
    rootDir: '/repo',
    spawnSyncImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, error: null };
    },
  });

  assert.equal(exists, true);
  assert.equal(calls[0].command, 'docker');
  assert.deepEqual(calls[0].args, ['image', 'inspect', 'ghcr.io/urdf-studio/sim-mjx:cuda13']);
  assert.equal(calls[0].options.cwd, '/repo');
  assert.equal(calls[0].options.stdio, 'ignore');
});

test('container setup skips when disabled or when images already exist', async () => {
  assert.deepEqual(
    await installSimulatorContainers(managedContainerReport(), {
      env: { [SIMULATOR_CONTAINER_SKIP_ENV]: '1' },
    }),
    {
      ok: true,
      changed: false,
      installed: false,
      skipped: true,
      built: [],
      ready: [],
    }
  );

  let buildCalled = false;
  const readyResult = await installSimulatorContainers(managedContainerReport(), {
    imageExists: () => true,
    runBuildPlan: () => {
      buildCalled = true;
      return { status: 0, signal: null };
    },
  });

  assert.equal(readyResult.changed, false);
  assert.equal(readyResult.installed, true);
  assert.deepEqual(readyResult.ready, ['mjx']);
  assert.equal(buildCalled, false);
});

test('container setup builds missing compatible images and reports ready targets', async () => {
  const logs = [];
  const plans = [];
  const result = await installSimulatorContainers(managedContainerReport(), {
    rootDir: '/repo',
    env: { DOCKER_PROGRESS: 'plain' },
    imageExists: () => false,
    runBuildPlan: (plan, options) => {
      plans.push({ plan, options });
      return { status: 0, signal: null };
    },
    logArrow: (message) => logs.push(['arrow', message]),
    logInfo: (message) => logs.push(['info', message]),
    logSuccess: (message) => logs.push(['success', message]),
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.built, ['mjx']);
  assert.deepEqual(result.ready, ['mjx']);
  assert.equal(plans[0].options.rootDir, '/repo');
  assert.ok(plans[0].plan.args.includes('--progress'));
  assert.ok(plans[0].plan.args.includes('plain'));
  assert.ok(logs.some(([level]) => level === 'success'));
});

test('container setup treats build failures as nonfatal unless forced', async () => {
  const nonfatal = await installSimulatorContainers(managedContainerReport(), {
    imageExists: () => false,
    runBuildPlan: () => ({ status: 1, signal: null }),
  });
  const fatal = await installSimulatorContainers(managedContainerReport(), {
    env: { [SIMULATOR_CONTAINER_FORCE_ENV]: '1' },
    imageExists: () => false,
    runBuildPlan: () => ({ status: 1, signal: null }),
  });

  assert.equal(nonfatal.ok, true);
  assert.equal(nonfatal.skipped, true);
  assert.equal(nonfatal.fatal, false);
  assert.equal(nonfatal.failed, 'mjx');
  assert.equal(fatal.ok, false);
  assert.equal(fatal.skipped, false);
  assert.equal(fatal.fatal, true);
});
