import {
  didSetupStepChange,
  isSetupStepReady,
  shouldFailSetupForRuntimeResult,
} from './setupCommandResults.js';

export async function runSetupSequence(defaultSteps = {}, overrides = {}) {
  const steps = {
    ...defaultSteps,
    ...overrides,
  };

  const setupResults = [];
  const recordResult = (result) => {
    setupResults.push(result);
    return result;
  };

  const dependenciesReady = recordResult(await steps.installDependencies());
  if (!isSetupStepReady(dependenciesReady)) {
    throw new Error('Node dependency installation failed');
  }
  const iluRuntimeReady = recordResult(await steps.verifyIluRuntimeContract());
  if (!isSetupStepReady(iluRuntimeReady)) {
    throw new Error('i-love-urdf runtime setup failed');
  }
  const pythonBackendEnvironmentReady = recordResult(await steps.setupPythonBackendEnvironment());
  if (!isSetupStepReady(pythonBackendEnvironmentReady)) {
    throw new Error('Unified Python environment setup failed');
  }
  const simulatorCompatibilityReady = recordResult(await steps.checkSimulatorCompatibility());
  if (!isSetupStepReady(simulatorCompatibilityReady)) {
    throw new Error('Simulator compatibility check failed');
  }
  const simulatorCompatibilityReport = simulatorCompatibilityReady?.report || null;
  const backendDepsInstalled = recordResult(await steps.installBackendDeps(simulatorCompatibilityReport));
  if (!isSetupStepReady(backendDepsInstalled)) {
    throw new Error('Backend dependencies installation failed');
  }
  const genesisRuntimeResult = recordResult(await steps.installGenesisRuntime(simulatorCompatibilityReport));
  if (shouldFailSetupForRuntimeResult(genesisRuntimeResult)) {
    throw new Error('Genesis workspace adapter runtime installation failed');
  }
  const mjlabRuntimeResult = recordResult(await steps.installMjlabRuntime(simulatorCompatibilityReport));
  if (shouldFailSetupForRuntimeResult(mjlabRuntimeResult)) {
    throw new Error('MJLab validation runtime installation failed');
  }
  const pybulletRuntimeResult = recordResult(await steps.installPybulletRuntime(simulatorCompatibilityReport));
  if (shouldFailSetupForRuntimeResult(pybulletRuntimeResult)) {
    throw new Error('PyBullet workspace adapter runtime installation failed');
  }
  const blenderRuntimeResult = recordResult(await steps.installBlenderRuntime(simulatorCompatibilityReport));
  if (shouldFailSetupForRuntimeResult(blenderRuntimeResult)) {
    throw new Error('Blender workspace runtime installation failed');
  }
  const simulatorContainerResult = recordResult(await steps.installSimulatorContainers(simulatorCompatibilityReport));
  if (shouldFailSetupForRuntimeResult(simulatorContainerResult)) {
    throw new Error('Simulator container image setup failed');
  }
  recordResult(await steps.installTwinDepsIfRequested());
  const ikdResult = recordResult(await steps.checkIkd());
  if (!isSetupStepReady(ikdResult)) {
    throw new Error('Native IKD toolchain setup failed');
  }
  recordResult(await steps.setupHuggingFace());
  recordResult(await steps.setupGitHub());
  const globalIluResult = recordResult(await steps.installOptionalGlobalIlu());
  return {
    changed: setupResults.some(didSetupStepChange),
    globalIluResult,
    genesisRuntimeResult,
    mjlabRuntimeResult,
    pybulletRuntimeResult,
    blenderRuntimeResult,
    simulatorContainerResult,
  };
}
