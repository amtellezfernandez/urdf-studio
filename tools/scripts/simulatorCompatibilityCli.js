#!/usr/bin/env node

import { readOptionValue, runCliMain } from './cliHelpers.js';
import {
  DEPLOYMENT_MODES,
  summarizeDeployment,
} from './simulatorDeployment.js';
import {
  SIMULATOR_COMPATIBILITY_IDS,
  formatSimulatorCompatibilitySummary,
  getSimulatorCompatibilityReport,
  getSimulatorCompatibilityTarget,
} from './simulatorCompatibility.js';

export function parseSimulatorCompatibilityCliArgs(args) {
  const options = {
    help: false,
    json: false,
    targetId: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--target') {
      options.targetId = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.targetId) {
      options.targetId = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return options;
}

export function formatSimulatorCompatibilityCliUsage() {
  return [
    'Usage: npm run simulator:compatibility -- [simulator-id] [options]',
    '',
    'Options:',
    '  --target <id>  Show one simulator target',
    '  --json         Print the raw compatibility report as JSON',
    '  --help         Show this help',
  ];
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

function formatHostGpu(host) {
  if (!host?.gpus?.length) return 'none';
  return host.gpus
    .map((gpu) => {
      const memoryGb = gpu.memoryMb ? ` ${Math.round(gpu.memoryMb / 1024)}GB` : '';
      return `${gpu.vendor}:${gpu.name}${memoryGb}`;
    })
    .join('; ');
}

function formatDockerStatus(host) {
  if (!host?.docker?.installed) return 'unavailable';
  if (!host.docker.daemonAvailable) return 'daemon-unavailable';
  if (host.docker.nvidiaRuntimeAvailable) return 'gpu-ready';
  return 'ready';
}

function formatHostLine(host) {
  return [
    `Host: ${host.platform} ${host.normalizedArch}`,
    host.isWsl ? 'wsl=yes' : 'wsl=no',
    `display=${yesNo(host.hasDisplay)}`,
    `cuda-driver=${yesNo(host.hasCudaDriverLibrary)}`,
    `docker=${formatDockerStatus(host)}`,
    `gpu=${formatHostGpu(host)}`,
  ].join(' · ');
}

function formatTargetState(target) {
  if (target.installable) return 'managed';
  if (target.compatible && target.deployment?.mode === DEPLOYMENT_MODES.container) return 'container';
  if (target.compatible && target.setupMode === 'external') return 'external';
  if (target.setupMode === 'planned') return 'planned';
  return 'blocked';
}

function formatTargetLine(target) {
  const deployment = target.deployment || {};
  return [
    `${target.id}: ${target.label}`,
    `state=${formatTargetState(target)}`,
    `deployment=${summarizeDeployment(deployment)}`,
    `gpu=${deployment.gpu || 'unknown'}`,
    `display=${deployment.display || 'unknown'}`,
  ].join(' · ');
}

function formatTargetDetails(target) {
  const lines = [`  ${formatTargetLine(target)}`];
  if (target.reasons.length > 0) {
    lines.push(`    reason: ${target.reasons[0]}`);
  }
  if (target.warnings.length > 0) {
    lines.push(`    warning: ${target.warnings[0]}`);
  }
  if (target.deployment?.mode === DEPLOYMENT_MODES.container) {
    lines.push(`    container: ${target.deployment.container?.image || target.deployment.image}`);
    lines.push(`    plan: npm run simulator:container:plan -- ${target.id} --workspace <workspace-dir>`);
  }
  const envEntries = Object.entries(target.deployment?.env || {});
  if (envEntries.length > 0) {
    lines.push(`    env: ${envEntries.map(([key, value]) => `${key}=${value}`).join(' ')}`);
  }
  return lines;
}

export function formatSimulatorCompatibilityCliReport(report, { targetId = null } = {}) {
  const lines = ['Simulator compatibility', formatHostLine(report.host), ''];
  lines.push(...formatSimulatorCompatibilitySummary(report));
  lines.push('');
  lines.push('Targets:');

  const targetIds = targetId ? [targetId] : SIMULATOR_COMPATIBILITY_IDS;
  for (const id of targetIds) {
    const target = getSimulatorCompatibilityTarget(report, id);
    if (!target) {
      throw new Error(`Unknown simulator target: ${id}`);
    }
    lines.push(...formatTargetDetails(target));
  }
  return lines;
}

function main() {
  const options = parseSimulatorCompatibilityCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(formatSimulatorCompatibilityCliUsage().join('\n'));
    return;
  }

  const report = getSimulatorCompatibilityReport();
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(formatSimulatorCompatibilityCliReport(report, { targetId: options.targetId }).join('\n'));
}

runCliMain(import.meta.url, main);
