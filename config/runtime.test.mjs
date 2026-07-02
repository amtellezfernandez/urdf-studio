import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRuntimeUrls,
  resolveLocalNetworkHost,
  resolveRuntimeHost,
} from './runtime.js';

test('resolveLocalNetworkHost prefers physical LAN addresses over virtual adapters', () => {
  const host = resolveLocalNetworkHost({
    networkInterfaces: () => ({
      docker0: [{ family: 'IPv4', internal: false, address: '172.17.0.1' }],
      tailscale0: [{ family: 'IPv4', internal: false, address: '100.111.32.70' }],
      eth0: [{ family: 'IPv4', internal: false, address: '172.22.210.70' }],
    }),
  });

  assert.equal(host, '172.22.210.70');
});

test('resolveLocalNetworkHost falls back to loopback when only virtual adapters exist', () => {
  const host = resolveLocalNetworkHost({
    networkInterfaces: () => ({
      docker0: [{ family: 'IPv4', internal: false, address: '172.17.0.1' }],
      veth123: [{ family: 'IPv4', internal: false, address: '172.18.0.2' }],
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    }),
  });

  assert.equal(host, '127.0.0.1');
});

test('resolveRuntimeHost resolves auto web host values', () => {
  const host = resolveRuntimeHost('auto', {
    networkInterfaces: () => ({
      wlan0: [{ family: 'IPv4', internal: false, address: '192.168.1.44' }],
    }),
  });

  assert.equal(host, '192.168.1.44');
  assert.equal(resolveRuntimeHost('studio.local'), 'studio.local');
});

test('runtime URL builder keeps resolved host browser-facing', () => {
  assert.equal(
    buildRuntimeUrls({
      web: { host: '192.168.1.44', port: 5173 },
      api: { host: '127.0.0.1', port: 8000 },
      ikd: { host: '127.0.0.1', port: 8088 },
    }).webBaseUrl,
    'http://192.168.1.44:5173',
  );
});
