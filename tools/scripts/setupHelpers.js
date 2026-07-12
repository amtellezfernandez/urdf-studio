import {
  BLENDER_FORCE_INSTALL_ENV,
  GENESIS_FORCE_INSTALL_ENV,
  GITHUB_CLI_LOGIN_COMMAND,
  GLOBAL_ILU_INSTALL_COMMAND,
  GLOBAL_ILU_INSTALL_ENV,
  GLOBAL_ILU_INSTALL_FLAG,
  LOCAL_SIMULATORS_INSTALL_COMMAND,
  LOCAL_SIMULATORS_INSTALL_FLAG,
  LOCAL_ILU_COMMAND,
  PYBULLET_FORCE_INSTALL_ENV,
  SIMULATOR_CONTAINER_INSTALL_COMMAND,
  SIMULATOR_CONTAINER_INSTALL_ENV,
  SIMULATOR_CONTAINER_INSTALL_FLAG,
} from './setupParams.js';

const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes']);

export function isTruthyEnvValue(value) {
  const normalizedValue = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return TRUTHY_ENV_VALUES.has(normalizedValue);
}

export function shouldInstallGlobalIlu({
  args = process.argv.slice(2),
  env = process.env,
} = {}) {
  return args.includes(GLOBAL_ILU_INSTALL_FLAG) || isTruthyEnvValue(env[GLOBAL_ILU_INSTALL_ENV]);
}

export function applySetupProfileFlags({
  args = process.argv.slice(2),
  env = process.env,
} = {}) {
  const localSimulators = args.includes(LOCAL_SIMULATORS_INSTALL_FLAG);
  const simulatorContainers = args.includes(SIMULATOR_CONTAINER_INSTALL_FLAG);

  if (localSimulators) {
    env[BLENDER_FORCE_INSTALL_ENV] = '1';
    env[GENESIS_FORCE_INSTALL_ENV] = '1';
    env[PYBULLET_FORCE_INSTALL_ENV] = '1';
  }
  if (simulatorContainers) {
    env[SIMULATOR_CONTAINER_INSTALL_ENV] = '1';
  }

  return {
    localSimulators,
    simulatorContainers,
  };
}

function normalizePythonDistributionName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[-_.]+/g, '-');
}

export function selectInstalledSupersededPythonDependencies({
  supersededDependencies = [],
  installedPackageNames = [],
} = {}) {
  const installedNames = new Set(installedPackageNames.map(normalizePythonDistributionName));
  return supersededDependencies.filter((dependency) =>
    installedNames.has(normalizePythonDistributionName(dependency))
  );
}

export function buildSetupRoadmapSections() {
  return [
    {
      heading: 'Setup steps',
      lines: [
        'Node dependencies',
        'Unified Python backend runtime',
        'Simulator compatibility preflight',
        'Backend Python packages for URDF Studio services',
        'Default managed extras: MJLab when compatible',
        `Local simulator extras: ${LOCAL_SIMULATORS_INSTALL_COMMAND} installs Blender, Genesis, and PyBullet`,
        `Container simulator images: ${SIMULATOR_CONTAINER_INSTALL_COMMAND} builds Docker images only when needed`,
        'Hugging Face and GitHub access',
      ],
    },
  ];
}

function buildSimulatorRuntimeLines({
  result,
  skippedLine,
  installedLine,
  unavailableLine,
  fallbackLine,
}) {
  if (result?.skipped) {
    return [skippedLine];
  }
  if (result?.installed) {
    return [installedLine];
  }
  if (result?.ok === false) {
    return [
      result.fatal === false
        ? `${unavailableLine} Setup continued because this adapter is optional.`
        : unavailableLine,
    ];
  }
  return [fallbackLine];
}

export function buildSetupSummarySections({
  globalIluAttempted = false,
  globalIluInstalled = false,
  genesisRuntimeResult = null,
  mjlabRuntimeResult = null,
  pybulletRuntimeResult = null,
  blenderRuntimeResult = null,
  simulatorContainerResult = null,
} = {}) {
  const iluLines = [`Local i-love-urdf CLI: ${LOCAL_ILU_COMMAND}`];

  if (globalIluInstalled) {
    iluLines.push('Global ilu CLI installed successfully.');
  } else if (globalIluAttempted) {
    iluLines.push(`Global ilu install did not complete. Local ${LOCAL_ILU_COMMAND} still works.`);
  }

  const genesisLines = buildSimulatorRuntimeLines({
    result: genesisRuntimeResult,
    skippedLine: 'Genesis viewer runtime was skipped for this run.',
    installedLine: 'Genesis viewer runtime is available.',
    unavailableLine: 'Genesis viewer runtime is unavailable.',
    fallbackLine: 'Genesis viewer installs into the unified Python runtime when supported.',
  });
  const pybulletLines = buildSimulatorRuntimeLines({
    result: pybulletRuntimeResult,
    skippedLine: 'PyBullet install was skipped for this run.',
    installedLine: 'PyBullet workspace adapter runtime is available.',
    unavailableLine: 'PyBullet workspace adapter runtime is unavailable.',
    fallbackLine: 'PyBullet installs into the unified Python runtime for direct URDF world viewing.',
  });
  const mjlabLines = buildSimulatorRuntimeLines({
    result: mjlabRuntimeResult,
    skippedLine: 'MJLab install was skipped for this run.',
    installedLine: 'MJLab validation runtime is available.',
    unavailableLine: 'MJLab validation runtime is unavailable.',
    fallbackLine: 'MJLab installs into the unified Python runtime when this machine is compatible.',
  });
  const blenderLines = buildSimulatorRuntimeLines({
    result: blenderRuntimeResult,
    skippedLine: 'Blender install was skipped for this run.',
    installedLine: 'Blender workspace runtime is available.',
    unavailableLine: 'Blender workspace runtime is unavailable.',
    fallbackLine: 'Blender installs as a managed local runtime when supported.',
  });
  const simulatorContainerLines = buildSimulatorRuntimeLines({
    result: simulatorContainerResult,
    skippedLine: `Simulator container image setup was skipped. This is optional and can build large Docker images; leave it off on laptops unless you need containerized simulators.`,
    installedLine: 'Compatible simulator container images are ready.',
    unavailableLine: 'Simulator container image setup is unavailable.',
    fallbackLine: `Simulator container images are optional and can build large Docker images. Use ${SIMULATOR_CONTAINER_INSTALL_COMMAND} only when Docker is ready and you need containerized simulators.`,
  });

  return [
    {
      heading: 'Run',
      lines: ['Start URDF Studio: npm run start'],
    },
    {
      heading: 'Installed By Setup',
      lines: [
        'Node app dependencies in node_modules',
        'Unified Python runtime in .venv',
        'Backend Python packages used by URDF Studio services',
        'MJLab when this machine is compatible',
      ],
    },
    {
      heading: 'Optional Extras',
      lines: [
        `${LOCAL_SIMULATORS_INSTALL_COMMAND} installs local simulator extras: Blender, Genesis, and PyBullet.`,
        `${SIMULATOR_CONTAINER_INSTALL_COMMAND} builds Docker simulator images. This can be large and is separate from normal laptop setup.`,
      ],
    },
    {
      heading: 'i-love-urdf CLI',
      lines: iluLines,
    },
    {
      heading: 'GitHub Access',
      lines: [
        `Recommended: ${GITHUB_CLI_LOGIN_COMMAND}`,
        'URDF Studio can reuse gh auth, GH_TOKEN, or GITHUB_TOKEN without saving a local token.',
      ],
    },
    {
      heading: 'Genesis',
      lines: genesisLines,
    },
    {
      heading: 'MJLab',
      lines: mjlabLines,
    },
    {
      heading: 'PyBullet',
      lines: pybulletLines,
    },
    {
      heading: 'Blender',
      lines: blenderLines,
    },
    {
      heading: 'Containers',
      lines: simulatorContainerLines,
    },
  ];
}
