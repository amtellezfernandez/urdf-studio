import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateSimulatorCompatibility,
  formatSimulatorCompatibilitySummary,
  isManagedSimulatorInstallAllowed,
} from './simulatorCompatibility.js';

function baseHost(overrides = {}) {
  return {
    platform: 'linux',
    arch: 'x64',
    normalizedArch: 'x86_64',
    osRelease: { id: 'ubuntu', version_id: '24.04' },
    isWsl: false,
    isContainer: false,
    hasDisplay: true,
    totalMemoryGb: 32,
    cpuCount: 8,
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

test('compatibility blocks Isaac Sim inside WSL even when the GPU is strong', () => {
  const report = evaluateSimulatorCompatibility(
    baseHost({
      isWsl: true,
      totalMemoryGb: 31.2,
      gpus: [
        {
          vendor: 'nvidia',
          name: 'NVIDIA GeForce RTX Laptop GPU',
          memoryMb: 16303,
          driverVersion: '592.27',
        },
      ],
      vulkan: { available: false, reason: 'vulkaninfo is not installed' },
      hasCudaDriverLibrary: true,
    })
  );

  assert.equal(report.targets.genesis.installable, true);
  assert.equal(report.targets.pybullet.installable, true);
  assert.equal(report.targets.mjlab.installable, true);
  assert.equal(report.targets.mjx.installable, true);
  assert.equal(report.targets.blender.installable, true);
  assert.equal(report.targets.genesis.deployment.accelerator, 'cuda');
  assert.equal(report.targets.genesis.deployment.gpu, 'cuda');
  assert.equal(report.targets.genesis.deployment.display, 'desktop');
  assert.equal(report.targets.genesis.deployment.env.URDF_STUDIO_GENESIS_PERFORMANCE_MODE, undefined);
  assert.match(report.targets.genesis.deployment.notes.join(' '), /performance mode remains explicit opt-in/);
  assert.match(report.targets.pybullet.warnings.join(' '), /WSLg D3D12 OpenGL was not detected/);
  assert.equal(report.targets.isaacsim.installable, false);
  assert.equal(report.targets.isaacsim.compatible, false);
  assert.equal(report.targets.isaacsim.deployment.mode, 'external');
  assert.equal(report.targets.sapien2.compatible, false);
  assert.match(report.targets.sapien2.reasons.join(' '), /WSL/);
  assert.match(report.targets.isaacsim.reasons.join(' '), /WSL/);
});

test('compatibility reports PyBullet WSLg D3D12 OpenGL fast path', () => {
  const report = evaluateSimulatorCompatibility(
    baseHost({
      isWsl: true,
      hasDisplay: true,
      hasWslD3d12OpenGl: true,
      hasCudaDriverLibrary: true,
      gpus: [
        {
          vendor: 'nvidia',
          name: 'NVIDIA GeForce RTX Laptop GPU',
          memoryMb: 16303,
          driverVersion: '592.27',
        },
      ],
    })
  );

  assert.equal(report.targets.pybullet.compatible, true);
  assert.equal(report.targets.pybullet.deployment.accelerator, 'wslg-d3d12-opengl');
  assert.equal(report.targets.pybullet.deployment.gpu, 'opengl');
  assert.equal(report.targets.pybullet.deployment.env.GALLIUM_DRIVER, 'd3d12');
  assert.equal(report.targets.pybullet.deployment.env.MESA_D3D12_DEFAULT_ADAPTER_NAME, 'NVIDIA');
  assert.doesNotMatch(report.targets.pybullet.warnings.join(' '), /llvmpipe/);
});

test('compatibility trusts NVIDIA Isaac Sim checker when it passes', () => {
  const report = evaluateSimulatorCompatibility(
    baseHost({
      isWsl: true,
      gpus: [],
      vulkan: { available: false, reason: 'vulkaninfo is not installed' },
      isaacSimCompatibilityChecker: {
        available: true,
        ok: true,
        source: 'Isaac Sim Python package',
        command: 'isaacsim isaacsim.exp.compatibility_check',
        status: 0,
        summary: 'All checks passed',
      },
    })
  );

  assert.equal(report.targets.isaacsim.compatible, true);
  assert.match(report.targets.isaacsim.warnings.join(' '), /Compatibility Checker passed/);
  assert.match(report.targets.isaacsim.deployment.notes.join(' '), /Official Isaac Sim Compatibility Checker passed/);
});

test('compatibility reports Isaac Sim 6 checker setup when checker is unavailable', () => {
  const report = evaluateSimulatorCompatibility(baseHost());

  assert.match(report.targets.isaacsim.deployment.notes.join(' '), /Isaac Sim 6\.0\.0 Compatibility Checker/);
  assert.match(report.targets.isaacsim.deployment.notes.join(' '), /pip install isaacsim\[compatibility-check\]/);
  assert.match(report.targets.isaacsim.deployment.notes.join(' '), /isaacsim isaacsim\.exp\.compatibility_check/);
});

test('compatibility reports NVIDIA Isaac Sim checker failure before fallback reasons', () => {
  const report = evaluateSimulatorCompatibility(
    baseHost({
      isaacSimCompatibilityChecker: {
        available: true,
        ok: false,
        source: 'Isaac Sim workstation script',
        command: './isaac-sim.compatibility_check.sh --no-window',
        status: 1,
        summary: 'GPU driver check failed',
      },
    })
  );

  assert.equal(report.targets.isaacsim.compatible, false);
  assert.match(report.targets.isaacsim.reasons[0], /Compatibility Checker failed: GPU driver check failed/);
});

test('compatibility evaluates public host classes instead of one laptop profile', () => {
  const macReport = evaluateSimulatorCompatibility(
    baseHost({
      platform: 'darwin',
      arch: 'arm64',
      normalizedArch: 'aarch64',
      osRelease: {},
      gpus: [{ vendor: 'apple', name: 'Apple M4', memoryMb: null, driverVersion: '' }],
      cpuFlags: [],
      vulkan: { available: false, reason: 'not installed' },
    })
  );
  assert.equal(macReport.targets.genesis.installable, true);
  assert.equal(macReport.targets.genesis.deployment.accelerator, 'metal');
  assert.equal(macReport.targets.genesis.deployment.gpu, 'metal');
  assert.equal(macReport.targets.genesis.deployment.display, 'desktop');
  assert.equal(macReport.targets.genesis.deployment.env.URDF_STUDIO_GENESIS_PERFORMANCE_MODE, undefined);
  assert.doesNotMatch(macReport.targets.genesis.warnings.join(' '), /No NVIDIA GPU/);
  assert.equal(macReport.targets.pybullet.installable, false);
  assert.equal(macReport.targets.mjx.installable, false);
  assert.equal(macReport.targets.blender.installable, false);

  const headlessServerReport = evaluateSimulatorCompatibility(
    baseHost({
      hasDisplay: false,
      totalMemoryGb: 128,
    })
  );
  assert.equal(headlessServerReport.targets.genesis.installable, true);
  assert.equal(headlessServerReport.targets.pybullet.installable, true);
  assert.equal(headlessServerReport.targets.mjlab.installable, false);
  assert.match(headlessServerReport.targets.genesis.warnings.join(' '), /No desktop display/);
  assert.match(headlessServerReport.targets.mjlab.reasons.join(' '), /NVIDIA/);
});

test('compatibility reports Genesis AMDGPU as automatic candidate on Linux AMD hosts', () => {
  const report = evaluateSimulatorCompatibility(
    baseHost({
      gpus: [{ vendor: 'amd', name: 'AMD Radeon Pro', memoryMb: 16384, driverVersion: '' }],
    })
  );

  assert.equal(report.targets.genesis.installable, true);
  assert.equal(report.targets.genesis.deployment.accelerator, 'amdgpu-auto');
  assert.equal(report.targets.genesis.deployment.gpu, 'amdgpu');
  assert.equal(report.targets.genesis.deployment.env.URDF_STUDIO_GENESIS_PERFORMANCE_MODE, undefined);
  assert.match(report.targets.genesis.warnings.join(' '), /ROCm\/HIP/);
  assert.doesNotMatch(report.targets.genesis.warnings.join(' '), /No NVIDIA GPU/);
});

test('compatibility selects fast render and container paths when host supports them', () => {
  const report = evaluateSimulatorCompatibility(
    baseHost({
      hasDisplay: false,
      totalMemoryGb: 64,
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
      hasCudaDriverLibrary: true,
    })
  );

  assert.equal(report.targets.mujoco.deployment.accelerator, 'egl');
  assert.equal(report.targets.mujoco.deployment.display, 'egl');
  assert.equal(report.targets.mujoco.deployment.env.MUJOCO_GL, 'egl');
  assert.equal(report.targets.mjlab.deployment.accelerator, 'cuda+egl');
  assert.equal(report.targets.mjx.deployment.mode, 'container');
  assert.equal(report.targets.mjx.deployment.accelerator, 'cuda13-jax');
  assert.equal(report.targets.mjx.deployment.container.image, 'ghcr.io/urdf-studio/sim-mjx:cuda13');
  assert.equal(report.targets.mjx.deployment.container.build.args.JAX_CUDA_EXTRA, 'cuda13');
  assert.equal(isManagedSimulatorInstallAllowed(report, 'mjx'), false);
  assert.equal(report.targets.sapien2.compatible, true);
  assert.equal(report.targets.sapien2.deployment.mode, 'container');
  assert.equal(report.targets.sapien2.deployment.container.image, 'ghcr.io/urdf-studio/sim-sapien:vulkan');
  assert.equal(report.targets.sapien2.deployment.container.build.dockerfile, 'docker/sim-sapien/Dockerfile');
  assert.equal(report.targets.isaacsim.compatible, true);
  assert.equal(report.targets.isaacsim.deployment.mode, 'container');
  assert.equal(report.targets.isaacsim.deployment.accelerator, 'rtx-cuda');
  assert.equal(report.targets.isaacsim.deployment.container.kind, 'official');
  assert.equal(report.targets.isaacsim.deployment.display, 'webrtc');
  assert.match(report.targets.isaacsim.deployment.notes.join(' '), /nvcr\.io\/nvidia\/isaac-sim:6\.0\.0/);
});

test('compatibility catches simulator-specific Python and lifecycle constraints', () => {
  const report = evaluateSimulatorCompatibility(baseHost());

  assert.equal(report.targets.sapien2.compatible, false);
  assert.match(report.targets.sapien2.reasons.join(' '), /Python 3\.7-3\.11/);
  assert.equal(report.targets.newton.installable, false);
  assert.match(report.targets.newton.reasons.join(' '), /does not ship/);
});

test('compatibility summary separates managed setup from external and planned targets', () => {
  const report = evaluateSimulatorCompatibility(
    baseHost({
      gpus: [
        {
          vendor: 'nvidia',
          name: 'NVIDIA RTX PRO 6000 Blackwell',
          memoryMb: 49152,
          driverVersion: '580.95.05',
        },
      ],
      hasCudaDriverLibrary: true,
      docker: {
        installed: true,
        daemonAvailable: true,
        version: '28.0.0',
        runtimes: ['runc', 'nvidia'],
        nvidiaRuntimeAvailable: true,
        error: '',
      },
      totalMemoryGb: 64,
    })
  );

  assert.equal(isManagedSimulatorInstallAllowed(report, 'mjlab'), true);
  assert.equal(isManagedSimulatorInstallAllowed(report, 'isaacsim'), false);
  const lines = formatSimulatorCompatibilitySummary(report);
  assert.match(lines.join('\n'), /Managed runtimes available on this machine: .*Genesis/);
  assert.doesNotMatch(lines.join('\n'), /Not managed by setup: .*MJX/);
  assert.match(lines.join('\n'), /Opt-in container images: .*MJX managed:ghcr\.io\/urdf-studio\/sim-mjx:cuda13/);
  assert.match(lines.join('\n'), /Container build opt-in: URDF_STUDIO_BUILD_SIMULATOR_CONTAINERS=1 npm run setup/);
  assert.match(lines.join('\n'), /SAPIEN 2 managed:ghcr\.io\/urdf-studio\/sim-sapien:vulkan/);
  assert.match(lines.join('\n'), /Container launch plan: npm run simulator:container:plan/);
  assert.match(lines.join('\n'), /Isaac Sim official:nvcr\.io\/nvidia\/isaac-sim:6\.0\.0/);
});

test('compatibility keeps MJX on CUDA 12 JAX wheels for older NVIDIA drivers', () => {
  const report = evaluateSimulatorCompatibility(
    baseHost({
      hasDisplay: false,
      totalMemoryGb: 64,
      gpus: [
        {
          vendor: 'nvidia',
          name: 'NVIDIA RTX 3090',
          memoryMb: 24576,
          driverVersion: '535.183.01',
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
      hasCudaDriverLibrary: true,
    })
  );

  assert.equal(report.targets.mjx.deployment.accelerator, 'cuda12-jax');
  assert.equal(report.targets.mjx.deployment.container.image, 'ghcr.io/urdf-studio/sim-mjx:cuda12');
  assert.equal(report.targets.mjx.deployment.container.build.args.JAX_CUDA_EXTRA, 'cuda12');
});
