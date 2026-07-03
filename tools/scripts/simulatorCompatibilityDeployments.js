import {
  CONTAINER_KINDS,
  DEPLOYMENT_DISPLAY,
  DEPLOYMENT_GPU,
  buildContainerDeployment,
  buildExternalDeployment,
  buildNativeDeployment,
  buildPlannedDeployment,
  buildPythonDeployment,
  nvidiaDriverCapabilities,
} from './simulatorDeployment.js';
import {
  ISAAC_SIM_COMPATIBILITY_CHECK_EXPERIENCE,
  ISAAC_SIM_COMPATIBILITY_CHECK_MINIMAL_PACKAGE,
  ISAAC_SIM_REFERENCE_VERSION,
  MIN_JAX_CUDA13_DRIVER_VERSION,
} from './simulatorCompatibilityParams.js';
import {
  bestNvidiaDriver,
  dockerStatusLabel,
  hasAmdGpu,
  hasAnyGpu,
  hasAppleGpu,
  hasGpuVendor,
  hasNvidiaCuda,
  hasNvidiaDocker,
  hasRtxGpu,
} from './simulatorHostCapabilities.js';
import { compareVersions } from './simulatorVersion.js';

export function buildGenesisDeployment(host) {
  const performanceModeNote =
    'Genesis performance mode remains explicit opt-in because static-shape kernel recompilation can make frequent workspace opens slow.';
  if (hasNvidiaCuda(host)) {
    return buildPythonDeployment({
      accelerator: 'cuda',
      profile: host.hasDisplay ? 'gpu-interactive' : 'gpu-headless',
      gpu: DEPLOYMENT_GPU.cuda,
      display: host.hasDisplay ? DEPLOYMENT_DISPLAY.desktop : DEPLOYMENT_DISPLAY.egl,
      env: {
        URDF_STUDIO_GENESIS_BACKEND: 'gpu',
        CUDA_VISIBLE_DEVICES: '0',
        QD_VISIBLE_DEVICE: '0',
        EGL_DEVICE_ID: '0',
      },
      notes: [
        'Use Genesis GPU backend and keep CUDA, Quadrants, and EGL on the same device.',
        performanceModeNote,
      ],
    });
  }
  if (host.platform === 'darwin' && hasAppleGpu(host)) {
    return buildPythonDeployment({
      accelerator: 'metal',
      profile: 'gpu-interactive',
      gpu: DEPLOYMENT_GPU.metal,
      display: DEPLOYMENT_DISPLAY.desktop,
      env: { URDF_STUDIO_GENESIS_BACKEND: 'metal' },
      notes: ['Use Genesis Metal backend on Apple Silicon.', performanceModeNote],
    });
  }
  if (host.platform === 'linux' && hasAmdGpu(host)) {
    return buildPythonDeployment({
      accelerator: 'amdgpu-auto',
      profile: host.hasDisplay ? 'gpu-interactive' : 'gpu-headless',
      gpu: DEPLOYMENT_GPU.amdgpu,
      display: host.hasDisplay ? DEPLOYMENT_DISPLAY.desktop : DEPLOYMENT_DISPLAY.egl,
      env: {},
      notes: [
        'Genesis supports AMDGPU; URDF Studio leaves backend selection automatic unless ROCm/HIP support is configured.',
        performanceModeNote,
      ],
    });
  }
  return buildPythonDeployment({
    accelerator: 'cpu',
    profile: host.hasDisplay ? 'cpu-interactive' : 'cpu-headless',
    gpu: DEPLOYMENT_GPU.cpu,
    display: host.hasDisplay ? DEPLOYMENT_DISPLAY.desktop : DEPLOYMENT_DISPLAY.none,
    env: { URDF_STUDIO_GENESIS_BACKEND: 'cpu' },
    notes: ['Use CPU backend to avoid overloading low-power machines.', performanceModeNote],
  });
}

export function buildMujocoDeployment(host) {
  if (host.platform === 'linux' && !host.hasDisplay && hasNvidiaCuda(host)) {
    return buildPythonDeployment({
      accelerator: 'egl',
      profile: 'gpu-headless-rendering',
      gpu: DEPLOYMENT_GPU.opengl,
      display: DEPLOYMENT_DISPLAY.egl,
      env: {
        MUJOCO_GL: 'egl',
        PYOPENGL_PLATFORM: 'egl',
        EGL_DEVICE_ID: '0',
      },
      notes: ['Use EGL for hardware-accelerated MuJoCo rendering on headless Linux.'],
    });
  }
  if (host.platform === 'linux' && !host.hasDisplay) {
    return buildPythonDeployment({
      accelerator: 'osmesa',
      profile: 'cpu-headless-rendering',
      gpu: DEPLOYMENT_GPU.cpu,
      display: DEPLOYMENT_DISPLAY.osmesa,
      env: { MUJOCO_GL: 'osmesa' },
      notes: ['Use OSMesa for headless software rendering when GPU EGL is not available.'],
    });
  }
  if (host.platform === 'linux') {
    return buildPythonDeployment({
      accelerator: 'glx',
      profile: 'interactive-viewer',
      gpu: DEPLOYMENT_GPU.opengl,
      display: DEPLOYMENT_DISPLAY.x11,
      env: {},
      notes: ['Use the desktop OpenGL path for the interactive MuJoCo viewer.'],
    });
  }
  return buildPythonDeployment({
    accelerator: 'native-opengl',
    profile: 'interactive-viewer',
    gpu: DEPLOYMENT_GPU.opengl,
    display: DEPLOYMENT_DISPLAY.desktop,
    env: {},
    notes: ['Use the platform OpenGL stack.'],
  });
}

export function buildMjlabDeployment(host) {
  const mujocoDeployment = buildMujocoDeployment(host);
  return {
    ...mujocoDeployment,
    accelerator: hasNvidiaCuda(host) ? `cuda+${mujocoDeployment.accelerator}` : mujocoDeployment.accelerator,
    notes: [
      ...(hasNvidiaCuda(host) ? ['Use mujoco-warp on NVIDIA CUDA when available.'] : []),
      ...mujocoDeployment.notes,
    ],
  };
}

export function buildMjxDeployment(host) {
  if (hasNvidiaDocker(host)) {
    const driver = bestNvidiaDriver(host);
    const jaxCudaExtra = driver && compareVersions(driver, MIN_JAX_CUDA13_DRIVER_VERSION) >= 0
      ? 'cuda13'
      : 'cuda12';
    return buildContainerDeployment({
      image: `ghcr.io/urdf-studio/sim-mjx:${jaxCudaExtra}`,
      accelerator: `${jaxCudaExtra}-jax`,
      profile: 'gpu-batch',
      gpu: DEPLOYMENT_GPU.cuda,
      display: DEPLOYMENT_DISPLAY.none,
      env: {
        CUDA_VISIBLE_DEVICES: '0',
        XLA_PYTHON_CLIENT_PREALLOCATE: 'false',
      },
      build: {
        context: '.',
        dockerfile: 'docker/sim-mjx/Dockerfile',
        args: {
          JAX_CUDA_EXTRA: jaxCudaExtra,
        },
      },
      notes: [
        `Use a dedicated ${jaxCudaExtra.toUpperCase()} JAX/MJX image when Docker and the NVIDIA runtime are available.`,
      ],
    });
  }
  return buildPythonDeployment({
    accelerator: 'cpu',
    profile: 'portable-batch',
    gpu: DEPLOYMENT_GPU.cpu,
    display: DEPLOYMENT_DISPLAY.none,
    env: {},
    notes: ['Use portable CPU JAX/MJX packages on machines without a configured CUDA container/runtime.'],
  });
}

export function buildPybulletDeployment(host) {
  if (host.isWsl && host.hasDisplay && host.hasWslD3d12OpenGl) {
    return buildPythonDeployment({
      accelerator: 'wslg-d3d12-opengl',
      profile: 'static-gui',
      gpu: DEPLOYMENT_GPU.opengl,
      display: DEPLOYMENT_DISPLAY.desktop,
      env: {
        GALLIUM_DRIVER: 'd3d12',
        ...(hasNvidiaCuda(host) ? { MESA_D3D12_DEFAULT_ADAPTER_NAME: 'NVIDIA' } : {}),
      },
      notes: ['Use WSLg D3D12 OpenGL for the PyBullet GUI; Bullet physics remains CPU-based.'],
    });
  }
  return buildPythonDeployment({
    accelerator: 'cpu',
    profile: host.hasDisplay ? 'static-gui' : 'direct-headless',
    gpu: DEPLOYMENT_GPU.cpu,
    display: host.hasDisplay ? DEPLOYMENT_DISPLAY.desktop : DEPLOYMENT_DISPLAY.none,
    env: {},
    notes: ['PyBullet Python uses the Bullet CPU path for this workspace adapter.'],
  });
}

export function buildBlenderDeployment(host) {
  const builder = host.platform === 'linux' ? buildNativeDeployment : buildExternalDeployment;
  return builder({
    accelerator: hasAnyGpu(host) ? 'gpu-ui' : 'cpu-ui',
    profile: host.hasDisplay ? 'interactive-authoring' : 'background-validation',
    gpu: hasAnyGpu(host) ? DEPLOYMENT_GPU.opengl : DEPLOYMENT_GPU.cpu,
    display: host.hasDisplay ? DEPLOYMENT_DISPLAY.desktop : DEPLOYMENT_DISPLAY.none,
    env: {},
    notes: hasAnyGpu(host)
      ? ['Use Blender viewport GPU acceleration through the system graphics stack.']
      : ['Use Blender CPU/background validation on machines without a GPU.'],
  });
}

export function buildSapienDeployment(host) {
  const env = hasGpuVendor(host, 'nvidia')
    ? {
        NVIDIA_DRIVER_CAPABILITIES: nvidiaDriverCapabilities({
          graphics: true,
          compute: true,
          display: host.hasDisplay,
        }),
      }
    : {};
  const useContainer = hasNvidiaDocker(host) || (!host.hasDisplay && host.platform === 'linux');
  const builder = useContainer ? buildContainerDeployment : buildPlannedDeployment;
  return builder({
    ...(useContainer ? { image: 'ghcr.io/urdf-studio/sim-sapien:vulkan' } : {}),
    accelerator: host.vulkan.available ? 'vulkan' : 'gpu-driver-required',
    profile: host.hasDisplay ? 'interactive-viewer' : 'offscreen-rendering',
    gpu: DEPLOYMENT_GPU.vulkan,
    display: host.hasDisplay ? DEPLOYMENT_DISPLAY.vulkan : DEPLOYMENT_DISPLAY.vulkan,
    env,
    ...(useContainer
      ? {
          build: {
            context: '.',
            dockerfile: 'docker/sim-sapien/Dockerfile',
          },
        }
      : {}),
    notes: [
      host.hasDisplay
        ? 'Use the local graphics stack for SAPIEN viewer sessions.'
        : 'Use EGL/offscreen server rendering with graphics, utility, and compute driver capabilities.',
    ],
  });
}

export function buildIsaacSimDeployment(host, reasons) {
  const checker = host.isaacSimCompatibilityChecker;
  const checkerNotes = checker?.available
    ? [`Official Isaac Sim Compatibility Checker ${checker.ok ? 'passed' : 'failed'}: ${checker.summary}.`]
    : [
        `Run NVIDIA Isaac Sim ${ISAAC_SIM_REFERENCE_VERSION} Compatibility Checker before installing externally.`,
        `Minimal checker install: pip install ${ISAAC_SIM_COMPATIBILITY_CHECK_MINIMAL_PACKAGE}; then run isaacsim ${ISAAC_SIM_COMPATIBILITY_CHECK_EXPERIENCE}.`,
      ];
  if (reasons.length === 0 && hasNvidiaDocker(host) && host.platform === 'linux') {
    return buildContainerDeployment({
      image: `nvcr.io/nvidia/isaac-sim:${ISAAC_SIM_REFERENCE_VERSION}`,
      containerKind: CONTAINER_KINDS.official,
      accelerator: 'rtx-cuda',
      profile: 'headless-streaming',
      gpu: DEPLOYMENT_GPU.cuda,
      display: DEPLOYMENT_DISPLAY.webrtc,
      network: 'host',
      ports: ['49100/tcp', '47998/udp', '8210/tcp'],
      volumes: [
        { type: 'volume', source: 'urdf-studio-isaac-kit-cache', target: '/isaac-sim/kit/cache' },
        { type: 'volume', source: 'urdf-studio-isaac-ov-cache', target: '/root/.cache/ov' },
        { type: 'volume', source: 'urdf-studio-isaac-pip-cache', target: '/root/.cache/pip' },
        { type: 'volume', source: 'urdf-studio-isaac-gl-cache', target: '/root/.cache/nvidia/GLCache' },
        { type: 'volume', source: 'urdf-studio-isaac-compute-cache', target: '/root/.nv/ComputeCache' },
        { type: 'volume', source: 'urdf-studio-isaac-logs', target: '/root/.nvidia-omniverse/logs' },
        { type: 'volume', source: 'urdf-studio-isaac-data', target: '/root/.local/share/ov/data' },
        { type: 'volume', source: 'urdf-studio-isaac-documents', target: '/root/Documents' },
      ],
      env: {
        ACCEPT_EULA: 'Y',
        NVIDIA_DRIVER_CAPABILITIES: nvidiaDriverCapabilities({ graphics: true, compute: true, display: true }),
      },
      notes: [
        `Use Isaac Sim ${ISAAC_SIM_REFERENCE_VERSION} container with persistent shader/cache volumes and host networking for livestreaming.`,
        `Container checker: docker run --entrypoint bash --gpus all --rm --network=host nvcr.io/nvidia/isaac-sim:${ISAAC_SIM_REFERENCE_VERSION} ./isaac-sim.compatibility_check.sh --/app/quitAfter=10 --no-window.`,
        ...checkerNotes,
      ],
    });
  }
  return buildExternalDeployment({
    accelerator: hasRtxGpu(host) ? 'rtx-cuda' : 'rtx-required',
    profile: host.isWsl ? 'native-host-required' : 'workstation-or-container',
    gpu: hasRtxGpu(host) ? DEPLOYMENT_GPU.cuda : DEPLOYMENT_GPU.nvidia,
    display: host.isWsl ? DEPLOYMENT_DISPLAY.external : DEPLOYMENT_DISPLAY.desktop,
    env: {},
    notes: [
      host.isWsl
        ? 'Run Isaac Sim outside this WSL checkout: native Windows/Linux workstation, or the official container on a native Linux GPU host.'
        : `Container readiness: ${dockerStatusLabel(host)}.`,
      ...checkerNotes,
    ],
  });
}

export function buildNewtonDeployment(host) {
  return buildPlannedDeployment({
    accelerator: hasNvidiaCuda(host) ? 'cuda-planned' : 'cpu-planned',
    profile: 'planned',
    notes: ['Newton deployment will be enabled when the workspace adapter exists.'],
  });
}

export function buildRoboSplatterDeployment(host) {
  return buildPlannedDeployment({
    accelerator: hasNvidiaCuda(host) ? 'cuda-planned' : 'cuda-required',
    profile: 'planned-renderer',
    notes: ['RoboSplatter should use CUDA when the renderer adapter is implemented.'],
  });
}
