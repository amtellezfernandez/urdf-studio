import os from 'os';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import {
  CONTAINER_KINDS,
  DEPLOYMENT_DISPLAY,
  DEPLOYMENT_GPU,
  DEPLOYMENT_MODES,
  buildContainerDeployment,
  buildExternalDeployment,
  buildNativeDeployment,
  buildPlannedDeployment,
  buildPythonDeployment,
  nvidiaDriverCapabilities,
  summarizeDeployment,
} from './simulatorDeployment.js';

export const SIMULATOR_COMPATIBILITY_IDS = Object.freeze([
  'genesis',
  'mujoco',
  'mjlab',
  'mjx',
  'pybullet',
  'sapien2',
  'sapien3',
  'isaacsim',
  'newton',
  'blender',
  'robosplatter',
]);

const TARGET_LABELS = Object.freeze({
  genesis: 'Genesis',
  mujoco: 'MuJoCo',
  mjlab: 'MJLab',
  mjx: 'MJX',
  pybullet: 'PyBullet',
  sapien2: 'SAPIEN 2',
  sapien3: 'SAPIEN 3',
  isaacsim: 'Isaac Sim',
  newton: 'Newton',
  blender: 'Blender',
  robosplatter: 'RoboSplatter',
});

const SETUP_MODES = Object.freeze({
  managed: 'managed',
  external: 'external',
  planned: 'planned',
});

const MIN_ISAAC_DRIVER_VERSION = Object.freeze({
  linux: '580.65.06',
  win32: '580.88',
});
const MIN_JAX_CUDA13_DRIVER_VERSION = '580';
const ISAAC_SIM_REFERENCE_VERSION = '6.0.0';
const ISAAC_SIM_COMPATIBILITY_CHECK_EXPERIENCE = 'isaacsim.exp.compatibility_check';
const ISAAC_SIM_COMPATIBILITY_CHECK_MINIMAL_PACKAGE = 'isaacsim[compatibility-check]';

const GB = 1024 ** 3;

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function normalizeArch(arch) {
  if (arch === 'x64') return 'x86_64';
  if (arch === 'arm64') return 'aarch64';
  return arch || 'unknown';
}

function parseOsRelease(content) {
  const result = {};
  for (const line of asString(content).split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1].toLowerCase()] = value;
  }
  return result;
}

function safeRead(path, readFileSyncImpl = readFileSync) {
  try {
    return readFileSyncImpl(path, 'utf-8');
  } catch {
    return '';
  }
}

function runCommand(
  command,
  args = [],
  { spawnSyncImpl = spawnSync, env = process.env, timeout = 8000 } = {}
) {
  try {
    const result = spawnSyncImpl(command, args, {
      encoding: 'utf-8',
      env,
      timeout,
    });
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: asString(result.stdout).trim(),
      stderr: asString(result.stderr).trim(),
      error: result.error ? result.error.message : '',
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      stdout: '',
      stderr: '',
      error: error?.message || String(error),
    };
  }
}

function parseVersion(version) {
  return asString(version)
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
}

function compareVersions(actual, required) {
  const actualParts = parseVersion(actual);
  const requiredParts = parseVersion(required);
  const count = Math.max(actualParts.length, requiredParts.length);
  for (let index = 0; index < count; index += 1) {
    const actualPart = actualParts[index] || 0;
    const requiredPart = requiredParts[index] || 0;
    if (actualPart > requiredPart) return 1;
    if (actualPart < requiredPart) return -1;
  }
  return 0;
}

function pythonVersionSatisfies(pythonVersion, { min = null, maxExclusive = null } = {}) {
  if (!pythonVersion) return false;
  const version = `${pythonVersion.major}.${pythonVersion.minor}.${pythonVersion.patch || 0}`;
  if (min && compareVersions(version, min) < 0) return false;
  if (maxExclusive && compareVersions(version, maxExclusive) >= 0) return false;
  return true;
}

function describePythonVersion(pythonVersion) {
  if (!pythonVersion) return 'unknown Python';
  return `Python ${pythonVersion.major}.${pythonVersion.minor}`;
}

function detectPythonVersion({
  pythonExecutable,
  spawnSyncImpl = spawnSync,
  env = process.env,
} = {}) {
  const executable = pythonExecutable || env.PYTHON || 'python3';
  const script = [
    'import json, sys',
    'print(json.dumps({"major": sys.version_info.major, "minor": sys.version_info.minor, "patch": sys.version_info.micro, "executable": sys.executable}))',
  ].join('\n');
  const result = runCommand(executable, ['-c', script], { spawnSyncImpl, env });
  if (!result.ok || !result.stdout) {
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout);
    if (!Number.isInteger(parsed.major) || !Number.isInteger(parsed.minor)) {
      return null;
    }
    return {
      major: parsed.major,
      minor: parsed.minor,
      patch: Number.isInteger(parsed.patch) ? parsed.patch : 0,
      executable: asString(parsed.executable) || executable,
    };
  } catch {
    return null;
  }
}

function parseNvidiaSmiOutput(output) {
  return asString(output)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = '', memory = '', driverVersion = ''] = line.split(',').map((part) => part.trim());
      return {
        vendor: 'nvidia',
        name,
        memoryMb: Number(memory) || null,
        driverVersion,
      };
    })
    .filter((gpu) => gpu.name);
}

function detectNvidiaGpus({
  env = process.env,
  spawnSyncImpl = spawnSync,
  existsSyncImpl = existsSync,
} = {}) {
  const args = [
    '--query-gpu=name,memory.total,driver_version',
    '--format=csv,noheader,nounits',
  ];
  const candidates = ['nvidia-smi'];
  if (existsSyncImpl('/usr/lib/wsl/lib/nvidia-smi')) {
    candidates.push('/usr/lib/wsl/lib/nvidia-smi');
  }

  for (const command of candidates) {
    const result = runCommand(command, args, { spawnSyncImpl, env });
    if (result.ok && result.stdout) {
      const gpus = parseNvidiaSmiOutput(result.stdout);
      if (gpus.length > 0) return gpus;
    }
  }
  return [];
}

function parseLinuxLspciGpus(output) {
  return asString(output)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /(VGA compatible controller|3D controller|Display controller)/i.test(line))
    .map((line) => {
      const lower = line.toLowerCase();
      const vendor = lower.includes('nvidia')
        ? 'nvidia'
        : lower.includes('amd') || lower.includes('advanced micro devices') || lower.includes('ati')
          ? 'amd'
          : lower.includes('intel')
            ? 'intel'
            : 'unknown';
      return {
        vendor,
        name: line.replace(/^[0-9a-f:.]+\s+[^:]+:\s*/i, ''),
        memoryMb: null,
        driverVersion: '',
      };
    });
}

function detectLinuxDisplayGpus({ spawnSyncImpl = spawnSync, env = process.env } = {}) {
  const result = runCommand('lspci', [], { spawnSyncImpl, env });
  return result.ok ? parseLinuxLspciGpus(result.stdout) : [];
}

function detectMacDisplayGpus({ spawnSyncImpl = spawnSync, env = process.env } = {}) {
  const result = runCommand('system_profiler', ['SPDisplaysDataType'], { spawnSyncImpl, env });
  if (!result.ok || !result.stdout) return [];
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^Chipset Model:/i.test(line))
    .map((line) => ({
      vendor: /apple/i.test(line) ? 'apple' : /amd/i.test(line) ? 'amd' : /intel/i.test(line) ? 'intel' : 'unknown',
      name: line.replace(/^Chipset Model:\s*/i, ''),
      memoryMb: null,
      driverVersion: '',
    }));
}

function parseWindowsGpuJson(output) {
  try {
    const parsed = JSON.parse(output);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries
      .filter(Boolean)
      .map((entry) => {
        const name = asString(entry.Name);
        const lower = name.toLowerCase();
        const adapterRam = Number(entry.AdapterRAM);
        return {
          vendor: lower.includes('nvidia')
            ? 'nvidia'
            : lower.includes('amd') || lower.includes('radeon')
              ? 'amd'
              : lower.includes('intel')
                ? 'intel'
                : 'unknown',
          name,
          memoryMb: Number.isFinite(adapterRam) && adapterRam > 0 ? Math.round(adapterRam / 1024 ** 2) : null,
          driverVersion: asString(entry.DriverVersion),
        };
      })
      .filter((gpu) => gpu.name);
  } catch {
    return [];
  }
}

function detectWindowsDisplayGpus({ spawnSyncImpl = spawnSync, env = process.env } = {}) {
  const command = [
    'Get-CimInstance Win32_VideoController',
    '| Select-Object Name, AdapterRAM, DriverVersion',
    '| ConvertTo-Json -Compress',
  ].join(' ');
  const result = runCommand(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { spawnSyncImpl, env }
  );
  return result.ok && result.stdout ? parseWindowsGpuJson(result.stdout) : [];
}

function detectDisplayGpus({
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  env = process.env,
} = {}) {
  if (platform === 'linux') return detectLinuxDisplayGpus({ spawnSyncImpl, env });
  if (platform === 'darwin') return detectMacDisplayGpus({ spawnSyncImpl, env });
  if (platform === 'win32') return detectWindowsDisplayGpus({ spawnSyncImpl, env });
  return [];
}

function mergeGpus(primary, secondary) {
  const merged = [];
  const seen = new Set();
  for (const gpu of [...primary, ...secondary]) {
    const key = `${gpu.vendor}:${gpu.name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(gpu);
  }
  return merged;
}

function detectVulkan({
  env = process.env,
  spawnSyncImpl = spawnSync,
} = {}) {
  const result = runCommand('vulkaninfo', ['--summary'], { spawnSyncImpl, env });
  if (result.ok) {
    return {
      available: true,
      reason: '',
    };
  }
  return {
    available: false,
    reason: result.error || result.stderr || 'vulkaninfo is not available',
  };
}

function parseDockerRuntimes(output) {
  const rawOutput = asString(output).trim();
  if (!rawOutput) return [];
  try {
    const parsed = JSON.parse(rawOutput);
    if (parsed && typeof parsed === 'object') {
      return Object.keys(parsed);
    }
  } catch {
    // Docker formats vary; fall through to token parsing.
  }
  return rawOutput
    .split(/[^A-Za-z0-9_.-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function detectDockerRuntime({
  env = process.env,
  spawnSyncImpl = spawnSync,
} = {}) {
  const versionResult = runCommand('docker', ['version', '--format', '{{.Server.Version}}'], {
    spawnSyncImpl,
    env,
  });
  const infoResult = runCommand('docker', ['info', '--format', '{{json .Runtimes}}'], {
    spawnSyncImpl,
    env,
  });
  const nvidiaCtkResult = runCommand('nvidia-ctk', ['--version'], { spawnSyncImpl, env });
  const nvidiaContainerCliResult = runCommand('nvidia-container-cli', ['--version'], {
    spawnSyncImpl,
    env,
  });
  const runtimes = infoResult.ok ? parseDockerRuntimes(infoResult.stdout) : [];
  const nvidiaRuntimeAvailable =
    runtimes.some((runtime) => runtime.toLowerCase() === 'nvidia') ||
    nvidiaCtkResult.ok ||
    nvidiaContainerCliResult.ok;
  return {
    installed: versionResult.ok || infoResult.ok,
    daemonAvailable: versionResult.ok,
    version: versionResult.ok ? versionResult.stdout : '',
    runtimes,
    nvidiaRuntimeAvailable,
    error: versionResult.ok ? '' : versionResult.error || versionResult.stderr,
  };
}

function splitCommandLine(value) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
  let match = pattern.exec(asString(value));
  while (match) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
    match = pattern.exec(asString(value));
  }
  return tokens.filter(Boolean);
}

function commandUnavailable(result) {
  const detail = `${result.error}\n${result.stderr}`.toLowerCase();
  return result.status === null && /(enoent|not found|no such file|cannot find)/i.test(detail);
}

function summarizeCommandOutput(result) {
  const output = `${result.stdout}\n${result.stderr}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (output.length > 0) return output.slice(0, 3).join(' ');
  if (result.status !== null && result.status !== 0) return `exit code ${result.status}`;
  return result.error || 'no output';
}

function officialIsaacSimCheckerPassed(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  const hasFailureMarker =
    /\b(failed|not compatible|requirements? not met)\b/i.test(output) &&
    !/\b0\s+failed\b/i.test(output);
  return result.ok && !hasFailureMarker;
}

function officialIsaacSimCheckerCandidates({ env, platform, existsSyncImpl }) {
  const candidates = [];
  const explicitCommand = splitCommandLine(
    env.URDF_STUDIO_ISAACSIM_COMPATIBILITY_CHECKER ||
      env.URDF_STUDIO_ISAAC_SIM_COMPATIBILITY_CHECKER ||
      ''
  );
  if (explicitCommand.length > 0) {
    candidates.push({
      command: explicitCommand[0],
      args: explicitCommand.slice(1),
      source: 'configured command',
      required: true,
    });
  }

  const scriptNames =
    platform === 'win32'
      ? ['isaac-sim.compatibility_check.bat', 'omni.isaac.sim.compatibility_check.bat']
      : ['isaac-sim.compatibility_check.sh', 'omni.isaac.sim.compatibility_check.sh'];
  const rootCandidates = [
    env.ISAACSIM_ROOT,
    env.ISAAC_SIM_ROOT,
    env.OMNI_ISAACSIM_ROOT,
    env.OMNI_ISAAC_SIM_ROOT,
  ]
    .map((root) => asString(root).trim())
    .filter(Boolean);
  for (const root of rootCandidates) {
    for (const scriptName of scriptNames) {
      const scriptPath = path.join(root, scriptName);
      if (!existsSyncImpl(scriptPath)) continue;
      candidates.push({
        command: scriptPath,
        args: ['--/app/quitAfter=10', '--no-window'],
        source: 'Isaac Sim workstation script',
        required: true,
      });
    }
  }

  candidates.push({
    command: 'isaacsim',
    args: [ISAAC_SIM_COMPATIBILITY_CHECK_EXPERIENCE, '--/app/quitAfter=10', '--no-window'],
    source: 'Isaac Sim Python package',
    required: false,
  });

  for (const scriptName of scriptNames) {
    candidates.push({
      command: scriptName,
      args: ['--/app/quitAfter=10', '--no-window'],
      source: 'Isaac Sim compatibility script',
      required: false,
    });
  }

  return candidates;
}

function detectOfficialIsaacSimCompatibilityChecker({
  env = process.env,
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  existsSyncImpl = existsSync,
} = {}) {
  if (env.URDF_STUDIO_SKIP_ISAACSIM_COMPATIBILITY_CHECKER === '1') {
    return null;
  }

  for (const candidate of officialIsaacSimCheckerCandidates({ env, platform, existsSyncImpl })) {
    const command =
      platform === 'win32' && /\.bat$/i.test(candidate.command)
        ? 'cmd.exe'
        : candidate.command;
    const args =
      platform === 'win32' && /\.bat$/i.test(candidate.command)
        ? ['/c', candidate.command, ...candidate.args]
        : candidate.args;
    const result = runCommand(command, args, {
      spawnSyncImpl,
      env,
      timeout: 90_000,
    });
    if (!candidate.required && commandUnavailable(result)) continue;
    return {
      available: true,
      ok: officialIsaacSimCheckerPassed(result),
      source: candidate.source,
      command: [candidate.command, ...candidate.args].join(' '),
      status: result.status,
      summary: summarizeCommandOutput(result),
    };
  }

  return null;
}

function detectCudaDriverLibrary({
  platform = process.platform,
  existsSyncImpl = existsSync,
  spawnSyncImpl = spawnSync,
  env = process.env,
} = {}) {
  if (platform === 'win32') return true;
  const candidates = [
    '/usr/lib/wsl/lib/libcuda.so',
    '/usr/lib/wsl/lib/libcuda.so.1',
    '/usr/lib/x86_64-linux-gnu/libcuda.so',
    '/usr/lib/x86_64-linux-gnu/libcuda.so.1',
    '/usr/local/cuda/lib64/stubs/libcuda.so',
  ];
  if (candidates.some((candidate) => existsSyncImpl(candidate))) return true;
  const ldconfig = runCommand('ldconfig', ['-p'], { spawnSyncImpl, env });
  return ldconfig.ok && /\blibcuda\.so(?:\.1)?\b/.test(ldconfig.stdout);
}

function detectCpuFlags({
  platform = process.platform,
  readFileSyncImpl = readFileSync,
  spawnSyncImpl = spawnSync,
  env = process.env,
} = {}) {
  if (platform === 'linux') {
    const cpuInfo = safeRead('/proc/cpuinfo', readFileSyncImpl).toLowerCase();
    const flagsLine = cpuInfo
      .split('\n')
      .find((line) => line.startsWith('flags') || line.startsWith('features'));
    if (!flagsLine) return [];
    const [, flags = ''] = flagsLine.split(':');
    return flags.trim().split(/\s+/).filter(Boolean);
  }
  if (platform === 'darwin') {
    const result = runCommand('sysctl', ['-n', 'machdep.cpu.features'], { spawnSyncImpl, env });
    return result.ok ? result.stdout.toLowerCase().split(/\s+/).filter(Boolean) : [];
  }
  return [];
}

function hasDisplayEnvironment({ platform, env }) {
  if (env.URDF_STUDIO_HEADLESS === '1' || env.CI === 'true' || env.CI === '1') {
    return false;
  }
  if (platform === 'linux') {
    return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY || env.MIR_SOCKET || env.WSL2_GUI_APPS_ENABLED);
  }
  if (platform === 'darwin') {
    return !env.SSH_CONNECTION;
  }
  if (platform === 'win32') {
    return !env.SSH_CONNECTION;
  }
  return false;
}

function isWslHost({ env, readFileSyncImpl }) {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP || env.WSLENV) {
    return true;
  }
  return /microsoft|wsl/i.test(safeRead('/proc/version', readFileSyncImpl));
}

function isContainerHost({ existsSyncImpl, readFileSyncImpl }) {
  if (existsSyncImpl('/.dockerenv')) return true;
  return /docker|containerd|kubepods|podman/i.test(safeRead('/proc/1/cgroup', readFileSyncImpl));
}

function hasDriRenderDevice({ platform, existsSyncImpl }) {
  return (
    platform === 'linux' &&
    (
      existsSyncImpl('/dev/dri/renderD128') ||
      existsSyncImpl('/dev/dri/card0') ||
      existsSyncImpl('/dev/dri')
    )
  );
}

function formatMemoryGb(totalBytes) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
  return Math.round((totalBytes / GB) * 10) / 10;
}

export function detectSimulatorHost({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  pythonExecutable = null,
  spawnSyncImpl = spawnSync,
  readFileSyncImpl = readFileSync,
  existsSyncImpl = existsSync,
  totalmemImpl = os.totalmem,
  cpusImpl = os.cpus,
} = {}) {
  const osRelease =
    platform === 'linux'
      ? parseOsRelease(safeRead('/etc/os-release', readFileSyncImpl))
      : {};
  const nvidiaGpus = detectNvidiaGpus({ env, spawnSyncImpl, existsSyncImpl });
  const displayGpus = detectDisplayGpus({ platform, spawnSyncImpl, env });
  const gpus = mergeGpus(nvidiaGpus, displayGpus);
  const totalMemoryBytes = totalmemImpl();
  const cpus = cpusImpl();
  return {
    platform,
    arch,
    normalizedArch: normalizeArch(arch),
    osRelease,
    isWsl: platform === 'linux' && isWslHost({ env, readFileSyncImpl }),
    isContainer: isContainerHost({ existsSyncImpl, readFileSyncImpl }),
    hasDisplay: hasDisplayEnvironment({ platform, env }),
    totalMemoryGb: formatMemoryGb(totalMemoryBytes),
    cpuCount: Array.isArray(cpus) ? cpus.length : 0,
    cpuFlags: detectCpuFlags({ platform, readFileSyncImpl, spawnSyncImpl, env }),
    pythonVersion: detectPythonVersion({ pythonExecutable, spawnSyncImpl, env }),
    gpus,
    vulkan: detectVulkan({ env, spawnSyncImpl }),
    hasDriRenderDevice: hasDriRenderDevice({ platform, existsSyncImpl }),
    docker: detectDockerRuntime({ env, spawnSyncImpl }),
    isaacSimCompatibilityChecker: detectOfficialIsaacSimCompatibilityChecker({
      env,
      platform,
      spawnSyncImpl,
      existsSyncImpl,
    }),
    hasCudaDriverLibrary: detectCudaDriverLibrary({
      platform,
      existsSyncImpl,
      spawnSyncImpl,
      env,
    }),
  };
}

function hasGpuVendor(host, vendor) {
  return host.gpus.some((gpu) => gpu.vendor === vendor);
}

function getNvidiaGpus(host) {
  return host.gpus.filter((gpu) => gpu.vendor === 'nvidia');
}

function maxGpuMemoryMb(host, vendor = null) {
  const memories = host.gpus
    .filter((gpu) => !vendor || gpu.vendor === vendor)
    .map((gpu) => gpu.memoryMb)
    .filter((memoryMb) => Number.isFinite(memoryMb) && memoryMb > 0);
  return memories.length > 0 ? Math.max(...memories) : null;
}

function hasRtxGpu(host) {
  return getNvidiaGpus(host).some((gpu) => /\brtx\b/i.test(gpu.name));
}

function bestNvidiaDriver(host) {
  const drivers = getNvidiaGpus(host)
    .map((gpu) => gpu.driverVersion)
    .filter(Boolean)
    .sort((left, right) => compareVersions(right, left));
  return drivers[0] || '';
}

function hasAppleGpu(host) {
  return hasGpuVendor(host, 'apple');
}

function hasAmdGpu(host) {
  return hasGpuVendor(host, 'amd');
}

function hasAnyGpu(host) {
  return host.gpus.length > 0;
}

function hasNvidiaCuda(host) {
  return hasGpuVendor(host, 'nvidia') && host.hasCudaDriverLibrary;
}

function hasNvidiaDocker(host) {
  return Boolean(
    host.platform === 'linux' &&
    hasGpuVendor(host, 'nvidia') &&
    host.docker?.daemonAvailable &&
    host.docker?.nvidiaRuntimeAvailable
  );
}

function dockerStatusLabel(host) {
  if (!host.docker?.installed) return 'docker unavailable';
  if (!host.docker.daemonAvailable) return 'docker daemon unavailable';
  if (hasGpuVendor(host, 'nvidia') && !host.docker.nvidiaRuntimeAvailable) {
    return 'docker ready, NVIDIA runtime missing';
  }
  if (host.docker.nvidiaRuntimeAvailable) return 'docker GPU ready';
  return 'docker ready';
}

function buildGenesisDeployment(host) {
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

function buildMujocoDeployment(host) {
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

function buildMjlabDeployment(host) {
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

function buildMjxDeployment(host) {
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

function buildPybulletDeployment(host) {
  return buildPythonDeployment({
    accelerator: 'cpu',
    profile: host.hasDisplay ? 'static-gui' : 'direct-headless',
    gpu: DEPLOYMENT_GPU.cpu,
    display: host.hasDisplay ? DEPLOYMENT_DISPLAY.desktop : DEPLOYMENT_DISPLAY.none,
    env: {},
    notes: ['PyBullet Python uses the Bullet CPU path for this workspace adapter.'],
  });
}

function buildBlenderDeployment(host) {
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

function buildSapienDeployment(host) {
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

function buildIsaacSimDeployment(host, reasons) {
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

function createTarget({
  id,
  setupMode = SETUP_MODES.managed,
  managedInstall = false,
  deployment = null,
  reasons = [],
  warnings = [],
}) {
  const compatible = reasons.length === 0;
  const defaultDeploymentMode =
    setupMode === SETUP_MODES.managed
      ? DEPLOYMENT_MODES.python
      : setupMode;
  return {
    id,
    label: TARGET_LABELS[id] || id,
    setupMode,
    compatible,
    managedInstall,
    installable: compatible && setupMode === SETUP_MODES.managed && managedInstall,
    deployment: deployment || {
      mode: defaultDeploymentMode,
      accelerator: 'cpu',
      profile: defaultDeploymentMode,
      gpu: DEPLOYMENT_GPU.cpu,
      display: DEPLOYMENT_DISPLAY.none,
      env: {},
      notes: [],
    },
    reasons,
    warnings,
  };
}

function requirePython(reasons, host, rangeText, range) {
  if (!host.pythonVersion) {
    reasons.push(`${rangeText} is required, but the setup Python could not be detected.`);
    return;
  }
  if (!pythonVersionSatisfies(host.pythonVersion, range)) {
    reasons.push(`${rangeText} is required; setup is using ${describePythonVersion(host.pythonVersion)}.`);
  }
}

function requireSupportedArch(reasons, host, allowed = ['x64', 'arm64']) {
  if (!allowed.includes(host.arch)) {
    reasons.push(`Unsupported CPU architecture ${host.normalizedArch}.`);
  }
}

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
    setupMode: SETUP_MODES.planned,
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
    setupMode: SETUP_MODES.planned,
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
    setupMode: SETUP_MODES.external,
    managedInstall: false,
    deployment: buildIsaacSimDeployment(host, reasons),
    reasons,
    warnings,
  });
}

function evaluateNewton(host) {
  return createTarget({
    id: 'newton',
    setupMode: SETUP_MODES.planned,
    managedInstall: false,
    deployment: buildPlannedDeployment({
      accelerator: hasNvidiaCuda(host) ? 'cuda-planned' : 'cpu-planned',
      profile: 'planned',
      notes: ['Newton deployment will be enabled when the workspace adapter exists.'],
    }),
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
    setupMode: SETUP_MODES.planned,
    managedInstall: false,
    deployment: buildPlannedDeployment({
      accelerator: hasNvidiaCuda(host) ? 'cuda-planned' : 'cuda-required',
      profile: 'planned-renderer',
      notes: ['RoboSplatter should use CUDA when the renderer adapter is implemented.'],
    }),
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
  if (target.setupMode === SETUP_MODES.external) return 'external install';
  if (target.setupMode === SETUP_MODES.planned) return 'adapter planned';
  return 'not installable';
}

function summarizeTarget(target) {
  if (target.installable) return target.label;
  if (target.setupMode === SETUP_MODES.external && target.compatible) {
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
  const notInstalled = allTargets.filter((target) => !target.installable);
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
      ? `Managed setup allowed: ${summary.managedReady.map((target) => target.label).join(', ')}`
      : 'Managed setup allowed: none'
  );
  if (summary.notInstalled.length > 0) {
    lines.push(`Not installed by setup: ${summary.notInstalled.map(summarizeTarget).join(', ')}`);
  }
  if (summary.deploymentTargets.length > 0) {
    lines.push(`Fast path: ${summary.deploymentTargets.map(summarizeDeploymentTarget).join(', ')}`);
  }
  if (summary.containerTargets.length > 0) {
    lines.push(`Container images: ${summary.containerTargets.map(summarizeContainerTarget).join(', ')}`);
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
