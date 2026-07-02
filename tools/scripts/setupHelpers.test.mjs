import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSetupRoadmapSections,
  buildSetupSummarySections,
  isTruthyEnvValue,
  selectInstalledSupersededPythonDependencies,
  shouldInstallGlobalIlu,
} from './setupHelpers.js';
import {
  GITHUB_CLI_LOGIN_COMMAND,
  GLOBAL_ILU_INSTALL_ENV,
  GLOBAL_ILU_INSTALL_FLAG,
  LOCAL_ILU_COMMAND,
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
    blenderRuntimeResult: {
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
    heading: 'i-love-urdf CLI',
    lines: [
      `Local i-love-urdf CLI: ${LOCAL_ILU_COMMAND}`,
      `Global ilu install did not complete. Local ${LOCAL_ILU_COMMAND} still works.`,
    ],
  });
  assert.deepEqual(sections[2], {
    heading: 'GitHub Access',
    lines: [
      `Recommended: ${GITHUB_CLI_LOGIN_COMMAND}`,
      'URDF Studio can reuse gh auth, GH_TOKEN, or GITHUB_TOKEN without saving a local token.',
    ],
  });
  assert.deepEqual(sections[3], {
    heading: 'Genesis',
    lines: ['Genesis viewer runtime is unavailable. Setup continued because this adapter is optional.'],
  });
  assert.deepEqual(sections[4], {
    heading: 'PyBullet',
    lines: ['PyBullet workspace adapter runtime is available.'],
  });
  assert.deepEqual(sections[5], {
    heading: 'Blender',
    lines: ['Blender workspace runtime is available.'],
  });
});

test('buildSetupRoadmapSections reports setup steps without override labels', () => {
  const sections = buildSetupRoadmapSections();

  assert.equal(sections[0].heading, 'Setup steps');
  assert.ok(sections[0].lines.includes('Unified Python backend runtime'));
  assert.ok(sections[0].lines.includes('Simulator compatibility preflight'));
  assert.ok(sections[0].lines.includes('Managed simulator runtimes supported by this machine'));
  assert.equal(sections.length, 1);
});
