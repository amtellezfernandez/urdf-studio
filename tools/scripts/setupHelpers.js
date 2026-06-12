import {
  OPENARM_HARDWARE_PIP_DEPENDENCIES,
} from './openArmHardwareParams.js';
import {
  GITHUB_CLI_LOGIN_COMMAND,
  GLOBAL_ILU_INSTALL_COMMAND,
  GLOBAL_ILU_INSTALL_ENV,
  GLOBAL_ILU_INSTALL_FLAG,
  LOCAL_ILU_COMMAND,
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
        'URDF Ops sibling workspace',
        'Unified Python backend/training runtime',
        'LeRobot training runtime',
        'OpenArm hardware runtime',
        'Simulator runtimes: Genesis, PyBullet, and MJLab',
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
  const mjlabLines = buildSimulatorRuntimeLines({
    result: mjlabRuntimeResult,
    skippedLine: 'MJLab install was skipped for this run.',
    installedLine: 'MJLab validation runtime is available.',
    unavailableLine: 'MJLab runtime is unavailable.',
    fallbackLine:
      'MJLab installs into the unified Python runtime for teleop motion validation when supported.',
  });
  const pybulletLines = buildSimulatorRuntimeLines({
    result: pybulletRuntimeResult,
    skippedLine: 'PyBullet install was skipped for this run.',
    installedLine: 'PyBullet workspace adapter runtime is available.',
    unavailableLine: 'PyBullet workspace adapter runtime is unavailable.',
    fallbackLine: 'PyBullet installs into the unified Python runtime for direct URDF world viewing.',
  });

  return [
    {
      heading: 'Run',
      lines: ['Start URDF Studio: npm run start'],
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
      heading: 'OpenArm Hardware',
      lines: [
        `Installed into the unified Python runtime: ${OPENARM_HARDWARE_PIP_DEPENDENCIES.join(', ')}.`,
        'Check CAN, Feetech, and OpenArm Mini imports with npm run openarm:doctor.',
      ],
    },
    {
      heading: 'Genesis',
      lines: genesisLines,
    },
    {
      heading: 'PyBullet',
      lines: pybulletLines,
    },
    {
      heading: 'MJLab',
      lines: mjlabLines,
    },
  ];
}
