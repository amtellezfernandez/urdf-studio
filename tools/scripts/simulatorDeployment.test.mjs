import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEPLOYMENT_DISPLAY,
  DEPLOYMENT_GPU,
  buildContainerDeployment,
  buildDockerBuildPlan,
  buildDockerRunPlan,
  buildPythonDeployment,
  formatDockerRunCommand,
} from './simulatorDeployment.js';
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

test('Docker run planner uses the shared CUDA container path for MJX', () => {
  const report = evaluateSimulatorCompatibility(baseHost());
  const deployment = report.targets.mjx.deployment;
  const plan = buildDockerRunPlan(deployment, {
    name: 'urdf-studio-mjx',
    detach: true,
    workspaceDir: '/studio/workspaces/active',
    hostEnv: {},
    platform: 'linux',
  });

  assert.equal(plan.command, 'docker');
  assert.equal(plan.image, 'ghcr.io/urdf-studio/sim-mjx:cuda13');
  assert.equal(argAfter(plan.args, '--gpus'), 'all');
  assert.ok(plan.args.includes('--detach'));
  assert.ok(plan.args.includes('--name'));
  assert.ok(plan.args.includes('--env'));
  assert.ok(plan.args.includes('CUDA_VISIBLE_DEVICES=0'));
  assert.ok(plan.args.includes('XLA_PYTHON_CLIENT_PREALLOCATE=false'));
  assert.ok(plan.args.includes('type=bind,source=/studio/workspaces/active,target=/workspace'));
  assert.equal(plan.args.at(-1), 'ghcr.io/urdf-studio/sim-mjx:cuda13');
});

test('Docker build planner builds the managed MJX CUDA image from the repo recipe', () => {
  const report = evaluateSimulatorCompatibility(baseHost());
  const deployment = report.targets.mjx.deployment;
  const plan = buildDockerBuildPlan(deployment, { progress: 'plain' });

  assert.equal(plan.command, 'docker');
  assert.equal(plan.image, 'ghcr.io/urdf-studio/sim-mjx:cuda13');
  assert.ok(plan.args.includes('build'));
  assert.ok(plan.args.includes('--pull'));
  assert.equal(argAfter(plan.args, '--tag'), 'ghcr.io/urdf-studio/sim-mjx:cuda13');
  assert.equal(argAfter(plan.args, '--file'), 'docker/sim-mjx/Dockerfile');
  assert.ok(plan.args.includes('JAX_CUDA_EXTRA=cuda13'));
  assert.equal(plan.args.at(-1), '.');
});

test('Docker run planner keeps Isaac Sim on the official host-network container path', () => {
  const report = evaluateSimulatorCompatibility(baseHost());
  const deployment = report.targets.isaacsim.deployment;
  const plan = buildDockerRunPlan(deployment, {
    workspaceDir: '/studio/workspaces/active',
    hostEnv: {},
    platform: 'linux',
  });

  assert.equal(plan.image, 'nvcr.io/nvidia/isaac-sim:6.0.0');
  assert.equal(argAfter(plan.args, '--gpus'), 'all');
  assert.equal(argAfter(plan.args, '--network'), 'host');
  assert.equal(plan.args.includes('--publish'), false);
  assert.ok(plan.args.includes('ACCEPT_EULA=Y'));
  assert.ok(plan.args.includes('NVIDIA_DRIVER_CAPABILITIES=graphics,utility,compute,display'));
  assert.ok(
    plan.args.includes('type=volume,source=urdf-studio-isaac-compute-cache,target=/root/.nv/ComputeCache')
  );
  assert.ok(
    plan.args.includes('type=bind,source=/studio/workspaces/active,target=/workspace')
  );
});

test('Docker run planner adds Vulkan and desktop display resources generically', () => {
  const deployment = buildContainerDeployment({
    image: 'ghcr.io/urdf-studio/sim-sapien:vulkan',
    accelerator: 'vulkan',
    gpu: DEPLOYMENT_GPU.vulkan,
    display: DEPLOYMENT_DISPLAY.x11,
    env: { NVIDIA_DRIVER_CAPABILITIES: 'graphics,utility,compute,display' },
  });
  const plan = buildDockerRunPlan(deployment, {
    hostEnv: { DISPLAY: ':0' },
    platform: 'linux',
  });

  assert.equal(argAfter(plan.args, '--gpus'), 'all');
  assert.equal(argAfter(plan.args, '--device'), '/dev/dri');
  assert.ok(plan.args.includes('DISPLAY=:0'));
  assert.ok(plan.args.includes('QT_X11_NO_MITSHM=1'));
  assert.ok(plan.args.includes('type=bind,source=/tmp/.X11-unix,target=/tmp/.X11-unix'));
});

test('Docker planners build and run the managed SAPIEN Vulkan container', () => {
  const report = evaluateSimulatorCompatibility(baseHost());
  const deployment = report.targets.sapien2.deployment;
  const buildPlan = buildDockerBuildPlan(deployment);
  const runPlan = buildDockerRunPlan(deployment, {
    hostEnv: {},
    platform: 'linux',
  });

  assert.equal(buildPlan.image, 'ghcr.io/urdf-studio/sim-sapien:vulkan');
  assert.equal(argAfter(buildPlan.args, '--file'), 'docker/sim-sapien/Dockerfile');
  assert.equal(buildPlan.args.at(-1), '.');
  assert.equal(runPlan.image, 'ghcr.io/urdf-studio/sim-sapien:vulkan');
  assert.equal(argAfter(runPlan.args, '--gpus'), 'all');
  assert.equal(argAfter(runPlan.args, '--device'), '/dev/dri');
  assert.ok(runPlan.args.includes('NVIDIA_DRIVER_CAPABILITIES=graphics,utility,compute'));
});

test('Docker run planner publishes declared ports outside host networking', () => {
  const deployment = buildContainerDeployment({
    image: 'ghcr.io/urdf-studio/sim-viewer:test',
    accelerator: 'cpu',
    gpu: DEPLOYMENT_GPU.cpu,
    display: DEPLOYMENT_DISPLAY.novnc,
    ports: ['6080/tcp', { host: 9000, container: 9001, protocol: 'udp' }],
  });
  const plan = buildDockerRunPlan(deployment, { hostEnv: {}, platform: 'linux' });

  assert.ok(plan.args.includes('6080:6080/tcp'));
  assert.ok(plan.args.includes('9000:9001/udp'));
});

test('Docker command formatter quotes arguments only when required', () => {
  const plan = {
    command: 'docker',
    args: ['run', '--env', 'VALUE=needs spaces', 'image:latest'],
  };

  assert.equal(formatDockerRunCommand(plan), "docker run --env 'VALUE=needs spaces' image:latest");
});

test('Docker run planner rejects non-container deployments', () => {
  assert.throws(
    () => buildDockerRunPlan(buildPythonDeployment({ accelerator: 'cpu' })),
    /requires a container deployment/
  );
});

test('Docker build planner rejects containers without a build recipe', () => {
  const deployment = buildContainerDeployment({
    image: 'example.com/external:latest',
    accelerator: 'cuda',
    gpu: DEPLOYMENT_GPU.cuda,
  });

  assert.throws(
    () => buildDockerBuildPlan(deployment),
    /does not include a managed build recipe/
  );
});
