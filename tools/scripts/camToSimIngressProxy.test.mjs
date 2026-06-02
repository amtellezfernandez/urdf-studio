import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  getCamToSimIngressRule,
  hasSessionQueryToken,
  startCamToSimIngressProxy,
} from './camToSimIngressProxy.js';
import {
  CAM_TO_SIM_PROXY_MAX_FRAME_BODY_BYTES,
  CAM_TO_SIM_PROXY_MAX_METADATA_HEADER_CHARS,
  CAM_TO_SIM_PROXY_TOKEN_HEADER,
} from './runParams.js';

async function startBackendStub() {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        proxyToken: request.headers[CAM_TO_SIM_PROXY_TOKEN_HEADER],
        contentType: request.headers['content-type'] || null,
        body,
      });
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ok: true, url: request.url }));
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('backend stub failed to bind');
  }

  return {
    requests,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

test('cam-to-sim ingress rule matching is limited to phone session routes', () => {
  assert.ok(getCamToSimIngressRule('GET', '/cam-to-sim/connect/session-1'));
  assert.ok(getCamToSimIngressRule('POST', '/cam-to-sim/sessions/session-1/phone-frame'));
  assert.equal(getCamToSimIngressRule('GET', '/health'), null);
});

test('session query token detection requires non-empty token', () => {
  assert.equal(hasSessionQueryToken(new URL('http://x/cam-to-sim/connect/a?token=abc')), true);
  assert.equal(hasSessionQueryToken(new URL('http://x/cam-to-sim/connect/a')), false);
  assert.equal(hasSessionQueryToken(new URL('http://x/cam-to-sim/connect/a?token=')), false);
  assert.equal(hasSessionQueryToken(new URL(`http://x/cam-to-sim/connect/a?token=${'a'.repeat(129)}`)), false);
});

test('cam-to-sim ingress proxy only forwards allowed tokenized routes', async () => {
  const backend = await startBackendStub();
  const proxy = await startCamToSimIngressProxy({
    backendBaseUrl: backend.baseUrl,
    proxyToken: 'proxy-secret',
  });

  try {
    const allowedResponse = await fetch(
      `${proxy.baseUrl}/cam-to-sim/sessions/session-1/stream?token=session-token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'phone-camera' }),
      }
    );
    assert.equal(allowedResponse.status, 200);
    assert.equal(backend.requests.length, 1);
    assert.equal(backend.requests[0].url, '/cam-to-sim/sessions/session-1/stream?token=session-token');
    assert.equal(backend.requests[0].proxyToken, 'proxy-secret');

    const disallowedResponse = await fetch(`${proxy.baseUrl}/health?token=session-token`);
    assert.equal(disallowedResponse.status, 404);
    assert.equal(backend.requests.length, 1);

    const missingTokenResponse = await fetch(`${proxy.baseUrl}/cam-to-sim/connect/session-1`);
    assert.equal(missingTokenResponse.status, 401);
    assert.equal(backend.requests.length, 1);
  } finally {
    await new Promise((resolve) => proxy.server.close(resolve));
    await new Promise((resolve) => backend.server.close(resolve));
  }
});

test('cam-to-sim ingress proxy rejects oversized request bodies before forwarding', async () => {
  const backend = await startBackendStub();
  const proxy = await startCamToSimIngressProxy({
    backendBaseUrl: backend.baseUrl,
    proxyToken: 'proxy-secret',
  });

  try {
    const oversizedBody = 'x'.repeat(CAM_TO_SIM_PROXY_MAX_FRAME_BODY_BYTES + 1);
    const response = await fetch(
      `${proxy.baseUrl}/cam-to-sim/sessions/session-1/phone-frame?token=session-token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(oversizedBody.length),
        },
        body: oversizedBody,
      }
    );

    assert.equal(response.status, 413);
    assert.equal(backend.requests.length, 0);
  } finally {
    await new Promise((resolve) => proxy.server.close(resolve));
    await new Promise((resolve) => backend.server.close(resolve));
  }
});

test('cam-to-sim ingress proxy rejects oversized metadata headers before forwarding', async () => {
  const backend = await startBackendStub();
  const proxy = await startCamToSimIngressProxy({
    backendBaseUrl: backend.baseUrl,
    proxyToken: 'proxy-secret',
  });

  try {
    const response = await fetch(
      `${proxy.baseUrl}/cam-to-sim/sessions/session-1/phone-frame?token=session-token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Cam-To-Sim-Meta': 'x'.repeat(CAM_TO_SIM_PROXY_MAX_METADATA_HEADER_CHARS + 1),
        },
        body: 'frame',
      }
    );

    assert.equal(response.status, 400);
    assert.equal(backend.requests.length, 0);
  } finally {
    await new Promise((resolve) => proxy.server.close(resolve));
    await new Promise((resolve) => backend.server.close(resolve));
  }
});
