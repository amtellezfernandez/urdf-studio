import {
  DEPLOYMENT_MODES,
  summarizeDeployment,
} from './simulatorDeployment.js';
import {
  MIN_ISAAC_DRIVER_VERSION,
  SIMULATOR_COMPATIBILITY_IDS,
  SIMULATOR_SETUP_MODES,
} from './simulatorCompatibilityParams.js';
import { SIMULATOR_CONTAINER_INSTALL_ENV } from './setupParams.js';
import {
  buildBlenderDeployment,
  buildGenesisDeployment,
  buildIsaacSimDeployment,
  buildMjlabDeployment,
  buildMujocoDeployment,
  buildMjxDeployment,
  buildNewtonDeployment,
  buildPybulletDeployment,
  buildRoboSplatterDeployment,
  buildSapienDeployment,
} from './simulatorCompatibilityDeployments.js';
import {
  bestNvidiaDriver,
  dockerStatusLabel,
  hasAmdGpu,
  hasAppleGpu,
  hasGpuVendor,
  hasNvidiaCuda,
  hasRtxGpu,
  maxGpuMemoryMb,
} from './simulatorHostCapabilities.js';
import {
  createTarget,
  requirePython,
  requireSupportedArch,
} from './simulatorCompatibilityRules.js';
import { detectSimulatorHost } from './simulatorHostDetection.js';
import { compareVersions } from './simulatorVersion.js';

export { SIMULATOR_COMPATIBILITY_IDS, detectSimulatorHost };

function evaluateGenesis(host) {
  const reasons = [];
  const warnings = [];
  requirePython(reasons, host, 'Python >=3.10,<3.14', { min: '3.10', maxExclusive: '3.14' });
  requireSupportedArch(reasons, host);
  if (host.platform === 'win32') {
    reasons.push('URDF Studio managed Genesis setup is not enabled on Windows yet.');
  }
  if (!host.hasDisplay) {
    warnings.push('No desktop display was detected; Genesis may only be usable for headless checks.');
  }
  if (host.platform === 'darwin' && hasAppleGpu(host)) {
    // Genesis uses Metal on Apple Silicon.
  } else if (host.platform === 'linux' && hasAmdGpu(host)) {
    warnings.push(
      'AMD GPU detected; Genesis can use AMDGPU when ROCm/HIP PyTorch and Quadrants support are available.'
    );
  } else if (!hasGpuVendor(host, 'nvidia')) {
    warnings.push('No NVIDIA GPU was detected; Genesis can run on CPU or other GPU backends but may be slower.');
  } else if (!host.hasCudaDriverLibrary) {
    warnings.push('NVIDIA GPU was detected, but libcuda was not found in this environment.');
  }
  return createTarget({
    id: 'genesis',
    managedInstall: host.platform !== 'win32',
    deployment: buildGenesisDeployment(host),
    reasons,
    warnings,
  });
}

function evaluateMujoco(host) {
  const reasons = [];
  const warnings = [];
  requirePython(reasons, host, 'Python >=3.10', { min: '3.10' });
  requireSupportedArch(reasons, host);
  if (!host.hasDisplay) {
    warnings.push('No desktop display was detected; MuJoCo viewer windows may not open.');
  }
  return createTarget({
    id: 'mujoco',
    managedInstall: true,
    deployment: buildMujocoDeployment(host),
    reasons,
    warnings,
  });
}

function evaluateMjx(host) {
  const reasons = [];
  const warnings = [];
  const deployment = buildMjxDeployment(host);
  requirePython(reasons, host, 'Python >=3.10', { min: '3.10' });
  requireSupportedArch(reasons, host);
  if (host.platform === 'darwin') {
    reasons.push('URDF Studio managed MJX setup is not validated on macOS yet.');
  }
  if (host.platform === 'win32') {
    reasons.push('URDF Studio managed MJX setup is not enabled on Windows yet.');
  }
  if (!hasGpuVendor(host, 'nvidia') && host.platform === 'linux') {
    warnings.push('No NVIDIA GPU was detected; JAX/MJX may run on CPU unless another accelerator is configured.');
  }
  return createTarget({
    id: 'mjx',
    managedInstall:
      deployment.mode !== DEPLOYMENT_MODES.container &&
      host.platform !== 'darwin' &&
      host.platform !== 'win32',
    deployment,
    reasons,
    warnings,
  });
}

function evaluateMjlab(host) {
  const reasons = [];
  const warnings = [];
  requirePython(reasons, host, 'Python >=3.10', { min: '3.10' });
  requireSupportedArch(reasons, host, ['x64']);
  if (host.platform !== 'linux') {
    reasons.push('URDF Studio managed MJLab setup is currently Linux x86_64 only.');
  }
  if (!hasGpuVendor(host, 'nvidia')) {
    reasons.push('MJLab validation uses mujoco-warp, which requires an NVIDIA CUDA-capable runtime.');
  } else if (!host.hasCudaDriverLibrary) {
    warnings.push('NVIDIA GPU was detected, but libcuda was not found in this environment.');
  }
  if (!host.hasDisplay) {
    warnings.push('No desktop display was detected; MJLab viewer windows may not open.');
  }
  return createTarget({
    id: 'mjlab',
    managedInstall: host.platform === 'linux' && host.arch === 'x64',
    deployment: buildMjlabDeployment(host),
    reasons,
    warnings,
  });
}

function evaluatePybullet(host) {
  const reasons = [];
  const warnings = [];
  requirePython(reasons, host, 'Python >=3.10', { min: '3.10' });
  requireSupportedArch(reasons, host);
  if (host.platform === 'darwin') {
    reasons.push('URDF Studio managed PyBullet setup is not validated on macOS yet.');
  }
  if (!host.hasDisplay) {
    warnings.push('No desktop display was detected; PyBullet GUI windows may not open.');
  }
  if (host.isWsl && host.hasDisplay && !host.hasWslD3d12OpenGl) {
    warnings.push(
      'WSLg D3D12 OpenGL was not detected; PyBullet may fall back to llvmpipe software rendering and mouse/camera interaction can be slow.'
    );
  }
  return createTarget({
    id: 'pybullet',
    managedInstall: host.platform !== 'darwin',
    deployment: buildPybulletDeployment(host),
    reasons,
    warnings,
  });
}

function evaluateSapien2(host) {
  const reasons = [];
  const warnings = [];
  const deployment = buildSapienDeployment(host);
  if (deployment.mode !== DEPLOYMENT_MODES.container) {
    requirePython(reasons, host, 'Python 3.7-3.11', { min: '3.7', maxExclusive: '3.12' });
  }
  if (host.platform !== 'linux') {
    reasons.push('SAPIEN 2 officially supports Linux distributions for this setup path.');
  }
  if (host.isWsl) {
    reasons.push('SAPIEN Vulkan rendering should run on a native Linux GPU host, not inside WSL.');
  }
  if (!hasGpuVendor(host, 'nvidia') && !hasGpuVendor(host, 'amd')) {
    reasons.push('SAPIEN rendering requires an NVIDIA or AMD GPU.');
  }
  if (!host.vulkan.available && !host.hasDriRenderDevice) {
    reasons.push('SAPIEN rendering requires a Vulkan-capable render device.');
  } else if (!host.vulkan.available) {
    warnings.push('Vulkan was not detected; SAPIEN rendering often needs a working graphics driver stack.');
  }
  return createTarget({
    id: 'sapien2',
    setupMode: SIMULATOR_SETUP_MODES.planned,
    managedInstall: false,
    deployment,
    reasons,
    warnings,
  });
}

function evaluateSapien3(host) {
  const reasons = [];
  const warnings = [];
  if (host.platform !== 'linux') {
    warnings.push('SAPIEN-style rendering support is expected to be strongest on Linux GPU hosts.');
  }
  if (!hasGpuVendor(host, 'nvidia') && !hasGpuVendor(host, 'amd') && !hasGpuVendor(host, 'intel')) {
    warnings.push('No local GPU was detected for SAPIEN rendering.');
  }
  if (!host.vulkan.available) {
    warnings.push('Vulkan was not detected; verify the graphics driver before enabling SAPIEN 3.');
  }
  reasons.push('URDF Studio does not ship a SAPIEN 3 workspace adapter yet.');
  return createTarget({
    id: 'sapien3',
    setupMode: SIMULATOR_SETUP_MODES.planned,
    managedInstall: false,
    deployment: buildSapienDeployment(host),
    reasons,
    warnings,
  });
}

function evaluateIsaacSim(host) {
  const reasons = [];
  const warnings = [];
  const checker = host.isaacSimCompatibilityChecker;
  if (checker?.available && checker.ok) {
    warnings.push(`NVIDIA Isaac Sim Compatibility Checker passed (${checker.source}).`);
  } else {
    if (checker?.available) {
      reasons.push(`NVIDIA Isaac Sim Compatibility Checker failed: ${checker.summary}`);
    }
    requireSupportedArch(reasons, host, ['x64', 'arm64']);
    if (!['linux', 'win32'].includes(host.platform)) {
      reasons.push('Isaac Sim workstation is supported on Ubuntu or Windows, not this OS.');
    }
    if (host.isWsl) {
      reasons.push(
        'URDF Studio is running inside WSL; Isaac Sim should run on a native Windows/Linux workstation, or in the official container on a native Linux GPU host.'
      );
    }
    if (host.normalizedArch === 'aarch64') {
      reasons.push('Isaac Sim aarch64 builds are limited to NVIDIA DGX Spark systems.');
    }
    if (!hasRtxGpu(host)) {
      reasons.push('Isaac Sim requires an NVIDIA RTX GPU with RT cores.');
    }
    const nvidiaVram = maxGpuMemoryMb(host, 'nvidia');
    if (nvidiaVram !== null && nvidiaVram < 16 * 1024) {
      reasons.push('Isaac Sim requires at least 16 GB VRAM.');
    } else if (nvidiaVram === null) {
      warnings.push('NVIDIA VRAM could not be detected; run the Isaac Sim Compatibility Checker in the target environment.');
    }
    if (host.totalMemoryGb !== null && host.totalMemoryGb < 32) {
      reasons.push('Isaac Sim requires at least 32 GB system RAM.');
    }
    const driver = bestNvidiaDriver(host);
    const requiredDriver = MIN_ISAAC_DRIVER_VERSION[host.platform];
    if (driver && requiredDriver && compareVersions(driver, requiredDriver) < 0) {
      reasons.push(`NVIDIA driver ${driver} is below Isaac Sim tested driver ${requiredDriver}.`);
    } else if (!driver && hasGpuVendor(host, 'nvidia')) {
      warnings.push('NVIDIA driver version could not be detected.');
    }
    if (!host.hasDisplay && !host.isContainer) {
      warnings.push('No desktop display was detected; Isaac Sim workstation needs a GUI display.');
    }
    if (!host.vulkan.available) {
      warnings.push('Vulkan was not detected; run Isaac Sim compatibility checks before installing externally.');
    }
  }
  return createTarget({
    id: 'isaacsim',
    setupMode: SIMULATOR_SETUP_MODES.external,
    managedInstall: false,
    deployment: buildIsaacSimDeployment(host, reasons),
    reasons,
    warnings,
  });
}

function evaluateNewton(host) {
  return createTarget({
    id: 'newton',
    setupMode: SIMULATOR_SETUP_MODES.planned,
    managedInstall: false,
    deployment: buildNewtonDeployment(host),
    reasons: ['URDF Studio does not ship a Newton workspace adapter yet.'],
  });
}

function evaluateBlender(host) {
  const reasons = [];
  const warnings = [];
  if (host.totalMemoryGb !== null && host.totalMemoryGb < 8) {
    reasons.push('Blender requires at least 8 GB system RAM.');
  }
  if (host.cpuCount && host.cpuCount < 4) {
    warnings.push('Blender recommends a 4-core CPU or better.');
  }
  if (host.arch === 'x64' && host.cpuFlags.length > 0 && !host.cpuFlags.includes('sse4_2')) {
    reasons.push('Blender x86_64 builds require SSE4.2 CPU support.');
  }
  if (!host.hasDisplay) {
    warnings.push('No desktop display was detected; Blender can install but interactive windows may not open.');
  }
  if (host.platform !== 'linux' || host.arch !== 'x64') {
    reasons.push('URDF Studio managed Blender download is Linux x86_64 only; use a system Blender and set URDF_STUDIO_BLENDER_PATH.');
  }
  return createTarget({
    id: 'blender',
    managedInstall: host.platform === 'linux' && host.arch === 'x64',
    deployment: buildBlenderDeployment(host),
    reasons,
    warnings,
  });
}

function evaluateRoboSplatter(host) {
  const reasons = [];
  const warnings = [];
  if (!hasGpuVendor(host, 'nvidia')) {
    warnings.push('RoboSplatter-style rendering is expected to require a CUDA-capable GPU.');
  }
  reasons.push('URDF Studio does not ship a RoboSplatter workspace adapter yet.');
  return createTarget({
    id: 'robosplatter',
    setupMode: SIMULATOR_SETUP_MODES.planned,
    managedInstall: false,
    deployment: buildRoboSplatterDeployment(host),
    reasons,
    warnings,
  });
}

export function evaluateSimulatorCompatibility(host) {
  const targets = {
    genesis: evaluateGenesis(host),
    mujoco: evaluateMujoco(host),
    mjlab: evaluateMjlab(host),
    mjx: evaluateMjx(host),
    pybullet: evaluatePybullet(host),
    sapien2: evaluateSapien2(host),
    sapien3: evaluateSapien3(host),
    isaacsim: evaluateIsaacSim(host),
    newton: evaluateNewton(host),
    blender: evaluateBlender(host),
    robosplatter: evaluateRoboSplatter(host),
  };
  return {
    host,
    targets,
  };
}

export function getSimulatorCompatibilityReport(options = {}) {
  return evaluateSimulatorCompatibility(detectSimulatorHost(options));
}

export function getSimulatorCompatibilityTarget(report, simulatorId) {
  return report?.targets?.[simulatorId] || null;
}

export function isManagedSimulatorInstallAllowed(report, simulatorId) {
  const target = getSimulatorCompatibilityTarget(report, simulatorId);
  return target ? target.installable : true;
}

function firstReason(target) {
  if (target.reasons.length > 0) return target.reasons[0];
  if (target.compatible && target.deployment?.mode === DEPLOYMENT_MODES.container) {
    return 'container fast path';
  }
  if (target.setupMode === SIMULATOR_SETUP_MODES.external) return 'external install';
  if (target.setupMode === SIMULATOR_SETUP_MODES.planned) return 'adapter planned';
  return 'not installable';
}

function summarizeTarget(target) {
  if (target.installable) return target.label;
  if (target.setupMode === SIMULATOR_SETUP_MODES.external && target.compatible) {
    return `${target.label} (external)`;
  }
  return `${target.label} (${firstReason(target)})`;
}

function summarizeDeploymentTarget(target) {
  return `${target.label} ${summarizeDeployment(target.deployment)}`;
}

function summarizeContainerTarget(target) {
  const image = target.deployment?.container?.image || target.deployment?.image || 'image pending';
  const kind = target.deployment?.container?.kind || 'container';
  return `${target.label} ${kind}:${image}`;
}

export function buildSimulatorCompatibilitySummary(report) {
  const allTargets = SIMULATOR_COMPATIBILITY_IDS
    .map((id) => getSimulatorCompatibilityTarget(report, id))
    .filter(Boolean);
  const managedReady = allTargets.filter((target) => target.installable);
  const notInstalled = allTargets.filter(
    (target) =>
      !target.installable &&
      !(target.compatible && target.deployment?.mode === DEPLOYMENT_MODES.container)
  );
  const warnings = allTargets.flatMap((target) =>
    target.warnings.map((warning) => `${target.label}: ${warning}`)
  );
  const deploymentTargets = allTargets.filter(
    (target) =>
      target.installable ||
      (target.compatible && target.deployment?.mode === DEPLOYMENT_MODES.container)
  );
  const containerTargets = deploymentTargets.filter(
    (target) => target.deployment?.mode === DEPLOYMENT_MODES.container
  );
  return {
    managedReady,
    notInstalled,
    deploymentTargets,
    containerTargets,
    warnings,
  };
}

export function formatSimulatorCompatibilitySummary(report) {
  const summary = buildSimulatorCompatibilitySummary(report);
  const lines = [];
  lines.push(
    summary.managedReady.length > 0
      ? `Managed runtimes available on this machine: ${summary.managedReady.map((target) => target.label).join(', ')}`
      : 'Managed runtimes available on this machine: none'
  );
  if (summary.notInstalled.length > 0) {
    lines.push(`Not managed by setup: ${summary.notInstalled.map(summarizeTarget).join(', ')}`);
  }
  if (summary.deploymentTargets.length > 0) {
    lines.push(`Fast path: ${summary.deploymentTargets.map(summarizeDeploymentTarget).join(', ')}`);
  }
  if (summary.containerTargets.length > 0) {
    lines.push(`Opt-in container images: ${summary.containerTargets.map(summarizeContainerTarget).join(', ')}`);
    lines.push(`Container build opt-in: ${SIMULATOR_CONTAINER_INSTALL_ENV}=1 npm run setup`);
    lines.push('Container launch plan: npm run simulator:container:plan -- <simulator-id> --workspace <path>');
  }
  if (report?.host?.docker) {
    lines.push(`Container runtime: ${dockerStatusLabel(report.host)}`);
  }
  if (summary.warnings.length > 0) {
    lines.push(`Warnings: ${summary.warnings.slice(0, 3).join(' | ')}`);
  }
  return lines;
}
