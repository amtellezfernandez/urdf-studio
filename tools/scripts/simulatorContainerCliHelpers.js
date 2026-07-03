import { DEPLOYMENT_MODES } from './simulatorDeployment.js';
import { getSimulatorCompatibilityTarget } from './simulatorCompatibility.js';

export { readOptionValue, runCliMain } from './cliHelpers.js';

export function validateContainerTargetSelection(
  { all = false, simulatorId = null, name = null } = {},
  { allowNamedAll = true } = {}
) {
  if (all && simulatorId) {
    throw new Error('Use either --all or one simulator id, not both.');
  }
  if (!allowNamedAll && all && name) {
    throw new Error('Use one simulator id when setting a container name.');
  }
}

export function parseContainerCliArgs(args, options, optionHandlers = {}) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const optionHandler = optionHandlers[arg];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (optionHandler) {
      index += optionHandler(options, args, index, arg) || 0;
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
  return options;
}

export function containerImage(target) {
  return target.deployment.container?.image || target.deployment.image;
}

export function compatibleContainerTargets(report, { requireManagedBuild = false } = {}) {
  return Object.values(report.targets).filter(
    (target) =>
      target.compatible &&
      target.deployment?.mode === DEPLOYMENT_MODES.container &&
      (!requireManagedBuild || target.deployment.container?.build)
  );
}

export function printContainerTargetList(
  report,
  {
    title,
    emptyMessage,
    requireManagedBuild = false,
  }
) {
  const targets = compatibleContainerTargets(report, { requireManagedBuild });
  if (targets.length === 0) {
    console.log(emptyMessage);
    return;
  }
  console.log(title);
  for (const target of targets) {
    console.log(
      `  ${target.id}: ${target.label} ${target.deployment.accelerator} ${containerImage(target)}`
    );
  }
}

export function resolveContainerTarget(
  report,
  simulatorId,
  { requireManagedBuild = false } = {}
) {
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
  if (requireManagedBuild && !target.deployment.container?.build) {
    throw new Error(`${target.label} uses an external container image and has no managed build recipe.`);
  }
  return target;
}

export function resolveContainerTargets(
  report,
  { all = false, simulatorId = null } = {},
  { requireManagedBuild = false } = {}
) {
  if (all) {
    return compatibleContainerTargets(report, { requireManagedBuild });
  }
  if (simulatorId) {
    return [resolveContainerTarget(report, simulatorId, { requireManagedBuild })];
  }
  return [];
}
