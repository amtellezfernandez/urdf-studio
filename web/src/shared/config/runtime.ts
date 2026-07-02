type RuntimeConfig = {
  apiBaseUrl?: string;
  ikdBaseUrl?: string;
  ikdWsUrl?: string;
  ikdApproachWsUrl?: string;
  ikd?: IkdRuntimeConfig;
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

type IkdRuntimeConfig = {
  enabled?: boolean;
  useForDrag?: boolean;
  controlHz?: number;
  telemetryHz?: number;
};

type ResolvedRuntimeConfig = {
  apiBaseUrl: string;
  ikdBaseUrl: string;
  ikdWsUrl: string;
  ikdApproachWsUrl: string;
  ikd: IkdRuntimeConfig;
  ik: IkRuntimeConfig;
};

const FALLBACK_IK: IkRuntimeConfig = {
  defaultSolverChain: ["ik-js", "amik"],
  timeouts: {
    requestMs: 1200,
    dragMs: 300,
    orbitMs: 250,
  },
  ikfast: {},
};

const FALLBACKS: ResolvedRuntimeConfig = {
  apiBaseUrl: "http://127.0.0.1:8000",
  ikdBaseUrl: "http://127.0.0.1:8088",
  ikdWsUrl: "ws://127.0.0.1:8088/telemetry",
  ikdApproachWsUrl: "ws://127.0.0.1:8088/approach/ws",
  ikd: {
    enabled: false,
    useForDrag: false,
    controlHz: 500,
    telemetryHz: 60,
  },
  ik: FALLBACK_IK,
};

const injectedConfig =
  typeof __URDF_CONFIG__ !== "undefined" ? (__URDF_CONFIG__ as RuntimeConfig) : {};

const envConfig: RuntimeConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
  ikdBaseUrl: import.meta.env.VITE_IKD_BASE_URL,
  ikdWsUrl: import.meta.env.VITE_IKD_WS_URL,
  ikdApproachWsUrl: import.meta.env.VITE_IKD_APPROACH_WS_URL,
};

const resolveIkdConfig = (config?: IkdRuntimeConfig): IkdRuntimeConfig => ({
  enabled: config?.enabled ?? FALLBACKS.ikd.enabled,
  useForDrag: config?.useForDrag ?? FALLBACKS.ikd.useForDrag,
  controlHz: config?.controlHz ?? FALLBACKS.ikd.controlHz,
  telemetryHz: config?.telemetryHz ?? FALLBACKS.ikd.telemetryHz,
});

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
  ikdBaseUrl: envConfig.ikdBaseUrl ?? injectedConfig.ikdBaseUrl ?? FALLBACKS.ikdBaseUrl,
  ikdWsUrl: envConfig.ikdWsUrl ?? injectedConfig.ikdWsUrl ?? FALLBACKS.ikdWsUrl,
  ikdApproachWsUrl:
    envConfig.ikdApproachWsUrl ??
    injectedConfig.ikdApproachWsUrl ??
    FALLBACKS.ikdApproachWsUrl,
  ikd: resolveIkdConfig(injectedConfig.ikd),
  ik: resolveIkConfig(envConfig.ik ?? injectedConfig.ik),
};

export const API_BASE_URL = resolvedConfig.apiBaseUrl;
export const IKD_BASE_URL = resolvedConfig.ikdBaseUrl;
export const IKD_WS_URL = resolvedConfig.ikdWsUrl;
export const IKD_APPROACH_WS_URL = resolvedConfig.ikdApproachWsUrl;
export const IKD_RUNTIME_CONFIG = resolvedConfig.ikd;
export const IK_RUNTIME_CONFIG = resolvedConfig.ik;
