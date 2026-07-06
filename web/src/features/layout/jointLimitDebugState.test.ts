import { describe, expect, it } from "vitest";

import {
  getLimitAttributeInputTitle,
  parseLimitAttributeDebugState,
  parsePositiveScalar,
} from "@/features/layout/jointLimitDebugState";

describe("jointLimitDebugState", () => {
  it("parses only positive finite scalar values", () => {
    expect(parsePositiveScalar("1.5")).toBe(1.5);
    expect(parsePositiveScalar(2)).toBe(2);
    expect(parsePositiveScalar("0")).toBeNull();
    expect(parsePositiveScalar("-1")).toBeNull();
    expect(parsePositiveScalar("bad")).toBeNull();
    expect(parsePositiveScalar(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parsePositiveScalar(undefined)).toBeNull();
  });

  it("describes missing, invalid, zero, and set limit attributes", () => {
    expect(parseLimitAttributeDebugState(undefined)).toEqual({
      raw: null,
      status: "missing",
      value: null,
    });
    expect(parseLimitAttributeDebugState("bad")).toEqual({
      raw: "bad",
      status: "invalid",
      value: null,
    });
    expect(parseLimitAttributeDebugState(Number.POSITIVE_INFINITY)).toEqual({
      raw: "Infinity",
      status: "invalid",
      value: null,
    });
    expect(parseLimitAttributeDebugState("-1")).toEqual({
      raw: "-1",
      status: "invalid",
      value: -1,
    });
    expect(parseLimitAttributeDebugState("0")).toEqual({
      raw: "0",
      status: "zero",
      value: 0,
    });
    expect(parseLimitAttributeDebugState("2.5")).toEqual({
      raw: "2.5",
      status: "set",
      value: 2.5,
    });
  });

  it("formats limit attribute titles from debug state", () => {
    expect(
      getLimitAttributeInputTitle("velocity", {
        raw: "2",
        status: "set",
        value: 2,
      })
    ).toBe('URDF <limit velocity="2">');
    expect(
      getLimitAttributeInputTitle("effort", {
        raw: null,
        status: "missing",
        value: null,
      })
    ).toBe("URDF <limit effort> is not set.");
  });
});
