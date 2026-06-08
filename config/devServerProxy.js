import { resolveTeamSharingRequestRemoteAddress } from "./teamSharingGate.js";
import { resolveWslHostRemoteAddresses } from "./wslOwnerProxy.js";

export const GITHUB_DEV_PROXY_ENABLE_ENV = "URDF_STUDIO_ENABLE_GITHUB_DEV_PROXY";
export const GITHUB_DEV_PROXY_PREFIX = "/__github_api";
export const API_PROXY_PREFIX = "/api";
export const DISABLED_GITHUB_DEV_PROXY_STATUS_CODE = 404;
export const DISABLED_GITHUB_DEV_PROXY_MESSAGE = "GitHub dev proxy is disabled for remote team sessions.";

const LOOPBACK_WEB_BIND_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
export const DEV_SERVER_PROXY_HEADERS = {
  clientHost: "X-URDF-Dev-Proxy-Client-Host",
};

export function isTruthyEnvValue(value) {
  return /^(1|true|yes)$/i.test(String(value || ""));
}

export function isLoopbackWebBindHost(host) {
  return LOOPBACK_WEB_BIND_HOSTS.has(String(host || "").trim().toLowerCase());
}

export function shouldEnableGitHubDevProxy(runtimeConfig, env = process.env) {
  if (isTruthyEnvValue(env[GITHUB_DEV_PROXY_ENABLE_ENV])) {
    return true;
  }
  return isLoopbackWebBindHost(runtimeConfig?.web?.bindHost);
}

export function isGitHubDevProxyRequestPath(requestUrl) {
  const requestPath = String(requestUrl || "").split("?")[0];
  return requestPath === GITHUB_DEV_PROXY_PREFIX || requestPath.startsWith(`${GITHUB_DEV_PROXY_PREFIX}/`);
}

export function shouldBlockGitHubDevProxyRequest(requestUrl, { runtimeConfig, env = process.env }) {
  return isGitHubDevProxyRequestPath(requestUrl) && !shouldEnableGitHubDevProxy(runtimeConfig, env);
}

export function resolveDevProxyClientHost(
  remoteAddress,
  {
    runtimeConfig = null,
    trustedOwnerRemoteAddresses = resolveWslHostRemoteAddresses(),
  } = {}
) {
  if (!runtimeConfig) {
    return remoteAddress || "";
  }
  return resolveTeamSharingRequestRemoteAddress({
    remoteAddress: remoteAddress || "",
    trustedOwnerRemoteAddresses,
    webBindHost: runtimeConfig?.web?.bindHost || "",
  });
}

export function attachDevProxyClientHeaders(
  proxy,
  {
    runtimeConfig = null,
    trustedOwnerRemoteAddresses = resolveWslHostRemoteAddresses(),
  } = {}
) {
  proxy.on("proxyReq", (proxyRequest, request) => {
    proxyRequest.setHeader(
      DEV_SERVER_PROXY_HEADERS.clientHost,
      resolveDevProxyClientHost(request.socket?.remoteAddress || "", {
        runtimeConfig,
        trustedOwnerRemoteAddresses,
      }),
    );
  });
}

export function buildDevServerProxy({ runtimeConfig, runtimeUrls, env = process.env }) {
  const proxy = {
    [API_PROXY_PREFIX]: {
      target: runtimeUrls.apiBaseUrl,
      changeOrigin: true,
      ws: true,
      configure: (proxy) => attachDevProxyClientHeaders(proxy, { runtimeConfig }),
      rewrite: (requestPath) => requestPath.replace(/^\/api/, ""),
    },
  };

  if (shouldEnableGitHubDevProxy(runtimeConfig, env)) {
    proxy[GITHUB_DEV_PROXY_PREFIX] = {
      target: "https://api.github.com",
      changeOrigin: true,
      rewrite: (requestPath) => requestPath.replace(/^\/__github_api/, ""),
    };
  }

  return proxy;
}
