type RuntimeConfig = {
  apiBaseUrl?: string;
  rerunWebUrl?: string;
  rerunWsUrl?: string;
};

const FALLBACKS: Required<RuntimeConfig> = {
  apiBaseUrl: "http://localhost:8000",
  rerunWebUrl: "http://localhost:9090",
  rerunWsUrl: "ws://localhost:9876",
};

const injectedConfig =
  typeof __URDF_CONFIG__ !== "undefined" ? (__URDF_CONFIG__ as RuntimeConfig) : {};

const envConfig: RuntimeConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
  rerunWebUrl: import.meta.env.VITE_RERUN_WEB_URL,
  rerunWsUrl: import.meta.env.VITE_RERUN_WS_URL,
};

const resolvedConfig: Required<RuntimeConfig> = {
  apiBaseUrl: envConfig.apiBaseUrl ?? injectedConfig.apiBaseUrl ?? FALLBACKS.apiBaseUrl,
  rerunWebUrl: envConfig.rerunWebUrl ?? injectedConfig.rerunWebUrl ?? FALLBACKS.rerunWebUrl,
  rerunWsUrl: envConfig.rerunWsUrl ?? injectedConfig.rerunWsUrl ?? FALLBACKS.rerunWsUrl,
};

const getPort = (url: string, fallback: number) => {
  try {
    const parsed = new URL(url);
    const port = Number(parsed.port);
    return Number.isFinite(port) && port > 0 ? port : fallback;
  } catch (error) {
    return fallback;
  }
};

export const API_BASE_URL = resolvedConfig.apiBaseUrl;
export const RERUN_WEB_URL = resolvedConfig.rerunWebUrl;
export const RERUN_WS_URL = resolvedConfig.rerunWsUrl;
export const RERUN_WEB_PORT = getPort(RERUN_WEB_URL, 9090);
export const RERUN_WS_PORT = getPort(RERUN_WS_URL, 9876);
