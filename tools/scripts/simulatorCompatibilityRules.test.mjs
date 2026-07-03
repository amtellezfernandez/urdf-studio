import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTarget,
  describePythonVersion,
  pythonVersionSatisfies,
  requirePython,
  requireSupportedArch,
} from './simulatorCompatibilityRules.js';

function host(overrides = {}) {
  return {
    arch: 'x64',
    normalizedArch: 'x86_64',
    pythonVersion: { major: 3, minor: 12, patch: 11, executable: '/repo/.venv/bin/python3' },
    ...overrides,
  };
}

test('Python range helpers accept inclusive minimum and exclusive maximum bounds', () => {
  assert.equal(pythonVersionSatisfies({ major: 3, minor: 10, patch: 0 }, { min: '3.10' }), true);
  assert.equal(
    pythonVersionSatisfies({ major: 3, minor: 9, patch: 18 }, { min: '3.10' }),
    false
  );
  assert.equal(
    pythonVersionSatisfies(
      { major: 3, minor: 12, patch: 11 },
      { min: '3.10', maxExclusive: '3.13' }
    ),
    true
  );
  assert.equal(
    pythonVersionSatisfies(
      { major: 3, minor: 13, patch: 0 },
      { min: '3.10', maxExclusive: '3.13' }
    ),
    false
  );
  assert.equal(describePythonVersion(null), 'unknown Python');
});

test('target creation computes compatibility and default deployment consistently', () => {
  const readyTarget = createTarget({
    id: 'pybullet',
    managedInstall: true,
  });
  const blockedTarget = createTarget({
    id: 'isaacsim',
    setupMode: 'external',
    reasons: ['native workstation required'],
  });

  assert.equal(readyTarget.label, 'PyBullet');
  assert.equal(readyTarget.compatible, true);
  assert.equal(readyTarget.installable, true);
  assert.equal(readyTarget.deployment.mode, 'python');
  assert.equal(readyTarget.deployment.gpu, 'cpu');
  assert.equal(blockedTarget.compatible, false);
  assert.equal(blockedTarget.installable, false);
  assert.equal(blockedTarget.deployment.mode, 'external');
});

test('generic requirement helpers append actionable reasons without throwing', () => {
  const reasons = [];

  requirePython(reasons, host({ pythonVersion: null }), 'Python >=3.10', { min: '3.10' });
  requirePython(
    reasons,
    host({ pythonVersion: { major: 3, minor: 9, patch: 18, executable: 'python3' } }),
    'Python >=3.10',
    { min: '3.10' }
  );
  requireSupportedArch(reasons, host({ arch: 'ppc64', normalizedArch: 'ppc64le' }));

  assert.deepEqual(reasons, [
    'Python >=3.10 is required, but the setup Python could not be detected.',
    'Python >=3.10 is required; setup is using Python 3.9.',
    'Unsupported CPU architecture ppc64le.',
  ]);
});
