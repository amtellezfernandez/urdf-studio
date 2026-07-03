import {
  DEPLOYMENT_DISPLAY,
  DEPLOYMENT_GPU,
  DEPLOYMENT_MODES,
} from './simulatorDeployment.js';
import {
  SIMULATOR_SETUP_MODES,
  SIMULATOR_TARGET_LABELS,
} from './simulatorCompatibilityParams.js';
import { compareVersions } from './simulatorVersion.js';

export function pythonVersionSatisfies(pythonVersion, { min = null, maxExclusive = null } = {}) {
  if (!pythonVersion) return false;
  const version = `${pythonVersion.major}.${pythonVersion.minor}.${pythonVersion.patch || 0}`;
  if (min && compareVersions(version, min) < 0) return false;
  if (maxExclusive && compareVersions(version, maxExclusive) >= 0) return false;
  return true;
}

export function describePythonVersion(pythonVersion) {
  if (!pythonVersion) return 'unknown Python';
  return `Python ${pythonVersion.major}.${pythonVersion.minor}`;
}

export function createTarget({
  id,
  setupMode = SIMULATOR_SETUP_MODES.managed,
  managedInstall = false,
  deployment = null,
  reasons = [],
  warnings = [],
}) {
  const compatible = reasons.length === 0;
  const defaultDeploymentMode =
    setupMode === SIMULATOR_SETUP_MODES.managed
      ? DEPLOYMENT_MODES.python
      : setupMode;
  return {
    id,
    label: SIMULATOR_TARGET_LABELS[id] || id,
    setupMode,
    compatible,
    managedInstall,
    installable: compatible && setupMode === SIMULATOR_SETUP_MODES.managed && managedInstall,
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

export function requirePython(reasons, host, rangeText, range) {
  if (!host.pythonVersion) {
    reasons.push(`${rangeText} is required, but the setup Python could not be detected.`);
    return;
  }
  if (!pythonVersionSatisfies(host.pythonVersion, range)) {
    reasons.push(`${rangeText} is required; setup is using ${describePythonVersion(host.pythonVersion)}.`);
  }
}

export function requireSupportedArch(reasons, host, allowed = ['x64', 'arm64']) {
  if (!allowed.includes(host.arch)) {
    reasons.push(`Unsupported CPU architecture ${host.normalizedArch}.`);
  }
}
