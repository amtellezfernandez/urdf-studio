import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildIsaacSimDeployment,
  buildMjxDeployment,
  buildPybulletDeployment,
} from './simulatorCompatibilityDeployments.js';
import { dockerStatusLabel } from './simulatorHostCapabilities.js';

function baseHost(overrides = {}) {
  return {
    platform: 'linux',
    arch: 'x64',
    normalizedArch: 'x86_64',
    isWsl: false,
    isContainer: false,
    hasDisplay: true,
    totalMemoryGb: 64,
    cpuCount: 16,
    cpuFlags: ['sse4_2', 'avx', 'avx2'],
    pythonVersion: { major: 3, minor: 12, patch: 11, executable: '/repo/.venv/bin/python3' },
    gpus: [],
    vulkan: { available: true, reason: '' },
    hasDriRenderDevice: true,
    hasWslD3d12OpenGl: false,
    docker: {
      installed: false,
      daemonAvailable: false,
      version: '',
      runtimes: [],
      nvidiaRuntimeAvailable: false,
      error: '',
    },
    hasCudaDriverLibrary: false,
    isaacSimCompatibilityChecker: null,
    ...overrides,
  };
}

function nvidiaDockerHost(overrides = {}) {
  return baseHost({
    hasDisplay: false,
    hasCudaDriverLibrary: true,
    gpus: [
      {
        vendor: 'nvidia',
        name: 'NVIDIA RTX PRO 6000 Blackwell',
        memoryMb: 49152,
        driverVersion: '580.95.05',
      },
    ],
    docker: {
      installed: true,
      daemonAvailable: true,
      version: '28.0.0',
      runtimes: ['runc', 'nvidia'],
      nvidiaRuntimeAvailable: true,
      error: '',
    },
    ...overrides,
  });
}

test('MJX deployment selects CUDA image family from NVIDIA driver version', () => {
  const cuda13Deployment = buildMjxDeployment(nvidiaDockerHost());
  const cuda12Deployment = buildMjxDeployment(
    nvidiaDockerHost({
      gpus: [
        {
          vendor: 'nvidia',
          name: 'NVIDIA RTX 4090',
          memoryMb: 24564,
          driverVersion: '570.86.15',
        },
      ],
    })
  );

  assert.equal(cuda13Deployment.mode, 'container');
  assert.equal(cuda13Deployment.container.image, 'ghcr.io/urdf-studio/sim-mjx:cuda13');
  assert.equal(cuda13Deployment.container.build.args.JAX_CUDA_EXTRA, 'cuda13');
  assert.equal(cuda12Deployment.container.image, 'ghcr.io/urdf-studio/sim-mjx:cuda12');
  assert.equal(cuda12Deployment.container.build.args.JAX_CUDA_EXTRA, 'cuda12');
});

test('PyBullet deployment uses WSLg D3D12 OpenGL when available', () => {
  const deployment = buildPybulletDeployment(
    baseHost({
      isWsl: true,
      hasDisplay: true,
      hasWslD3d12OpenGl: true,
      hasCudaDriverLibrary: true,
      gpus: [{ vendor: 'nvidia', name: 'NVIDIA RTX Laptop GPU', memoryMb: 16384, driverVersion: '592.27' }],
    })
  );

  assert.equal(deployment.mode, 'python');
  assert.equal(deployment.accelerator, 'wslg-d3d12-opengl');
  assert.equal(deployment.gpu, 'opengl');
  assert.equal(deployment.env.GALLIUM_DRIVER, 'd3d12');
  assert.equal(deployment.env.MESA_D3D12_DEFAULT_ADAPTER_NAME, 'NVIDIA');
});

test('Isaac Sim deployment uses official container only when compatibility reasons are clear', () => {
  const containerDeployment = buildIsaacSimDeployment(nvidiaDockerHost(), []);
  const externalDeployment = buildIsaacSimDeployment(
    nvidiaDockerHost({ isWsl: true }),
    ['URDF Studio is running inside WSL.']
  );

  assert.equal(containerDeployment.mode, 'container');
  assert.equal(containerDeployment.container.kind, 'official');
  assert.equal(containerDeployment.container.image, 'nvcr.io/nvidia/isaac-sim:6.0.0');
  assert.equal(containerDeployment.container.network, 'host');
  assert.equal(containerDeployment.env.ACCEPT_EULA, 'Y');
  assert.equal(externalDeployment.mode, 'external');
  assert.equal(externalDeployment.profile, 'native-host-required');
});

test('dockerStatusLabel reports daemon and NVIDIA runtime readiness', () => {
  assert.equal(dockerStatusLabel(baseHost()), 'docker unavailable');
  assert.equal(
    dockerStatusLabel(baseHost({ docker: { installed: true, daemonAvailable: false } })),
    'docker daemon unavailable'
  );
  assert.equal(
    dockerStatusLabel(
      baseHost({
        gpus: [{ vendor: 'nvidia', name: 'NVIDIA RTX', memoryMb: 8192, driverVersion: '580.95.05' }],
        docker: {
          installed: true,
          daemonAvailable: true,
          runtimes: ['runc'],
          nvidiaRuntimeAvailable: false,
        },
      })
    ),
    'docker ready, NVIDIA runtime missing'
  );
  assert.equal(dockerStatusLabel(nvidiaDockerHost()), 'docker GPU ready');
});
