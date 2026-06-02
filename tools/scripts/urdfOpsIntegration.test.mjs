import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  applyUrdfOpsEnv,
  buildUrdfOpsRuntime,
  resolveUrdfOpsRoot,
} from './urdfOpsIntegration.js';

const URDF_OPS_INTEGRATION_TEST_FIXTURE = {
  studioRoot: '/workspace/urdf-studio',
  customOpsRoot: '/custom/urdf-ops',
  customWebPort: '6180',
  customApiPort: '6181',
};

test('resolves the default sibling URDF Ops checkout', () => {
  assert.equal(
    resolveUrdfOpsRoot(URDF_OPS_INTEGRATION_TEST_FIXTURE.studioRoot, {}),
    resolve('/workspace/urdf-ops'),
  );
});

test('honors explicit URDF Ops root and ports', () => {
  const runtime = buildUrdfOpsRuntime({
    studioRootDir: URDF_OPS_INTEGRATION_TEST_FIXTURE.studioRoot,
    env: {
      URDF_OPS_ROOT: URDF_OPS_INTEGRATION_TEST_FIXTURE.customOpsRoot,
      URDF_OPS_WEB_PORT: URDF_OPS_INTEGRATION_TEST_FIXTURE.customWebPort,
      URDF_OPS_API_PORT: URDF_OPS_INTEGRATION_TEST_FIXTURE.customApiPort,
    },
  });

  assert.equal(runtime.root, URDF_OPS_INTEGRATION_TEST_FIXTURE.customOpsRoot);
  assert.equal(
    runtime.webBaseUrl,
    `http://127.0.0.1:${URDF_OPS_INTEGRATION_TEST_FIXTURE.customWebPort}`,
  );
  assert.equal(
    runtime.apiBaseUrl,
    `http://127.0.0.1:${URDF_OPS_INTEGRATION_TEST_FIXTURE.customApiPort}`,
  );
  assert.equal(
    runtime.healthUrl,
    `http://127.0.0.1:${URDF_OPS_INTEGRATION_TEST_FIXTURE.customApiPort}/health`,
  );
});

test('injects synchronized Studio and Ops URL environment', () => {
  const runtime = buildUrdfOpsRuntime({
    studioRootDir: URDF_OPS_INTEGRATION_TEST_FIXTURE.studioRoot,
    env: {},
  });
  const env = applyUrdfOpsEnv({ EXISTING: '1' }, runtime);

  assert.equal(env.EXISTING, '1');
  assert.equal(env.URDF_OPS_ROOT, runtime.root);
  assert.equal(env.URDF_OPS_WEB_URL, runtime.webBaseUrl);
  assert.equal(env.VITE_URDF_OPS_WEB_URL, runtime.webBaseUrl);
  assert.equal(env.URDF_OPS_BACKEND_URL, runtime.apiBaseUrl);
  assert.equal(env.URDF_OPS_API_BASE_URL, runtime.apiBaseUrl);
});
