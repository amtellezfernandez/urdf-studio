#!/usr/bin/env node

import { spawnSync } from 'child_process';

import {
  buildDockerBuildPlan,
  formatDockerRunCommand,
} from './simulatorDeployment.js';
import {
  compatibleContainerTargets,
  containerImage,
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

const MANAGED_BUILD_MESSAGES = {
  empty: 'No compatible managed simulator container builds are available on this machine.',
};

export function parseArgs(args) {
  const options = {
    simulatorId: null,
    all: false,
    printOnly: false,
    pull: true,
    noCache: false,
    platform: null,
    progress: null,
    help: false,
  };
  parseContainerCliArgs(args, options, {
    '--print': () => {
      options.printOnly = true;
    },
    '--no-pull': () => {
      options.pull = false;
    },
    '--no-cache': () => {
      options.noCache = true;
    },
    '--platform': (_options, parsedArgs, index, arg) => {
      options.platform = readOptionValue(parsedArgs, index, arg);
      return 1;
    },
    '--progress': (_options, parsedArgs, index, arg) => {
      options.progress = readOptionValue(parsedArgs, index, arg);
      return 1;
    },
  });
  validateContainerTargetSelection(options);
  return options;
}

function printUsage() {
  console.log('Usage: npm run simulator:container:build -- <simulator-id|all> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --all                Build every compatible managed simulator container');
  console.log('  --print              Print the Docker build command without running it');
  console.log('  --no-pull            Do not pass --pull to docker build');
  console.log('  --no-cache           Pass --no-cache to docker build');
  console.log('  --platform <value>   Pass a Docker build platform');
  console.log('  --progress <value>   Pass Docker build progress mode');
}

export function managedBuildTargets(report) {
  return compatibleContainerTargets(report, { requireManagedBuild: true });
}

function printManagedBuildTargets(report) {
  printContainerTargetList(report, {
    title: 'Managed simulator container builds:',
    emptyMessage: MANAGED_BUILD_MESSAGES.empty,
    requireManagedBuild: true,
  });
}

export function resolveTarget(report, simulatorId) {
  return resolveContainerTarget(report, simulatorId, { requireManagedBuild: true });
}

export function resolveBuildTargets(report, { all = false, simulatorId = null } = {}) {
  return resolveContainerTargets(report, { all, simulatorId }, { requireManagedBuild: true });
}

function buildPlan(target, options) {
  return buildDockerBuildPlan(target.deployment, {
    pull: options.pull,
    noCache: options.noCache,
    platform: options.platform,
    progress: options.progress,
  });
}

function runBuildPlan(plan) {
  const result = spawnSync(plan.command, plan.args, {
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = getSimulatorCompatibilityReport();
  if (options.help) {
    printUsage();
    console.log('');
    printManagedBuildTargets(report);
    return;
  }
  if (!options.simulatorId && !options.all) {
    printManagedBuildTargets(report);
    console.log('');
    printUsage();
    return;
  }

  const targets = resolveBuildTargets(report, options);
  if (targets.length === 0) {
    console.log(MANAGED_BUILD_MESSAGES.empty);
    return;
  }
  const plans = targets.map((target) => [target, buildPlan(target, options)]);
  if (options.printOnly) {
    console.log(plans.map(([, plan]) => formatDockerRunCommand(plan)).join('\n'));
    return;
  }

  let exitCode = 0;
  for (const [target, plan] of plans) {
    console.log(`Building ${target.label}: ${containerImage(target)}`);
    const status = runBuildPlan(plan);
    if (status !== 0) {
      exitCode = status;
      break;
    }
  }
  process.exitCode = exitCode;
}

runCliMain(import.meta.url, main);
