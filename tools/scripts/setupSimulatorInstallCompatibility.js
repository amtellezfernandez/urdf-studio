import {
  getSimulatorCompatibilityTarget,
  isManagedSimulatorInstallAllowed,
} from './simulatorCompatibility.js';
import { isTruthyEnvValue } from './setupHelpers.js';
import { buildSetupResult } from './setupCommandResults.js';

export function formatSimulatorInstallBlock(target) {
  if (!target) {
    return 'No compatibility result was available for this simulator.';
  }
  if (target.reasons.length > 0) {
    return target.reasons.join(' ');
  }
  if (target.setupMode === 'external') {
    return `${target.label} is an external runtime and is not installed by URDF Studio setup.`;
  }
  if (target.setupMode === 'planned') {
    return `${target.label} setup is planned but not available in this release.`;
  }
  return `${target.label} is not installable by setup on this machine.`;
}

export function buildSimulatorCompatibilityInstallResult({
  simulatorCompatibilityReport,
  simulatorId,
  setupName,
  forceInstallEnv,
  env = process.env,
  managedInstallAllowed = isManagedSimulatorInstallAllowed,
  getCompatibilityTarget = getSimulatorCompatibilityTarget,
  logWarning = () => {},
  logInfo = () => {},
}) {
  if (!simulatorCompatibilityReport || managedInstallAllowed(simulatorCompatibilityReport, simulatorId)) {
    return null;
  }

  const target = getCompatibilityTarget(simulatorCompatibilityReport, simulatorId);
  const reason = formatSimulatorInstallBlock(target);
  const forced = isTruthyEnvValue(env[forceInstallEnv]);
  logWarning(forced ? `✗ ${setupName} is not compatible with this machine` : `Skipping ${setupName}`);
  logInfo(reason);
  if (!forced) {
    logInfo(`Set ${forceInstallEnv}=1 only after fixing compatibility.`);
  }
  return buildSetupResult({
    ok: !forced,
    installed: false,
    skipped: !forced,
    fatal: forced,
    compatibility: target,
    reason,
  });
}
