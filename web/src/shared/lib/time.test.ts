import { afterEach, describe, expect, it, vi } from "vitest";
import { nowMs } from "@/shared/lib/time";

describe("time", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses an injected high resolution clock", () => {
    expect(nowMs({ now: () => 12.5 })).toBe(12.5);
  });

  it("falls back when the injected clock returns a non-finite value", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);

    expect(nowMs({ now: () => Number.NaN })).toBe(1234);
  });

  it("falls back when no high resolution clock is available", () => {
    vi.spyOn(Date, "now").mockReturnValue(5678);

    expect(nowMs(null)).toBe(5678);
  });
});
