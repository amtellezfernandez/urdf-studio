import { useMemo } from "react";
import {
  buildRuntimeUnavailableBackendsReason,
  formatRuntimeUnavailableBackends,
  type BackendIdList,
  type BackendMap,
} from "@/shared/config/backends";
import { withUnavailableSuffix, type FeatureGate } from "@/shared/config/featureGates";
import {
  useBackendRuntimeStore,
  type BackendRuntimeStatus,
} from "@/shared/store/useBackendRuntimeStore";

export type FeatureGateUiState = {
  label: string;
  disabled: boolean;
  title?: string;
};

export type FeatureGateAvailability = {
  kind: "availability";
  enabled: boolean;
  unavailableSuffix: string;
  unavailableReason: string;
  disabledBadge: string;
  requiredBackends: BackendIdList;
};

const resolveRuntimeUnavailableBackends = (
  requiredBackends: BackendIdList,
  statusById: BackendMap<BackendRuntimeStatus>
) => requiredBackends.filter((backendId) => statusById[backendId] === "unreachable");

export const resolveFeatureGateAvailability = (
  gate: FeatureGate,
  statusById: BackendMap<BackendRuntimeStatus> = useBackendRuntimeStore.getState().statusById
): FeatureGateAvailability => {
  if (!gate.enabled) {
    return {
      kind: "availability",
      enabled: false,
      unavailableSuffix: gate.unavailableSuffix,
      unavailableReason: gate.unavailableReason,
      disabledBadge: gate.disabledBadge,
      requiredBackends: gate.requiredBackends,
    };
  }

  const runtimeUnavailable = resolveRuntimeUnavailableBackends(gate.requiredBackends, statusById);
  if (runtimeUnavailable.length === 0) {
    return {
      kind: "availability",
      enabled: true,
      unavailableSuffix: "",
      unavailableReason: "",
      disabledBadge: "",
      requiredBackends: gate.requiredBackends,
    };
  }

  const unavailableSuffix = formatRuntimeUnavailableBackends(runtimeUnavailable);
  const unavailableReason = buildRuntimeUnavailableBackendsReason(runtimeUnavailable);
  return {
    kind: "availability",
    enabled: false,
    unavailableSuffix,
    unavailableReason,
    disabledBadge: `Runtime: ${unavailableSuffix}`,
    requiredBackends: gate.requiredBackends,
  };
};

export const useFeatureGateAvailability = (gate: FeatureGate): FeatureGateAvailability => {
  const statusById = useBackendRuntimeStore((state) => state.statusById);
  return useMemo(() => resolveFeatureGateAvailability(gate, statusById), [gate, statusById]);
};

const toFeatureGateAvailability = (
  gateOrAvailability: FeatureGate | FeatureGateAvailability
): FeatureGateAvailability =>
  (gateOrAvailability as FeatureGateAvailability)?.kind === "availability"
    ? (gateOrAvailability as FeatureGateAvailability)
    : resolveFeatureGateAvailability(gateOrAvailability as FeatureGate);

export const getFeatureGateUiState = (
  label: string,
  gateOrAvailability: FeatureGate | FeatureGateAvailability
): FeatureGateUiState => {
  const availability = toFeatureGateAvailability(gateOrAvailability);
  return {
    label: availability.enabled
      ? label
      : withUnavailableSuffix(label, {
          ...availability,
        }),
    disabled: !availability.enabled,
    title: availability.enabled ? undefined : availability.unavailableReason,
  };
};
