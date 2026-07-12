import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applySetupProfileFlags,
  buildSetupRoadmapSections,
  buildSetupSummarySections,
  isTruthyEnvValue,
  selectInstalledSupersededPythonDependencies,
  shouldInstallGlobalIlu,
} from './setupHelpers.js';
import {
  BLENDER_FORCE_INSTALL_ENV,
  GENESIS_FORCE_INSTALL_ENV,
  GITHUB_CLI_LOGIN_COMMAND,
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

test('isTruthyEnvValue recognizes supported truthy values', () => {
  assert.equal(isTruthyEnvValue('1'), true);
  assert.equal(isTruthyEnvValue(' true '), true);
  assert.equal(isTruthyEnvValue('YES'), true);
  assert.equal(isTruthyEnvValue('0'), false);
  assert.equal(isTruthyEnvValue('no'), false);
});

test('shouldInstallGlobalIlu accepts setup flag', () => {
  assert.equal(shouldInstallGlobalIlu({ args: [GLOBAL_ILU_INSTALL_FLAG], env: {} }), true);
});

test('shouldInstallGlobalIlu accepts truthy env', () => {
  assert.equal(
    shouldInstallGlobalIlu({
      args: [],
      env: { [GLOBAL_ILU_INSTALL_ENV]: 'yes' },
    }),
    true
  );
});

test('applySetupProfileFlags maps public setup flags to runtime install env', () => {
  const env = {};

  const result = applySetupProfileFlags({
    args: [LOCAL_SIMULATORS_INSTALL_FLAG, SIMULATOR_CONTAINER_INSTALL_FLAG],
    env,
  });

  assert.deepEqual(result, {
    localSimulators: true,
    simulatorContainers: true,
  });
  assert.equal(env[BLENDER_FORCE_INSTALL_ENV], '1');
  assert.equal(env[GENESIS_FORCE_INSTALL_ENV], '1');
  assert.equal(env[PYBULLET_FORCE_INSTALL_ENV], '1');
  assert.equal(env[SIMULATOR_CONTAINER_INSTALL_ENV], '1');
});

test('selectInstalledSupersededPythonDependencies only returns superseded packages present in the environment', () => {
  assert.deepEqual(
    selectInstalledSupersededPythonDependencies({
      supersededDependencies: ['libcoal', 'libpinocchio', 'lib.pinocchio', 'libmissing'],
      installedPackageNames: ['LIBCOAL', 'pinocchio', 'lib_pinocchio', 'pytest'],
    }),
    ['libcoal', 'lib.pinocchio']
  );
});

test('buildSetupSummarySections reports local and global ilu usage', () => {
  const sections = buildSetupSummarySections({
    globalIluAttempted: true,
    globalIluInstalled: false,
    genesisRuntimeResult: {
      ok: false,
      installed: false,
      skipped: false,
      fatal: false,
    },
    pybulletRuntimeResult: {
      ok: true,
      installed: true,
      skipped: false,
    },
    mjlabRuntimeResult: {
      ok: true,
      installed: true,
      skipped: false,
    },
    blenderRuntimeResult: {
      ok: true,
      installed: true,
      skipped: false,
    },
    simulatorContainerResult: {
      ok: true,
      installed: true,
      skipped: false,
    },
  });

  assert.deepEqual(sections[0], {
    heading: 'Run',
    lines: ['Start URDF Studio: npm run start'],
  });
  assert.deepEqual(sections[1], {
    heading: 'Installed By Setup',
    lines: [
      'Node app dependencies in node_modules',
      'Unified Python runtime in .venv',
      'Backend Python packages used by URDF Studio services',
      'MJLab when this machine is compatible',
    ],
  });
  assert.deepEqual(sections[2], {
    heading: 'Optional Extras',
    lines: [
      `${LOCAL_SIMULATORS_INSTALL_COMMAND} installs local simulator extras: Blender, Genesis, and PyBullet.`,
      `${SIMULATOR_CONTAINER_INSTALL_COMMAND} builds Docker simulator images. This can be large and is separate from normal laptop setup.`,
    ],
  });
  assert.deepEqual(sections[3], {
    heading: 'i-love-urdf CLI',
    lines: [
      `Local i-love-urdf CLI: ${LOCAL_ILU_COMMAND}`,
      `Global ilu install did not complete. Local ${LOCAL_ILU_COMMAND} still works.`,
    ],
  });
  assert.deepEqual(sections[4], {
    heading: 'GitHub Access',
    lines: [
      `Recommended: ${GITHUB_CLI_LOGIN_COMMAND}`,
      'URDF Studio can reuse gh auth, GH_TOKEN, or GITHUB_TOKEN without saving a local token.',
    ],
  });
  assert.deepEqual(sections[5], {
    heading: 'Genesis',
    lines: ['Genesis viewer runtime is unavailable. Setup continued because this adapter is optional.'],
  });
  assert.deepEqual(sections[6], {
    heading: 'MJLab',
    lines: ['MJLab validation runtime is available.'],
  });
  assert.deepEqual(sections[7], {
    heading: 'PyBullet',
    lines: ['PyBullet workspace adapter runtime is available.'],
  });
  assert.deepEqual(sections[8], {
    heading: 'Blender',
    lines: ['Blender workspace runtime is available.'],
  });
  assert.deepEqual(sections[9], {
    heading: 'Containers',
    lines: ['Compatible simulator container images are ready.'],
  });
});

test('buildSetupRoadmapSections reports setup steps without override labels', () => {
  const sections = buildSetupRoadmapSections();

  assert.equal(sections[0].heading, 'Setup steps');
  assert.ok(sections[0].lines.includes('Unified Python backend runtime'));
  assert.ok(sections[0].lines.includes('Simulator compatibility preflight'));
  assert.ok(sections[0].lines.includes('Backend Python packages for URDF Studio services'));
  assert.ok(sections[0].lines.includes('Default managed extras: MJLab when compatible'));
  assert.ok(sections[0].lines.includes(`Local simulator extras: ${LOCAL_SIMULATORS_INSTALL_COMMAND} installs Blender, Genesis, and PyBullet`));
  assert.ok(sections[0].lines.includes(`Container simulator images: ${SIMULATOR_CONTAINER_INSTALL_COMMAND} builds Docker images only when needed`));
  assert.equal(sections.length, 1);
});
