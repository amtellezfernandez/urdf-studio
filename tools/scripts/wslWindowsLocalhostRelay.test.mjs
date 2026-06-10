import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWslWindowsLocalhostRelayScript,
  ensureWslWindowsLocalhostAccess,
  parseWindowsProcessId,
  resolveWslWindowsLocalhostRelayTargetHost,
} from './wslWindowsLocalhostRelay.js';

const REMOTE_BIND_RUNTIME_CONFIG = {
  web: {
    bindHost: '0.0.0.0',
    host: '172.22.210.70',
    port: 5173,
  },
};

test('WSL localhost access check skips non-WSL machines', () => {
  const result = ensureWslWindowsLocalhostAccess({
    runtimeConfig: REMOTE_BIND_RUNTIME_CONFIG,
    isWslEnvironmentImpl: () => false,
  });

  assert.deepEqual(result, { status: 'not-wsl' });
});

test('WSL localhost access check skips loopback-only binds', () => {
  const result = ensureWslWindowsLocalhostAccess({
    runtimeConfig: {
      web: {
        bindHost: '127.0.0.1',
        host: '127.0.0.1',
        port: 5173,
      },
    },
    isWslEnvironmentImpl: () => true,
  });

  assert.deepEqual(result, {
    status: 'skipped-loopback-bind',
    localUrl: 'http://127.0.0.1:5173',
  });
});

test('WSL localhost access check leaves working Windows localhost untouched', () => {
  const result = ensureWslWindowsLocalhostAccess({
    runtimeConfig: REMOTE_BIND_RUNTIME_CONFIG,
    isWslEnvironmentImpl: () => true,
    windowsCanFetchUrlImpl: (url) => url === 'http://127.0.0.1:5173',
  });

  assert.deepEqual(result, {
    status: 'already-working',
    localUrl: 'http://127.0.0.1:5173',
  });
});

test('WSL localhost access check targets detected WSL address for gated local starts', () => {
  const calls = [];
  let localWorks = false;
  const result = ensureWslWindowsLocalhostAccess({
    runtimeConfig: {
      web: {
        bindHost: '0.0.0.0',
        host: '127.0.0.1',
        port: 5173,
      },
    },
    networkInterfaces: () => ({
      docker0: [{ family: 'IPv4', internal: false, address: '172.17.0.1' }],
      eth0: [{ family: 'IPv4', internal: false, address: '172.22.210.70' }],
    }),
    isWslEnvironmentImpl: () => true,
    windowsCanFetchUrlImpl: (url) => {
      calls.push(['fetch', url]);
      if (url === 'http://127.0.0.1:5173') return localWorks;
      return url === 'http://172.22.210.70:5173';
    },
    stopStaleWslRelayListenersImpl: () => [],
    isWindowsLocalPortFreeImpl: () => true,
    startWindowsLocalhostRelayImpl: ({ listenPort, targetHost, targetPort }) => {
      calls.push(['start-relay', listenPort, targetHost, targetPort]);
      localWorks = true;
      return 44072;
    },
  });

  assert.equal(
    resolveWslWindowsLocalhostRelayTargetHost({
      runtimeConfig: {
        web: {
          bindHost: '0.0.0.0',
          host: '127.0.0.1',
          port: 5173,
        },
      },
      networkInterfaces: () => ({
        docker0: [{ family: 'IPv4', internal: false, address: '172.17.0.1' }],
        eth0: [{ family: 'IPv4', internal: false, address: '172.22.210.70' }],
      }),
    }),
    '172.22.210.70'
  );
  assert.deepEqual(result, {
    status: 'relay-started',
    killedStaleRelayPids: [],
    localUrl: 'http://127.0.0.1:5173',
    targetUrl: 'http://172.22.210.70:5173',
    pid: 44072,
  });
  assert.deepEqual(calls, [
    ['fetch', 'http://127.0.0.1:5173'],
    ['fetch', 'http://172.22.210.70:5173'],
    ['start-relay', 5173, '172.22.210.70', 5173],
    ['fetch', 'http://127.0.0.1:5173'],
  ]);
});

test('WSL localhost access check replaces stale wslrelay with a loopback relay', () => {
  const calls = [];
  let localWorks = false;
  const result = ensureWslWindowsLocalhostAccess({
    runtimeConfig: REMOTE_BIND_RUNTIME_CONFIG,
    isWslEnvironmentImpl: () => true,
    windowsCanFetchUrlImpl: (url) => {
      calls.push(['fetch', url]);
      if (url === 'http://127.0.0.1:5173') return localWorks;
      return url === 'http://172.22.210.70:5173';
    },
    stopStaleWslRelayListenersImpl: (port) => {
      calls.push(['stop-stale', port]);
      return [16984];
    },
    isWindowsLocalPortFreeImpl: (port) => {
      calls.push(['port-free', port]);
      return true;
    },
    startWindowsLocalhostRelayImpl: ({ listenPort, targetHost, targetPort }) => {
      calls.push(['start-relay', listenPort, targetHost, targetPort]);
      localWorks = true;
      return 44072;
    },
  });

  assert.deepEqual(result, {
    status: 'relay-started',
    killedStaleRelayPids: [16984],
    localUrl: 'http://127.0.0.1:5173',
    targetUrl: 'http://172.22.210.70:5173',
    pid: 44072,
  });
  assert.deepEqual(calls, [
    ['fetch', 'http://127.0.0.1:5173'],
    ['fetch', 'http://172.22.210.70:5173'],
    ['stop-stale', 5173],
    ['fetch', 'http://127.0.0.1:5173'],
    ['port-free', 5173],
    ['start-relay', 5173, '172.22.210.70', 5173],
    ['fetch', 'http://127.0.0.1:5173'],
  ]);
});

test('WSL localhost access check does not replace non-wslrelay listeners', () => {
  const result = ensureWslWindowsLocalhostAccess({
    runtimeConfig: REMOTE_BIND_RUNTIME_CONFIG,
    isWslEnvironmentImpl: () => true,
    windowsCanFetchUrlImpl: (url) => url === 'http://172.22.210.70:5173',
    stopStaleWslRelayListenersImpl: () => [],
    isWindowsLocalPortFreeImpl: () => false,
  });

  assert.equal(result.status, 'blocked-by-windows-listener');
  assert.equal(result.localUrl, 'http://127.0.0.1:5173');
  assert.equal(result.targetUrl, 'http://172.22.210.70:5173');
});

test('Windows relay script stays compatible with older PowerShell C# compiler', () => {
  const script = buildWslWindowsLocalhostRelayScript({
    listenPort: 5173,
    targetHost: '172.22.210.70',
    targetPort: 5173,
  });

  assert.match(script, /TcpListener/);
  assert.match(script, /string\.Format/);
  assert.doesNotMatch(script, /\$"/);
});

test('Windows process id parser reads PowerShell process output', () => {
  assert.equal(parseWindowsProcessId('\r\n44072\r\n'), 44072);
  assert.equal(parseWindowsProcessId('no pid'), null);
});
