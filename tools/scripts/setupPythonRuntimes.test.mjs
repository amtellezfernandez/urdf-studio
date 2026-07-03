import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldInstallGenesisRuntime,
  shouldInstallMjlabRuntime,
  shouldInstallPybulletRuntime,
} from './setupPythonRuntimes.js';
import {
  buildSimulatorCompatibilityInstallResult,
  formatSimulatorInstallBlock,
} from './setupSimulatorInstallCompatibility.js';
import {
  GENESIS_FORCE_INSTALL_ENV,
  GENESIS_SKIP_AUTO_INSTALL_ENV,
  MJLAB_FORCE_INSTALL_ENV,
  MJLAB_SKIP_AUTO_INSTALL_ENV,
  PYBULLET_FORCE_INSTALL_ENV,
  PYBULLET_SKIP_AUTO_INSTALL_ENV,
} from './setupParams.js';

test('named simulator Python runtime install policy honors skip, force, and platform defaults', () => {
  assert.equal(
    shouldInstallPybulletRuntime({
      env: { [PYBULLET_SKIP_AUTO_INSTALL_ENV]: '1' },
      platform: 'linux',
    }),
    false
  );
  assert.equal(
    shouldInstallPybulletRuntime({
      env: { [PYBULLET_FORCE_INSTALL_ENV]: '1' },
      platform: 'darwin',
    }),
    true
  );
  assert.equal(shouldPybulletDarwinDefault(), false);
  assert.equal(shouldInstallGenesisRuntime({ env: {}, platform: 'win32' }), false);
  assert.equal(
    shouldInstallGenesisRuntime({
      env: { [GENESIS_FORCE_INSTALL_ENV]: '1' },
      platform: 'win32',
    }),
    true
  );
  assert.equal(
    shouldInstallMjlabRuntime({
      env: { [MJLAB_SKIP_AUTO_INSTALL_ENV]: '1' },
      platform: 'linux',
    }),
    false
  );
  assert.equal(
    shouldInstallMjlabRuntime({
      env: { [MJLAB_FORCE_INSTALL_ENV]: '1' },
      platform: 'win32',
    }),
    true
  );
});

test('simulator compatibility result distinguishes skipped and forced failures', () => {
  const target = {
    id: 'pybullet',
    label: 'PyBullet',
    reasons: ['No GUI display detected.'],
    setupMode: 'managed',
  };
  const skipped = buildSimulatorCompatibilityInstallResult({
    simulatorCompatibilityReport: { targets: { pybullet: target } },
    simulatorId: 'pybullet',
    setupName: 'PyBullet',
    forceInstallEnv: PYBULLET_FORCE_INSTALL_ENV,
    env: {},
    managedInstallAllowed: () => false,
    getCompatibilityTarget: () => target,
  });
  const forced = buildSimulatorCompatibilityInstallResult({
    simulatorCompatibilityReport: { targets: { pybullet: target } },
    simulatorId: 'pybullet',
    setupName: 'PyBullet',
    forceInstallEnv: PYBULLET_FORCE_INSTALL_ENV,
    env: { [PYBULLET_FORCE_INSTALL_ENV]: '1' },
    managedInstallAllowed: () => false,
    getCompatibilityTarget: () => target,
  });

  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, true);
  assert.equal(forced.ok, false);
  assert.equal(forced.fatal, true);
  assert.equal(formatSimulatorInstallBlock(target), 'No GUI display detected.');
  assert.match(
    formatSimulatorInstallBlock({ label: 'Isaac Sim', reasons: [], setupMode: 'external' }),
    /external runtime/
  );
});

function shouldPybulletDarwinDefault() {
  return shouldInstallPybulletRuntime({ env: {}, platform: 'darwin' });
}
