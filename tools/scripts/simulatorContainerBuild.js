#!/usr/bin/env node

import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';

import {
  DEPLOYMENT_MODES,
  buildDockerBuildPlan,
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
    printOnly: false,
    pull: true,
    noCache: false,
    platform: null,
    progress: null,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '--print') {
      options.printOnly = true;
    } else if (arg === '--no-pull') {
      options.pull = false;
    } else if (arg === '--no-cache') {
      options.noCache = true;
    } else if (arg === '--platform') {
      options.platform = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === '--progress') {
      options.progress = readOptionValue(args, index, arg);
      index += 1;
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
  return Object.values(report.targets)
    .filter(
      (target) =>
        target.compatible &&
        target.deployment?.mode === DEPLOYMENT_MODES.container &&
        target.deployment.container?.build
    );
}

function printManagedBuildTargets(report) {
  const targets = managedBuildTargets(report);
  if (targets.length === 0) {
    console.log('No compatible managed simulator container builds are available on this machine.');
    return;
  }
  console.log('Managed simulator container builds:');
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
  if (!target.deployment.container?.build) {
    throw new Error(`${target.label} uses an external container image and has no managed build recipe.`);
  }
  return target;
}

export function resolveBuildTargets(report, { all = false, simulatorId = null } = {}) {
  if (all) {
    return managedBuildTargets(report);
  }
  if (simulatorId) {
    return [resolveTarget(report, simulatorId)];
  }
  return [];
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
    console.log('No compatible managed simulator container builds are available on this machine.');
    return;
  }
  const plans = targets.map((target) => [target, buildPlan(target, options)]);
  if (options.printOnly) {
    console.log(plans.map(([, plan]) => formatDockerRunCommand(plan)).join('\n'));
    return;
  }

  let exitCode = 0;
  for (const [target, plan] of plans) {
    const image = target.deployment.container?.image || target.deployment.image;
    console.log(`Building ${target.label}: ${image}`);
    const status = runBuildPlan(plan);
    if (status !== 0) {
      exitCode = status;
      break;
    }
  }
  process.exitCode = exitCode;
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
