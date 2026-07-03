import os from 'os';
import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';

import {
  WSL_D3D12_DRI_DRIVER_PATH,
  WSL_D3D12_LIBRARY_DIR,
  WSL_DXG_DEVICE_PATH,
} from './simulatorCompatibilityParams.js';
import { detectOfficialIsaacSimCompatibilityChecker } from './simulatorIsaacSimChecker.js';
import {
  asString,
  runCommand,
  safeRead,
} from './simulatorHostProbeUtils.js';

const GB = 1024 ** 3;

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

function hasWslD3d12OpenGl({ platform, existsSyncImpl }) {
  return (
    platform === 'linux' &&
    existsSyncImpl(WSL_DXG_DEVICE_PATH) &&
    existsSyncImpl(WSL_D3D12_DRI_DRIVER_PATH) &&
    existsSyncImpl(WSL_D3D12_LIBRARY_DIR)
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
    hasWslD3d12OpenGl: hasWslD3d12OpenGl({ platform, existsSyncImpl }),
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
