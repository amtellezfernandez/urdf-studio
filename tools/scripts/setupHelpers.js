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
        'MJLab validation runtime',
        'Hugging Face and GitHub access',
      ],
    },
  ];
}

export function buildSetupSummarySections({
  globalIluAttempted = false,
  globalIluInstalled = false,
  mjlabRuntimeResult = null,
} = {}) {
  const iluLines = [`Local i-love-urdf CLI: ${LOCAL_ILU_COMMAND}`];

  if (globalIluInstalled) {
    iluLines.push('Global ilu CLI installed successfully.');
  } else if (globalIluAttempted) {
    iluLines.push(`Global ilu install did not complete. Local ${LOCAL_ILU_COMMAND} still works.`);
  }

  const mjlabLines = [];
  if (mjlabRuntimeResult?.skipped) {
    mjlabLines.push('MJLab install was skipped for this run.');
  } else if (mjlabRuntimeResult?.installed) {
    mjlabLines.push('MJLab validation runtime is available.');
  } else if (mjlabRuntimeResult?.ok === false) {
    mjlabLines.push('MJLab runtime is unavailable.');
  } else {
    mjlabLines.push('Installed into the unified .venv-lerobot Python runtime for teleop motion validation.');
  }

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
      heading: 'MJLab',
      lines: mjlabLines,
    },
  ];
}
