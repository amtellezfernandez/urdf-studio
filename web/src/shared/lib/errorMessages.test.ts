import { describe, expect, it } from "vitest";

import { readUnknownErrorMessage } from "@/shared/lib/errorMessages";

describe("readUnknownErrorMessage", () => {
  it("uses the Error message when available", () => {
    expect(readUnknownErrorMessage(new Error("Specific failure"), "Fallback failure")).toBe(
      "Specific failure"
    );
  });

  it("uses the fallback for non-Error values", () => {
    expect(readUnknownErrorMessage("Specific failure", "Fallback failure")).toBe(
      "Fallback failure"
    );
    expect(readUnknownErrorMessage(null, "Fallback failure")).toBe("Fallback failure");
  });
});
