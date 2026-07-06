import { WORKSPACE_TRANSFER_PARAMS } from "@/features/world-share/workspaceTransferParams";

export const createWorkspaceTransferAbortError = (): Error => {
  if (typeof DOMException !== "undefined") {
    return new DOMException(WORKSPACE_TRANSFER_PARAMS.abortMessage, "AbortError");
  }
  const error = new Error(WORKSPACE_TRANSFER_PARAMS.abortMessage);
  error.name = "AbortError";
  return error;
};

export const isWorkspaceTransferAbortError = (error: unknown): boolean => {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "AbortError";
  }
  return error instanceof Error && error.name === "AbortError";
};

export const throwIfWorkspaceTransferAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;
  throw createWorkspaceTransferAbortError();
};
