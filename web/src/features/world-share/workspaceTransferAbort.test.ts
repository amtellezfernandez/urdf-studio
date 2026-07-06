import { describe, expect, it } from "vitest";

import {
  createWorkspaceTransferAbortError,
  isWorkspaceTransferAbortError,
  throwIfWorkspaceTransferAborted,
} from "@/features/world-share/workspaceTransferAbort";

describe("workspace transfer abort helpers", () => {
  it("creates an abort-shaped cancellation error", () => {
    const error = createWorkspaceTransferAbortError();

    expect(error.name).toBe("AbortError");
    expect(error.message).toBe("Workspace transfer cancelled.");
    expect(isWorkspaceTransferAbortError(error)).toBe(true);
  });

  it("throws only when the provided signal has been aborted", () => {
    const controller = new AbortController();

    expect(() => throwIfWorkspaceTransferAborted()).not.toThrow();
    expect(() => throwIfWorkspaceTransferAborted(controller.signal)).not.toThrow();

    controller.abort();

    expect(() => throwIfWorkspaceTransferAborted(controller.signal)).toThrow(
      /Workspace transfer cancelled/
    );
  });

  it("recognizes ordinary AbortError instances", () => {
    const error = new Error("cancelled");
    error.name = "AbortError";

    expect(isWorkspaceTransferAbortError(error)).toBe(true);
    expect(isWorkspaceTransferAbortError(new Error("other"))).toBe(false);
  });
});
