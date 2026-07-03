import test from 'node:test';
import assert from 'node:assert/strict';

import { detectSimulatorHost } from './simulatorHostDetection.js';

test('host detection uses environment capabilities instead of hardcoded user paths', () => {
  const files = new Map([
    ['/etc/os-release', 'ID=ubuntu\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04"\n'],
    ['/proc/version', 'Linux version 6.6.87.2-microsoft-standard-WSL2'],
    ['/proc/cpuinfo', 'flags\t: sse4_2 avx avx2\n'],
    ['/proc/1/cgroup', '0::/init.scope'],
  ]);
  const spawnSyncImpl = (command) => {
    if (command === 'python3') {
      return {
        status: 0,
        stdout: JSON.stringify({
          major: 3,
          minor: 12,
          patch: 11,
          executable: '/workspace/.venv/bin/python3',
        }),
        stderr: '',
      };
    }
    if (command === 'nvidia-smi') {
      return {
        status: 0,
        stdout: 'NVIDIA GeForce RTX Laptop GPU, 16303, 592.27\n',
        stderr: '',
      };
    }
    if (command === 'lspci') {
      return {
        status: 0,
        stdout: '0000:01:00.0 VGA compatible controller: NVIDIA Corporation Device\n',
        stderr: '',
      };
    }
    if (command === 'ldconfig') {
      return { status: 0, stdout: 'libcuda.so.1 (libc6,x86-64) => /usr/lib/wsl/lib/libcuda.so.1\n', stderr: '' };
    }
    if (command === 'docker') {
      return { status: 1, stdout: '', stderr: 'docker daemon unavailable' };
    }
    return { status: 1, stdout: '', stderr: 'not available' };
  };

  const host = detectSimulatorHost({
    env: {
      WSL_DISTRO_NAME: 'Ubuntu',
      WAYLAND_DISPLAY: 'wayland-0',
    },
    platform: 'linux',
    arch: 'x64',
    spawnSyncImpl,
    readFileSyncImpl: (path) => files.get(path) || '',
    existsSyncImpl: (path) =>
      [
        '/dev/dxg',
        '/usr/lib/x86_64-linux-gnu/dri/d3d12_dri.so',
        '/usr/lib/wsl/lib',
        '/usr/lib/wsl/lib/libcuda.so.1',
      ].includes(path),
    totalmemImpl: () => 32 * 1024 ** 3,
    cpusImpl: () => new Array(24).fill({ model: 'CPU' }),
  });

  assert.equal(host.isWsl, true);
  assert.equal(host.hasDisplay, true);
  assert.equal(host.pythonVersion.minor, 12);
  assert.equal(host.gpus[0].name, 'NVIDIA GeForce RTX Laptop GPU');
  assert.equal(host.hasCudaDriverLibrary, true);
  assert.equal(host.hasDriRenderDevice, false);
  assert.equal(host.hasWslD3d12OpenGl, true);
  assert.equal(host.docker.daemonAvailable, false);
});

test('host detection reuses installed Isaac Sim compatibility checker', () => {
  const commands = [];
  const spawnSyncImpl = (command, args) => {
    commands.push([command, args]);
    if (command === 'python3') {
      return {
        status: 0,
        stdout: JSON.stringify({
          major: 3,
          minor: 12,
          patch: 11,
          executable: '/workspace/.venv/bin/python3',
        }),
        stderr: '',
      };
    }
    if (command === 'isaacsim') {
      return {
        status: 0,
        stdout: 'Isaac Sim Compatibility Checker\nAll checks passed\n0 failed\n',
        stderr: '',
      };
    }
    return { status: 1, stdout: '', stderr: 'not available', error: { message: 'ENOENT' } };
  };

  const host = detectSimulatorHost({
    env: {},
    platform: 'linux',
    arch: 'x64',
    spawnSyncImpl,
    readFileSyncImpl: () => '',
    existsSyncImpl: () => false,
    totalmemImpl: () => 64 * 1024 ** 3,
    cpusImpl: () => new Array(16).fill({ model: 'CPU' }),
  });

  assert.equal(host.isaacSimCompatibilityChecker.ok, true);
  assert.equal(host.isaacSimCompatibilityChecker.source, 'Isaac Sim Python package');
  assert.ok(
    commands.some(
      ([command, args]) =>
        command === 'isaacsim' && args.includes('isaacsim.exp.compatibility_check')
    )
  );
});
