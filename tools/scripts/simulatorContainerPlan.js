#!/usr/bin/env node

import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  DEPLOYMENT_MODES,
  buildDockerRunPlan,
  formatDockerRunCommand,
} from './simulatorDeployment.js';
import {
  getSimulatorCompatibilityReport,
  getSimulatorCompatibilityTarget,
} from './simulatorCompatibility.js';

function readOptionValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function parseArgs(args) {
  const options = {
    simulatorId: null,
    all: false,
    workspaceDir: null,
    projectRoot: null,
    name: null,
    network: null,
    detach: false,
    interactive: false,
    remove: true,
    enableDesktopDisplay: true,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '--workspace') {
      options.workspaceDir = resolve(readOptionValue(args, index, arg));
      index += 1;
    } else if (arg === '--project-root') {
      options.projectRoot = resolve(readOptionValue(args, index, arg));
      index += 1;
    } else if (arg === '--name') {
      options.name = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === '--network') {
      options.network = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === '--detach') {
      options.detach = true;
    } else if (arg === '--interactive') {
      options.interactive = true;
    } else if (arg === '--no-rm') {
      options.remove = false;
    } else if (arg === '--no-display') {
      options.enableDesktopDisplay = false;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (arg === 'all' && !options.simulatorId) {
      options.all = true;
    } else if (!options.simulatorId) {
      options.simulatorId = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (options.all && options.simulatorId) {
    throw new Error('Use either --all or one simulator id, not both.');
  }
  if (options.all && options.name) {
    throw new Error('Use one simulator id when setting a container name.');
  }
  return options;
}

function printUsage() {
  console.log('Usage: npm run simulator:container:plan -- <simulator-id|all> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --all                  Print Docker run commands for every compatible container target');
  console.log('  --workspace <path>     Mount a prepared simulator workspace at /workspace');
  console.log('  --project-root <path>  Mount this source tree read-only at /workspace/urdf-studio');
  console.log('  --name <name>          Set the Docker container name');
  console.log('  --network <mode>       Override the deployment network mode');
  console.log('  --detach              Add --detach');
  console.log('  --interactive         Add --interactive --tty');
  console.log('  --no-rm               Keep the container after exit');
  console.log('  --no-display          Do not mount local desktop display sockets');
}

export function containerTargets(report) {
  return Object.values(report.targets)
    .filter((target) => target.compatible && target.deployment?.mode === DEPLOYMENT_MODES.container);
}

function printContainerTargets(report) {
  const targets = containerTargets(report);
  if (targets.length === 0) {
    console.log('No simulator container fast path is compatible with this machine.');
    return;
  }
  console.log('Container-ready simulator targets:');
  for (const target of targets) {
    const image = target.deployment.container?.image || target.deployment.image;
    console.log(`  ${target.id}: ${target.label} ${target.deployment.accelerator} ${image}`);
  }
}

export function resolveTarget(report, simulatorId) {
  const target = getSimulatorCompatibilityTarget(report, simulatorId);
  if (!target) {
    throw new Error(`Unknown simulator target: ${simulatorId}`);
  }
  if (!target.compatible) {
    throw new Error(`${target.label} is not compatible on this machine: ${target.reasons.join(' ')}`);
  }
  if (target.deployment?.mode !== DEPLOYMENT_MODES.container) {
    throw new Error(
      `${target.label} uses ${target.deployment?.mode}/${target.deployment?.accelerator} on this machine, not Docker.`
    );
  }
  return target;
}

export function resolvePlanTargets(report, { all = false, simulatorId = null } = {}) {
  if (all) {
    return containerTargets(report);
  }
  if (simulatorId) {
    return [resolveTarget(report, simulatorId)];
  }
  return [];
}

export function buildTargetRunPlan(target, options = {}) {
  return buildDockerRunPlan(target.deployment, {
    name: options.name,
    detach: options.detach,
    interactive: options.interactive,
    remove: options.remove,
    workspaceDir: options.workspaceDir,
    projectRoot: options.projectRoot,
    network: options.network,
    enableDesktopDisplay: options.enableDesktopDisplay,
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = getSimulatorCompatibilityReport();
  if (options.help) {
    printUsage();
    console.log('');
    printContainerTargets(report);
    return;
  }
  if (!options.simulatorId && !options.all) {
    printContainerTargets(report);
    console.log('');
    printUsage();
    return;
  }

  const targets = resolvePlanTargets(report, options);
  if (targets.length === 0) {
    console.log('No simulator container fast path is compatible with this machine.');
    return;
  }
  console.log(targets
    .map((target) => formatDockerRunCommand(buildTargetRunPlan(target, options)))
    .join('\n'));
}

function isMainModule() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href);
}

if (isMainModule()) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
