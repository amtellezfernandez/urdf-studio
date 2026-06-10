import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldStartUrdfOps, shouldUseWslTeamSharingGateway } from './run.js';

const BASE_RUNTIME_CONFIG = {
  web: { host: '127.0.0.1', port: 5173, bindHost: '127.0.0.1' },
};

test('WSL local start upgrades loopback frontend to gated frontend mode', () => {
  assert.equal(
    shouldUseWslTeamSharingGateway({
      allowRemote: false,
      dataMode: false,
      isWsl: true,
      runtimeConfig: BASE_RUNTIME_CONFIG,
      teamMode: false,
    }),
    true
  );
});

test('URDF Ops start can be skipped with documented or legacy env names', () => {
  assert.equal(shouldStartUrdfOps({}), true);
  assert.equal(shouldStartUrdfOps({ URDF_STUDIO_SKIP_URDF_OPS_START: '1' }), false);
  assert.equal(shouldStartUrdfOps({ URDF_OPS_SKIP_START: 'true' }), false);
});

test('WSL gateway mode stays off for explicit remote, data, or team sessions', () => {
  assert.equal(
    shouldUseWslTeamSharingGateway({
      allowRemote: true,
      dataMode: false,
      isWsl: true,
      runtimeConfig: BASE_RUNTIME_CONFIG,
      teamMode: false,
    }),
    false
  );
  assert.equal(
    shouldUseWslTeamSharingGateway({
      allowRemote: false,
      dataMode: true,
      isWsl: true,
      runtimeConfig: BASE_RUNTIME_CONFIG,
      teamMode: false,
    }),
    false
  );
  assert.equal(
    shouldUseWslTeamSharingGateway({
      allowRemote: false,
      dataMode: false,
      isWsl: true,
      runtimeConfig: BASE_RUNTIME_CONFIG,
      teamMode: true,
    }),
    false
  );
  assert.equal(
    shouldUseWslTeamSharingGateway({
      allowRemote: false,
      dataMode: false,
      isWsl: false,
      runtimeConfig: BASE_RUNTIME_CONFIG,
      teamMode: false,
    }),
    false
  );
});

test('WSL gateway mode does not override explicit non-loopback binds', () => {
  assert.equal(
    shouldUseWslTeamSharingGateway({
      allowRemote: false,
      dataMode: false,
      isWsl: true,
      runtimeConfig: {
        web: { host: '172.22.210.70', port: 5173, bindHost: '0.0.0.0' },
      },
      teamMode: false,
    }),
    false
  );
});
