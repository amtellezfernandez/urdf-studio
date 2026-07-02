import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTargetRunPlan,
  containerTargets,
  parseArgs,
  resolvePlanTargets,
  resolveTarget,
} from './simulatorContainerPlan.js';
import { evaluateSimulatorCompatibility } from './simulatorCompatibility.js';

function baseHost(overrides = {}) {
  return {
    platform: 'linux',
    arch: 'x64',
    normalizedArch: 'x86_64',
    osRelease: { id: 'ubuntu', version_id: '24.04' },
    isWsl: false,
    isContainer: false,
    hasDisplay: false,
    totalMemoryGb: 64,
    cpuCount: 16,
    cpuFlags: ['sse4_2', 'avx', 'avx2'],
    pythonVersion: { major: 3, minor: 12, patch: 11, executable: '/repo/.venv/bin/python3' },
    gpus: [
      {
        vendor: 'nvidia',
        name: 'NVIDIA RTX PRO 6000 Blackwell',
        memoryMb: 49152,
        driverVersion: '580.95.05',
      },
    ],
    vulkan: { available: true, reason: '' },
    hasDriRenderDevice: true,
    docker: {
      installed: true,
      daemonAvailable: true,
      version: '28.0.0',
      runtimes: ['runc', 'nvidia'],
      nvidiaRuntimeAvailable: true,
      error: '',
    },
    hasCudaDriverLibrary: true,
    isaacSimCompatibilityChecker: null,
    ...overrides,
  };
}

function argAfter(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
}

test('container plan CLI parses all-compatible run planning requests', () => {
  assert.deepEqual(parseArgs(['all', '--workspace', '/tmp/ws', '--detach']), {
    simulatorId: null,
    all: true,
    workspaceDir: '/tmp/ws',
    projectRoot: null,
    name: null,
    network: null,
    detach: true,
    interactive: false,
    remove: true,
    enableDesktopDisplay: true,
    help: false,
  });
  assert.throws(() => parseArgs(['--all', 'mjx']), /either --all or one simulator id/);
  assert.throws(() => parseArgs(['--all', '--name', 'sim']), /one simulator id when setting a container name/);
});

test('container plan CLI resolves every compatible container target', () => {
  const report = evaluateSimulatorCompatibility(baseHost());

  assert.deepEqual(containerTargets(report).map((target) => target.id), [
    'mjx',
    'sapien2',
    'isaacsim',
  ]);
  assert.deepEqual(resolvePlanTargets(report, { all: true }).map((target) => target.id), [
    'mjx',
    'sapien2',
    'isaacsim',
  ]);
  assert.deepEqual(resolvePlanTargets(report, { simulatorId: 'mjx' }).map((target) => target.id), [
    'mjx',
  ]);
});

test('container plan CLI builds accelerated Docker run commands for each target', () => {
  const report = evaluateSimulatorCompatibility(baseHost());
  const mjxPlan = buildTargetRunPlan(resolveTarget(report, 'mjx'), {
    workspaceDir: '/workspace/demo',
    detach: true,
    remove: true,
  });
  const isaacPlan = buildTargetRunPlan(resolveTarget(report, 'isaacsim'), {
    workspaceDir: '/workspace/demo',
  });

  assert.equal(mjxPlan.image, 'ghcr.io/urdf-studio/sim-mjx:cuda13');
  assert.equal(argAfter(mjxPlan.args, '--gpus'), 'all');
  assert.ok(mjxPlan.args.includes('--detach'));
  assert.ok(mjxPlan.args.includes('type=bind,source=/workspace/demo,target=/workspace'));
  assert.equal(isaacPlan.image, 'nvcr.io/nvidia/isaac-sim:6.0.0');
  assert.equal(argAfter(isaacPlan.args, '--network'), 'host');
});

test('container plan CLI rejects non-container targets', () => {
  const report = evaluateSimulatorCompatibility(baseHost());

  assert.throws(() => resolveTarget(report, 'genesis'), /not Docker/);
});
