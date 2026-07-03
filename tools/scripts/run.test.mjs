import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldUseWslTeamSharingGateway } from './run.js';

const BASE_RUNTIME_CONFIG = {
  web: { host: '127.0.0.1', port: 5173, bindHost: '127.0.0.1' },
};

test('WSL local start upgrades loopback frontend to gated frontend mode', () => {
  assert.equal(
    shouldUseWslTeamSharingGateway({
      allowRemote: false,
      isWsl: true,
      runtimeConfig: BASE_RUNTIME_CONFIG,
      teamMode: false,
    }),
    true
  );
});

test('WSL gateway mode stays off for explicit remote or team sessions', () => {
  assert.equal(
    shouldUseWslTeamSharingGateway({
      allowRemote: true,
      isWsl: true,
      runtimeConfig: BASE_RUNTIME_CONFIG,
      teamMode: false,
    }),
    false
  );
  assert.equal(
    shouldUseWslTeamSharingGateway({
      allowRemote: false,
      isWsl: true,
      runtimeConfig: BASE_RUNTIME_CONFIG,
      teamMode: true,
    }),
    false
  );
  assert.equal(
    shouldUseWslTeamSharingGateway({
      allowRemote: false,
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
      isWsl: true,
      runtimeConfig: {
        web: { host: '172.22.210.70', port: 5173, bindHost: '0.0.0.0' },
      },
      teamMode: false,
    }),
    false
  );
});
