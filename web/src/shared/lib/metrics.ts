type MetricsEnv = { VITE_ENABLE_METRICS?: string };
type MetricsGlobal = { __URDF_METRICS__?: boolean };

declare global {
  interface Window {
    __URDF_METRICS__?: boolean;
  }

  interface WorkerGlobalScope {
    __URDF_METRICS__?: boolean;
  }
}

export const isMetricsEnabled = (
  globalObj?: MetricsGlobal,
  env?: MetricsEnv
): boolean =>
  Boolean(globalObj?.__URDF_METRICS__ || env?.VITE_ENABLE_METRICS === "1");
