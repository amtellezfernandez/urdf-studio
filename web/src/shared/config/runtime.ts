type RuntimeConfig = {
  apiBaseUrl?: string;
  rerunWebUrl?: string;
  rerunWsUrl?: string;
  ik?: IkRuntimeConfig;
};

type IkTimeoutConfig = {
  requestMs?: number;
  dragMs?: number;
  orbitMs?: number;
};

type IkfastRuntimeConfig = {
  moduleUrl?: string;
  factoryExport?: string;
  solveExport?: string;
  init?: Record<string, unknown>;
};

type IkRuntimeConfig = {
  defaultSolverChain?: string[];
  timeouts?: IkTimeoutConfig;
  ikfast?: IkfastRuntimeConfig;
};

type ResolvedRuntimeConfig = {
  apiBaseUrl: string;
  rerunWebUrl: string;
  rerunWsUrl: string;
  ik: IkRuntimeConfig;
};

const FALLBACK_IK: IkRuntimeConfig = {
  defaultSolverChain: ["pyroki-http"],
  timeouts: {
    requestMs: 1200,
    dragMs: 300,
    orbitMs: 250,
  },
  ikfast: {},
};

const FALLBACKS: ResolvedRuntimeConfig = {
  apiBaseUrl: "http://localhost:8000",
  rerunWebUrl: "http://localhost:9090",
  rerunWsUrl: "ws://localhost:9876",
  ik: FALLBACK_IK,
};

const injectedConfig =
  typeof __URDF_CONFIG__ !== "undefined" ? (__URDF_CONFIG__ as RuntimeConfig) : {};

const envConfig: RuntimeConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
  rerunWebUrl: import.meta.env.VITE_RERUN_WEB_URL,
  rerunWsUrl: import.meta.env.VITE_RERUN_WS_URL,
};

const resolveIkConfig = (config?: IkRuntimeConfig): IkRuntimeConfig => ({
  defaultSolverChain: Array.isArray(config?.defaultSolverChain)
    ? config?.defaultSolverChain
    : FALLBACK_IK.defaultSolverChain,
  timeouts: {
    requestMs: config?.timeouts?.requestMs ?? FALLBACK_IK.timeouts?.requestMs,
    dragMs: config?.timeouts?.dragMs ?? FALLBACK_IK.timeouts?.dragMs,
    orbitMs: config?.timeouts?.orbitMs ?? FALLBACK_IK.timeouts?.orbitMs,
  },
  ikfast: config?.ikfast ?? FALLBACK_IK.ikfast,
});

const resolvedConfig: ResolvedRuntimeConfig = {
  apiBaseUrl: envConfig.apiBaseUrl ?? injectedConfig.apiBaseUrl ?? FALLBACKS.apiBaseUrl,
  rerunWebUrl: envConfig.rerunWebUrl ?? injectedConfig.rerunWebUrl ?? FALLBACKS.rerunWebUrl,
  rerunWsUrl: envConfig.rerunWsUrl ?? injectedConfig.rerunWsUrl ?? FALLBACKS.rerunWsUrl,
  ik: resolveIkConfig(envConfig.ik ?? injectedConfig.ik),
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
export const IK_RUNTIME_CONFIG = resolvedConfig.ik;
