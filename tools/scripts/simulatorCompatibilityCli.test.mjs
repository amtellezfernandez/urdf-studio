import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatSimulatorCompatibilityCliReport,
  parseSimulatorCompatibilityCliArgs,
} from './simulatorCompatibilityCli.js';
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

test('simulator compatibility CLI formats host and target acceleration choices', () => {
  const report = evaluateSimulatorCompatibility(baseHost());
  const lines = formatSimulatorCompatibilityCliReport(report);
  const output = lines.join('\n');

  assert.match(output, /Host: linux x86_64/);
  assert.match(output, /docker=gpu-ready/);
  assert.match(output, /genesis: Genesis .*deployment=python\/cuda/);
  assert.match(output, /mjx: MJX .*state=container .*deployment=container\/cuda13-jax/);
  assert.match(output, /container: ghcr\.io\/urdf-studio\/sim-mjx:cuda13/);
});

test('simulator compatibility CLI can focus on one target', () => {
  const report = evaluateSimulatorCompatibility(baseHost());
  const output = formatSimulatorCompatibilityCliReport(report, { targetId: 'mjx' }).join('\n');

  assert.match(output, /mjx: MJX/);
  assert.doesNotMatch(output, /pybullet: PyBullet/);
});

test('simulator compatibility CLI parses positional target and json option', () => {
  assert.deepEqual(parseSimulatorCompatibilityCliArgs(['mjx', '--json']), {
    help: false,
    json: true,
    targetId: 'mjx',
  });
  assert.deepEqual(parseSimulatorCompatibilityCliArgs(['--target', 'genesis']), {
    help: false,
    json: false,
    targetId: 'genesis',
  });
});
