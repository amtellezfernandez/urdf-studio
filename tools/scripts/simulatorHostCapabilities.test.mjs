import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bestNvidiaDriver,
  dockerStatusLabel,
  hasAnyGpu,
  hasGpuVendor,
  hasNvidiaCuda,
  hasNvidiaDocker,
  hasRtxGpu,
  maxGpuMemoryMb,
} from './simulatorHostCapabilities.js';

function host(overrides = {}) {
  return {
    platform: 'linux',
    gpus: [],
    hasCudaDriverLibrary: false,
    docker: {
      installed: false,
      daemonAvailable: false,
      runtimes: [],
      nvidiaRuntimeAvailable: false,
    },
    ...overrides,
  };
}

test('GPU predicates are vendor-specific and do not infer CUDA from device presence alone', () => {
  const detectedHost = host({
    gpus: [
      { vendor: 'nvidia', name: 'NVIDIA RTX 4090', memoryMb: 24564, driverVersion: '570.86.15' },
      { vendor: 'amd', name: 'AMD Radeon Pro', memoryMb: 16384, driverVersion: '' },
    ],
  });

  assert.equal(hasAnyGpu(detectedHost), true);
  assert.equal(hasGpuVendor(detectedHost, 'nvidia'), true);
  assert.equal(hasGpuVendor(detectedHost, 'intel'), false);
  assert.equal(hasRtxGpu(detectedHost), true);
  assert.equal(hasNvidiaCuda(detectedHost), false);
  assert.equal(maxGpuMemoryMb(detectedHost), 24564);
  assert.equal(maxGpuMemoryMb(detectedHost, 'amd'), 16384);
});

test('NVIDIA driver selection uses semantic version ordering', () => {
  const detectedHost = host({
    gpus: [
      { vendor: 'nvidia', name: 'NVIDIA RTX 4090', memoryMb: 24564, driverVersion: '570.86.15' },
      { vendor: 'nvidia', name: 'NVIDIA RTX 6000', memoryMb: 49152, driverVersion: '580.95.05' },
    ],
  });

  assert.equal(bestNvidiaDriver(detectedHost), '580.95.05');
});

test('Docker readiness requires daemon and NVIDIA runtime for GPU containers', () => {
  const noDockerHost = host();
  const daemonOnlyHost = host({
    docker: {
      installed: true,
      daemonAvailable: true,
      runtimes: ['runc'],
      nvidiaRuntimeAvailable: false,
    },
  });
  const gpuDockerHost = host({
    hasCudaDriverLibrary: true,
    gpus: [{ vendor: 'nvidia', name: 'NVIDIA RTX 4090', memoryMb: 24564, driverVersion: '580.95.05' }],
    docker: {
      installed: true,
      daemonAvailable: true,
      runtimes: ['runc', 'nvidia'],
      nvidiaRuntimeAvailable: true,
    },
  });

  assert.equal(hasNvidiaDocker(noDockerHost), false);
  assert.equal(dockerStatusLabel(noDockerHost), 'docker unavailable');
  assert.equal(hasNvidiaDocker(daemonOnlyHost), false);
  assert.equal(dockerStatusLabel(daemonOnlyHost), 'docker ready');
  assert.equal(hasNvidiaDocker(gpuDockerHost), true);
  assert.equal(dockerStatusLabel(gpuDockerHost), 'docker GPU ready');
});
