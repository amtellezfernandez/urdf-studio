#!/usr/bin/env node

import { resolve } from 'path';

import {
  buildDockerRunPlan,
  formatDockerRunCommand,
} from './simulatorDeployment.js';
import {
  compatibleContainerTargets,
  parseContainerCliArgs,
  printContainerTargetList,
  readOptionValue,
  resolveContainerTarget,
  resolveContainerTargets,
  runCliMain,
  validateContainerTargetSelection,
} from './simulatorContainerCliHelpers.js';
import {
  getSimulatorCompatibilityReport,
} from './simulatorCompatibility.js';

const CONTAINER_PLAN_MESSAGES = {
  empty: 'No simulator container fast path is compatible with this machine.',
};

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
  parseContainerCliArgs(args, options, {
    '--workspace': (_options, parsedArgs, index, arg) => {
      options.workspaceDir = resolve(readOptionValue(parsedArgs, index, arg));
      return 1;
    },
    '--project-root': (_options, parsedArgs, index, arg) => {
      options.projectRoot = resolve(readOptionValue(parsedArgs, index, arg));
      return 1;
    },
    '--name': (_options, parsedArgs, index, arg) => {
      options.name = readOptionValue(parsedArgs, index, arg);
      return 1;
    },
    '--network': (_options, parsedArgs, index, arg) => {
      options.network = readOptionValue(parsedArgs, index, arg);
      return 1;
    },
    '--detach': () => {
      options.detach = true;
    },
    '--interactive': () => {
      options.interactive = true;
    },
    '--no-rm': () => {
      options.remove = false;
    },
    '--no-display': () => {
      options.enableDesktopDisplay = false;
    },
  });
  validateContainerTargetSelection(options, { allowNamedAll: false });
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
  return compatibleContainerTargets(report);
}

function printContainerTargets(report) {
  printContainerTargetList(report, {
    title: 'Container-ready simulator targets:',
    emptyMessage: CONTAINER_PLAN_MESSAGES.empty,
  });
}

export function resolveTarget(report, simulatorId) {
  return resolveContainerTarget(report, simulatorId);
}

export function resolvePlanTargets(report, { all = false, simulatorId = null } = {}) {
  return resolveContainerTargets(report, { all, simulatorId });
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
    console.log(CONTAINER_PLAN_MESSAGES.empty);
    return;
  }
  console.log(targets
    .map((target) => formatDockerRunCommand(buildTargetRunPlan(target, options)))
    .join('\n'));
}

runCliMain(import.meta.url, main);
