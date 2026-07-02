import test from 'node:test';
import assert from 'node:assert/strict';

import {
  managedBuildTargets,
  parseArgs,
  resolveBuildTargets,
  resolveTarget,
} from './simulatorContainerBuild.js';
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

test('container build CLI parses all-compatible build requests', () => {
  assert.deepEqual(parseArgs(['--all', '--print', '--progress', 'plain']), {
    simulatorId: null,
    all: true,
    printOnly: true,
    pull: true,
    noCache: false,
    platform: null,
    progress: 'plain',
    help: false,
  });
  assert.equal(parseArgs(['all']).all, true);
  assert.throws(() => parseArgs(['--all', 'mjx']), /either --all or one simulator id/);
});

test('container build CLI resolves every compatible managed container build', () => {
  const report = evaluateSimulatorCompatibility(baseHost());
  const targets = managedBuildTargets(report);

  assert.deepEqual(targets.map((target) => target.id), ['mjx', 'sapien2']);
  assert.deepEqual(resolveBuildTargets(report, { all: true }).map((target) => target.id), [
    'mjx',
    'sapien2',
  ]);
  assert.deepEqual(resolveBuildTargets(report, { simulatorId: 'mjx' }).map((target) => target.id), [
    'mjx',
  ]);
});

test('container build CLI rejects external and non-container targets', () => {
  const report = evaluateSimulatorCompatibility(baseHost());

  assert.throws(() => resolveTarget(report, 'isaacsim'), /external container image/);
  assert.throws(() => resolveTarget(report, 'genesis'), /not Docker/);
});
