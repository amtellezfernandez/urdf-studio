import {
  buildBackendUnavailableReason,
  formatUnavailableBackends,
  listUnavailableBackends,
  type BackendIdList,
} from "@/shared/config/backends";

export type FeatureGate = {
  enabled: boolean;
  unavailableSuffix: string;
  unavailableReason: string;
  disabledBadge: string;
  requiredBackends: BackendIdList;
};

const createFeatureGate = (requiredBackends: BackendIdList): FeatureGate => {
  const unavailable = listUnavailableBackends(requiredBackends);
  const enabled = unavailable.length === 0;
  const unavailableSuffix = formatUnavailableBackends(requiredBackends);
  const unavailableReason = buildBackendUnavailableReason(requiredBackends);
  const disabledBadge = enabled ? "" : unavailableSuffix;

  return {
    enabled,
    unavailableSuffix,
    unavailableReason,
    disabledBadge,
    requiredBackends,
  };
};

export const FEATURE_GATES = {
  coreApi: createFeatureGate(["core-api"]),
  worldsRegistry: createFeatureGate(["core-api"]),
  worldsHubRegistry: createFeatureGate(["world-hub-api"]),
  xacroExpansion: createFeatureGate(["core-api"]),
  ikRemoteSolve: createFeatureGate(["core-api"]),
  ikdNativeTeleop: createFeatureGate(["ikd"]),
  rosVizRuntime: createFeatureGate(["core-api"]),
} as const;

export const withUnavailableSuffix = (label: string, gate: FeatureGate): string =>
  gate.enabled || !gate.unavailableSuffix ? label : `${label} (${gate.unavailableSuffix})`;
