import http from 'node:http';

import {
  CAM_TO_SIM_INGRESS_PROXY_BIND_HOST,
  CAM_TO_SIM_PROXY_FORWARD_HEADERS,
  CAM_TO_SIM_PROXY_HEADERS_TIMEOUT_MS,
  CAM_TO_SIM_PROXY_KEEP_ALIVE_TIMEOUT_MS,
  CAM_TO_SIM_PROXY_MAX_FRAME_BODY_BYTES,
  CAM_TO_SIM_PROXY_MAX_JSON_BODY_BYTES,
  CAM_TO_SIM_PROXY_MAX_METADATA_HEADER_CHARS,
  CAM_TO_SIM_PROXY_MAX_TOKEN_QUERY_CHARS,
  CAM_TO_SIM_PROXY_REQUEST_TIMEOUT_MS,
  CAM_TO_SIM_PROXY_RESPONSE_HEADERS,
  CAM_TO_SIM_PROXY_TOKEN_HEADER,
  CAM_TO_SIM_PROXY_UPSTREAM_TIMEOUT_MS,
} from './runParams.js';

const CAM_TO_SIM_CONNECT_ROUTE = /^\/cam-to-sim\/connect\/[^/]+$/;
const CAM_TO_SIM_CAPTURE_COACH_ROUTE = /^\/cam-to-sim\/sessions\/[^/]+\/capture-coach$/;
const CAM_TO_SIM_STREAM_ROUTE = /^\/cam-to-sim\/sessions\/[^/]+\/stream$/;
const CAM_TO_SIM_PHONE_FRAME_ROUTE = /^\/cam-to-sim\/sessions\/[^/]+\/phone-frame$/;

const CAM_TO_SIM_INGRESS_RULES = [
  { method: 'GET', pattern: CAM_TO_SIM_CONNECT_ROUTE, maxBodyBytes: 0 },
  { method: 'GET', pattern: CAM_TO_SIM_CAPTURE_COACH_ROUTE, maxBodyBytes: 0 },
  { method: 'POST', pattern: CAM_TO_SIM_STREAM_ROUTE, maxBodyBytes: CAM_TO_SIM_PROXY_MAX_JSON_BODY_BYTES },
  { method: 'POST', pattern: CAM_TO_SIM_PHONE_FRAME_ROUTE, maxBodyBytes: CAM_TO_SIM_PROXY_MAX_FRAME_BODY_BYTES },
];

function getHeaderValue(headers, name) {
  const rawValue = headers[name];
  if (Array.isArray(rawValue)) {
    return rawValue[0] || '';
  }
  return typeof rawValue === 'string' ? rawValue : '';
}

export function getCamToSimIngressRule(method, pathname) {
  return (
    CAM_TO_SIM_INGRESS_RULES.find(
      (rule) => rule.method === method && rule.pattern.test(pathname)
    ) || null
  );
}

export function hasSessionQueryToken(url) {
  const token = url.searchParams.get('token');
  if (typeof token !== 'string') {
    return false;
  }
  const normalizedToken = token.trim();
  return normalizedToken.length > 0 && normalizedToken.length <= CAM_TO_SIM_PROXY_MAX_TOKEN_QUERY_CHARS;
}

function readRequestBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    if (maxBodyBytes === 0) {
      request.resume();
      resolve(Buffer.alloc(0));
      return;
    }

    let totalBytes = 0;
    const chunks = [];

    request.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBodyBytes) {
        reject(new Error(`request body exceeded ${maxBodyBytes} bytes`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}

function buildForwardHeaders(requestHeaders, proxyToken) {
  const headers = {
    [CAM_TO_SIM_PROXY_TOKEN_HEADER]: proxyToken,
  };

  for (const headerName of CAM_TO_SIM_PROXY_FORWARD_HEADERS) {
    const value = getHeaderValue(requestHeaders, headerName);
    if (value) {
      headers[headerName] = value;
    }
  }

  return headers;
}

function getMetadataHeader(headers) {
  return getHeaderValue(headers, 'x-cam-to-sim-meta');
}

function writeProxyResponse(response, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  for (const [headerName, headerValue] of Object.entries(CAM_TO_SIM_PROXY_RESPONSE_HEADERS)) {
    response.setHeader(headerName, headerValue);
  }
  response.statusCode = statusCode;
  response.setHeader('Content-Type', contentType);
  response.end(body);
}

function validateIngressRequest(requestUrl, requestHeaders, rule) {
  if (!hasSessionQueryToken(requestUrl)) {
    return {
      statusCode: 401,
      message: 'Missing session token',
    };
  }

  const metadataHeader = getMetadataHeader(requestHeaders);
  if (metadataHeader.length > CAM_TO_SIM_PROXY_MAX_METADATA_HEADER_CHARS) {
    return {
      statusCode: 400,
      message: 'cam-to-sim metadata header exceeded limit',
    };
  }

  if (rule.maxBodyBytes === 0) {
    return null;
  }

  const contentLengthHeader = getHeaderValue(requestHeaders, 'content-length');
  if (!contentLengthHeader) {
    return null;
  }
  const contentLength = Number(contentLengthHeader);
  if (!Number.isInteger(contentLength) || contentLength < 0) {
    return {
      statusCode: 400,
      message: 'Invalid content-length header',
    };
  }
  if (contentLength > rule.maxBodyBytes) {
    return {
      statusCode: 413,
      message: `request body exceeded ${rule.maxBodyBytes} bytes`,
    };
  }

  return null;
}

export async function handleCamToSimIngressRequest(request, response, options) {
  const {
    backendBaseUrl,
    proxyToken,
  } = options;
  const requestUrl = new URL(request.url || '/', 'http://cam-to-sim-proxy.local');
  const requestMethod = typeof request.method === 'string' ? request.method.toUpperCase() : 'GET';
  const rule = getCamToSimIngressRule(requestMethod, requestUrl.pathname);

  if (!rule) {
    writeProxyResponse(response, 404, 'Not found');
    return;
  }

  const validationError = validateIngressRequest(requestUrl, request.headers, rule);
  if (validationError) {
    writeProxyResponse(response, validationError.statusCode, validationError.message);
    return;
  }

  let requestBody;
  try {
    requestBody = await readRequestBody(request, rule.maxBodyBytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'request body rejected';
    writeProxyResponse(response, 413, message);
    return;
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(`${backendBaseUrl}${requestUrl.pathname}${requestUrl.search}`, {
      method: requestMethod,
      headers: buildForwardHeaders(request.headers, proxyToken),
      body: requestMethod === 'GET' ? undefined : requestBody,
      signal: AbortSignal.timeout(CAM_TO_SIM_PROXY_UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      writeProxyResponse(response, 504, 'Ingress upstream timed out');
      return;
    }
    writeProxyResponse(response, 502, 'Ingress upstream unavailable');
    return;
  }

  const upstreamBody = Buffer.from(await upstreamResponse.arrayBuffer());
  for (const [headerName, headerValue] of Object.entries(CAM_TO_SIM_PROXY_RESPONSE_HEADERS)) {
    response.setHeader(headerName, headerValue);
  }
  const upstreamContentType = upstreamResponse.headers.get('content-type');
  if (upstreamContentType) {
    response.setHeader('Content-Type', upstreamContentType);
  }
  response.statusCode = upstreamResponse.status;
  response.end(upstreamBody);
}

export async function startCamToSimIngressProxy({
  backendBaseUrl,
  proxyToken,
  host = CAM_TO_SIM_INGRESS_PROXY_BIND_HOST,
  port = 0,
}) {
  const server = http.createServer((request, response) => {
    void handleCamToSimIngressRequest(request, response, {
      backendBaseUrl,
      proxyToken,
    });
  });
  server.requestTimeout = CAM_TO_SIM_PROXY_REQUEST_TIMEOUT_MS;
  server.headersTimeout = CAM_TO_SIM_PROXY_HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = CAM_TO_SIM_PROXY_KEEP_ALIVE_TIMEOUT_MS;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to resolve cam-to-sim ingress proxy address');
  }

  return {
    server,
    baseUrl: `http://${host}:${address.port}`,
  };
}
