import {
  assertBackendsAvailable,
  createBackendRuntimeUnavailableError,
  type BackendIdList,
} from "@/shared/config/backends";
import type { FeatureGate } from "@/shared/config/featureGates";
import { useBackendRuntimeStore } from "@/shared/store/useBackendRuntimeStore";
import { withBackendRequestHeaders } from "@/shared/lib/backendRequest";

type BackendGuardOptions = {
  requiredBackends: BackendIdList;
  context?: string;
};

export const requireBackends = ({ requiredBackends, context }: BackendGuardOptions): void => {
  assertBackendsAvailable(requiredBackends, context);
};

export const requireFeatureGate = (gate: FeatureGate, context?: string): void => {
  if (!gate.enabled) {
    const prefix = context ? `${context}: ` : "";
    const detail = gate.unavailableReason ? ` ${gate.unavailableReason}` : "";
    throw new Error(`${prefix}${gate.unavailableSuffix}.${detail}`.trim());
  }

  const statusById = useBackendRuntimeStore.getState().statusById;
  const runtimeUnavailable = gate.requiredBackends.filter(
    (backendId) => statusById[backendId] === "unreachable"
  );
  if (runtimeUnavailable.length === 0) return;
  throw createRuntimeUnavailableError(runtimeUnavailable, context);
};

const isNetworkFailure = (error: unknown): boolean => {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    if (error.name === "AbortError") return false;
  }
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;
  return /Failed to fetch|NetworkError|fetch failed|Load failed|ECONNREFUSED|ERR_CONNECTION_REFUSED|ERR_NETWORK/i.test(
    error.message
  );
};

const createRuntimeUnavailableError = (
  requiredBackends: BackendIdList,
  context?: string
) => createBackendRuntimeUnavailableError(requiredBackends, context);

export const guardedFetch = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: BackendGuardOptions
) => {
  requireBackends(options);
  const correlatedRequest = withBackendRequestHeaders(init);
  return fetch(input, correlatedRequest.init)
    .then((response) => {
      useBackendRuntimeStore.getState().markBackendsHealthy(options.requiredBackends);
      return response;
    })
    .catch((error) => {
      if (isNetworkFailure(error)) {
        useBackendRuntimeStore
          .getState()
          .markBackendsUnreachable(
            options.requiredBackends,
            error instanceof Error ? error.message : undefined
          );
        throw createRuntimeUnavailableError(options.requiredBackends, options.context);
      }
      throw error;
    });
};
