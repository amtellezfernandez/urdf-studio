import { create } from "zustand";
import type { BackendIdList, BackendMap } from "@/shared/config/backends";

export type BackendRuntimeStatus = "unknown" | "healthy" | "unreachable";

type BackendRuntimeState = {
  statusById: BackendMap<BackendRuntimeStatus>;
  lastErrorById: Partial<BackendMap<string>>;
  markBackendsHealthy: (backendIds: BackendIdList) => void;
  markBackendsUnreachable: (backendIds: BackendIdList, errorMessage?: string) => void;
  resetBackendRuntimeStatus: (backendIds?: BackendIdList) => void;
};

const INITIAL_STATUS: BackendMap<BackendRuntimeStatus> = {
  "core-api": "unknown",
  ikd: "unknown",
  "world-hub-api": "unknown",
};

const updateStatuses = (
  previous: BackendMap<BackendRuntimeStatus>,
  backendIds: BackendIdList,
  nextStatus: BackendRuntimeStatus
): BackendMap<BackendRuntimeStatus> => {
  const next = { ...previous };
  backendIds.forEach((backendId) => {
    next[backendId] = nextStatus;
  });
  return next;
};

export const useBackendRuntimeStore = create<BackendRuntimeState>((set) => ({
  statusById: INITIAL_STATUS,
  lastErrorById: {},
  markBackendsHealthy: (backendIds) => {
    set((state) => {
      if (backendIds.length === 0) return state;
      const nextStatus = updateStatuses(state.statusById, backendIds, "healthy");
      const nextErrors = { ...state.lastErrorById };
      backendIds.forEach((backendId) => {
        delete nextErrors[backendId];
      });
      return {
        statusById: nextStatus,
        lastErrorById: nextErrors,
      };
    });
  },
  markBackendsUnreachable: (backendIds, errorMessage) => {
    set((state) => {
      if (backendIds.length === 0) return state;
      const nextStatus = updateStatuses(state.statusById, backendIds, "unreachable");
      const nextErrors = { ...state.lastErrorById };
      backendIds.forEach((backendId) => {
        nextErrors[backendId] = errorMessage || "Backend request failed";
      });
      return {
        statusById: nextStatus,
        lastErrorById: nextErrors,
      };
    });
  },
  resetBackendRuntimeStatus: (backendIds) => {
    set((state) => {
      if (!backendIds || backendIds.length === 0) {
        return {
          statusById: INITIAL_STATUS,
          lastErrorById: {},
        };
      }
      const nextStatus = updateStatuses(state.statusById, backendIds, "unknown");
      const nextErrors = { ...state.lastErrorById };
      backendIds.forEach((backendId) => {
        delete nextErrors[backendId];
      });
      return {
        statusById: nextStatus,
        lastErrorById: nextErrors,
      };
    });
  },
}));
