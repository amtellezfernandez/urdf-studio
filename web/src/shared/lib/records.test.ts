import { describe, expect, it } from "vitest";

import { isRecord, readRecordOrEmpty } from "@/shared/lib/records";

describe("record helpers", () => {
  it("accepts plain object records", () => {
    expect(isRecord({ enabled: true })).toBe(true);
  });

  it("rejects null, arrays, and primitive values", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord("value")).toBe(false);
  });

  it("returns empty records for invalid values", () => {
    expect(readRecordOrEmpty(null)).toEqual({});
    expect(readRecordOrEmpty(["not", "record"])).toEqual({});
  });
});
