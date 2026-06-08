import test from 'node:test';
import assert from 'node:assert/strict';

import {
  API_PROXY_PREFIX,
  DEV_SERVER_PROXY_HEADERS,
  GITHUB_DEV_PROXY_ENABLE_ENV,
  GITHUB_DEV_PROXY_PREFIX,
  attachDevProxyClientHeaders,
  buildDevServerProxy,
  resolveDevProxyClientHost,
  shouldBlockGitHubDevProxyRequest,
  shouldEnableGitHubDevProxy,
} from './devServerProxy.js';

const DEV_SERVER_PROXY_TEST_FIXTURE = {
  apiBaseUrl: 'http://127.0.0.1:8000',
  runtimeUrls: { apiBaseUrl: 'http://127.0.0.1:8000' },
};

function runtimeConfigWithWebBind(bindHost) {
  return { web: { bindHost } };
}

test('dev server GitHub relay stays enabled for loopback development', () => {
  const proxy = buildDevServerProxy({
    runtimeConfig: runtimeConfigWithWebBind('127.0.0.1'),
    runtimeUrls: DEV_SERVER_PROXY_TEST_FIXTURE.runtimeUrls,
    env: {},
  });

  assert.equal(proxy[API_PROXY_PREFIX].target, DEV_SERVER_PROXY_TEST_FIXTURE.apiBaseUrl);
  assert.equal(proxy[GITHUB_DEV_PROXY_PREFIX].target, 'https://api.github.com');
});

test('dev server GitHub relay is disabled for remote team binds by default', () => {
  const proxy = buildDevServerProxy({
    runtimeConfig: runtimeConfigWithWebBind('0.0.0.0'),
    runtimeUrls: DEV_SERVER_PROXY_TEST_FIXTURE.runtimeUrls,
    env: {},
  });

  assert.equal(proxy[API_PROXY_PREFIX].target, DEV_SERVER_PROXY_TEST_FIXTURE.apiBaseUrl);
  assert.equal(Object.hasOwn(proxy, GITHUB_DEV_PROXY_PREFIX), false);
});

test('dev server GitHub relay requires explicit opt-in on remote binds', () => {
  assert.equal(
    shouldEnableGitHubDevProxy(runtimeConfigWithWebBind('0.0.0.0'), {
      [GITHUB_DEV_PROXY_ENABLE_ENV]: '1',
    }),
    true
  );
});

test('api dev proxy overwrites the original browser host header', () => {
  let proxyReqHandler = null;
  const proxy = {
    on(eventName, handler) {
      if (eventName === 'proxyReq') {
        proxyReqHandler = handler;
      }
    },
  };
  const proxyRequest = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };

  attachDevProxyClientHeaders(proxy);
  proxyReqHandler(proxyRequest, {
    socket: {
      remoteAddress: '192.0.2.44',
    },
    headers: {
      [DEV_SERVER_PROXY_HEADERS.clientHost]: '127.0.0.1',
    },
  });

  assert.equal(
    proxyRequest.headers[DEV_SERVER_PROXY_HEADERS.clientHost],
    '192.0.2.44'
  );
});

test('api dev proxy keeps LAN clients remote for network binds', () => {
  assert.equal(
    resolveDevProxyClientHost('192.0.2.44', {
      runtimeConfig: runtimeConfigWithWebBind('0.0.0.0'),
      trustedOwnerRemoteAddresses: new Set(['172.22.210.1']),
    }),
    '192.0.2.44'
  );
});

test('api dev proxy resolves the WSL owner gateway to local owner', () => {
  assert.equal(
    resolveDevProxyClientHost('::ffff:172.22.210.1', {
      runtimeConfig: runtimeConfigWithWebBind('0.0.0.0'),
      trustedOwnerRemoteAddresses: new Set(['172.22.210.1']),
    }),
    '127.0.0.1'
  );
});

test('api dev proxy treats private localhost-proxy clients as local only on loopback binds', () => {
  assert.equal(
    resolveDevProxyClientHost('172.22.210.44', {
      runtimeConfig: runtimeConfigWithWebBind('127.0.0.1'),
      trustedOwnerRemoteAddresses: new Set(),
    }),
    '127.0.0.1'
  );
  assert.equal(
    resolveDevProxyClientHost('172.22.210.44', {
      runtimeConfig: runtimeConfigWithWebBind('0.0.0.0'),
      trustedOwnerRemoteAddresses: new Set(),
    }),
    '172.22.210.44'
  );
});

test('disabled remote GitHub relay paths are blocked before app-shell fallback', () => {
  assert.equal(
    shouldBlockGitHubDevProxyRequest('/__github_api/rate_limit', {
      runtimeConfig: runtimeConfigWithWebBind('0.0.0.0'),
      env: {},
    }),
    true
  );
  assert.equal(
    shouldBlockGitHubDevProxyRequest('/__github_api/rate_limit', {
      runtimeConfig: runtimeConfigWithWebBind('127.0.0.1'),
      env: {},
    }),
    false
  );
});
