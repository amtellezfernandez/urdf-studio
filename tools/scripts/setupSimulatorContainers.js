import { spawnSync } from 'child_process';

import { managedBuildTargets } from './simulatorContainerBuild.js';
import { buildDockerBuildPlan, formatDockerRunCommand } from './simulatorDeployment.js';
import { isTruthyEnvValue } from './setupHelpers.js';
import { buildSetupResult, didSpawnSyncFail } from './setupCommandResults.js';
import {
  SIMULATOR_CONTAINER_FORCE_ENV,
  SIMULATOR_CONTAINER_INSTALL_ENV,
  SIMULATOR_CONTAINER_SKIP_ENV,
} from './setupParams.js';

export {
  SIMULATOR_CONTAINER_FORCE_ENV,
  SIMULATOR_CONTAINER_INSTALL_ENV,
  SIMULATOR_CONTAINER_SKIP_ENV,
};

export function simulatorContainerImageExists(
  image,
  {
    rootDir = process.cwd(),
    spawnSyncImpl = spawnSync,
  } = {}
) {
  if (!image) return false;
  const result = spawnSyncImpl('docker', ['image', 'inspect', image], {
    cwd: rootDir,
    encoding: 'utf-8',
    stdio: 'ignore',
  });
  return result.status === 0 && !result.error;
}

export function runSimulatorContainerBuildPlan(
  plan,
  {
    rootDir = process.cwd(),
    spawnSyncImpl = spawnSync,
  } = {}
) {
  return spawnSyncImpl(plan.command, plan.args, {
    cwd: rootDir,
    stdio: 'inherit',
  });
}

export async function installSimulatorContainers(
  simulatorCompatibilityReport = null,
  {
    env = process.env,
    rootDir = process.cwd(),
    spawnSyncImpl = spawnSync,
    imageExists = simulatorContainerImageExists,
    runBuildPlan = runSimulatorContainerBuildPlan,
    logArrow = () => {},
    logInfo = () => {},
    logSuccess = () => {},
    logWarning = () => {},
  } = {}
) {
  if (isTruthyEnvValue(env[SIMULATOR_CONTAINER_SKIP_ENV])) {
    return buildSetupResult({ installed: false, skipped: true, built: [], ready: [] });
  }
  const forced = isTruthyEnvValue(env[SIMULATOR_CONTAINER_FORCE_ENV]);
  if (!forced && !isTruthyEnvValue(env[SIMULATOR_CONTAINER_INSTALL_ENV])) {
    return buildSetupResult({ installed: false, skipped: true, built: [], ready: [] });
  }

  const targets = managedBuildTargets(simulatorCompatibilityReport || { targets: {} });
  if (targets.length === 0) {
    return buildSetupResult({ installed: false, skipped: true, built: [], ready: [] });
  }

  const built = [];
  const ready = [];
  let announced = false;
  for (const target of targets) {
    const image = target.deployment.container?.image || target.deployment.image;
    if (imageExists(image, { spawnSyncImpl, rootDir })) {
      ready.push(target.id);
      continue;
    }
    if (!announced) {
      logArrow('Preparing simulator container images');
      announced = true;
    }
    const plan = buildDockerBuildPlan(target.deployment, { progress: env.DOCKER_PROGRESS || null });
    logInfo(`Building ${target.label}: ${formatDockerRunCommand(plan)}`);
    const result = runBuildPlan(plan, { spawnSyncImpl, rootDir });
    if (didSpawnSyncFail(result)) {
      logWarning(
        forced
          ? `✗ Failed to build ${target.label} container image`
          : `Skipping ${target.label} container image`
      );
      logInfo(`Image: ${image}`);
      if (!forced) {
        logInfo(`Continuing without this container image. Set ${SIMULATOR_CONTAINER_FORCE_ENV}=1 to require it during setup.`);
      }
      return buildSetupResult({
        ok: !forced,
        changed: built.length > 0,
        installed: false,
        skipped: !forced,
        fatal: forced,
        built,
        ready,
        failed: target.id,
      });
    }
    built.push(target.id);
    ready.push(target.id);
  }

  if (built.length > 0) {
    logSuccess(`Simulator container images ready: ${ready.join(', ')}`);
  }
  return buildSetupResult({
    changed: built.length > 0,
    installed: true,
    skipped: false,
    built,
    ready,
  });
}
