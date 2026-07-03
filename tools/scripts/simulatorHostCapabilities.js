import { compareVersions } from './simulatorVersion.js';

export function hasGpuVendor(host, vendor) {
  return host.gpus.some((gpu) => gpu.vendor === vendor);
}

export function getNvidiaGpus(host) {
  return host.gpus.filter((gpu) => gpu.vendor === 'nvidia');
}

export function maxGpuMemoryMb(host, vendor = null) {
  const memories = host.gpus
    .filter((gpu) => !vendor || gpu.vendor === vendor)
    .map((gpu) => gpu.memoryMb)
    .filter((memoryMb) => Number.isFinite(memoryMb) && memoryMb > 0);
  return memories.length > 0 ? Math.max(...memories) : null;
}

export function hasRtxGpu(host) {
  return getNvidiaGpus(host).some((gpu) => /\brtx\b/i.test(gpu.name));
}

export function bestNvidiaDriver(host) {
  const drivers = getNvidiaGpus(host)
    .map((gpu) => gpu.driverVersion)
    .filter(Boolean)
    .sort((left, right) => compareVersions(right, left));
  return drivers[0] || '';
}

export function hasAppleGpu(host) {
  return hasGpuVendor(host, 'apple');
}

export function hasAmdGpu(host) {
  return hasGpuVendor(host, 'amd');
}

export function hasAnyGpu(host) {
  return host.gpus.length > 0;
}

export function hasNvidiaCuda(host) {
  return hasGpuVendor(host, 'nvidia') && host.hasCudaDriverLibrary;
}

export function hasNvidiaDocker(host) {
  return Boolean(
    host.platform === 'linux' &&
    hasGpuVendor(host, 'nvidia') &&
    host.docker?.daemonAvailable &&
    host.docker?.nvidiaRuntimeAvailable
  );
}

export function dockerStatusLabel(host) {
  if (!host.docker?.installed) return 'docker unavailable';
  if (!host.docker.daemonAvailable) return 'docker daemon unavailable';
  if (hasGpuVendor(host, 'nvidia') && !host.docker.nvidiaRuntimeAvailable) {
    return 'docker ready, NVIDIA runtime missing';
  }
  if (host.docker.nvidiaRuntimeAvailable) return 'docker GPU ready';
  return 'docker ready';
}
