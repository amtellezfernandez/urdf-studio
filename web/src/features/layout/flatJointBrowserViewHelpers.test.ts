import { describe, expect, it } from "vitest";

import {
  resolveFlatJointBrowserEmptyState,
  resolveJointGroupLabel,
} from "@/features/layout/flatJointBrowserViewHelpers";

describe("flatJointBrowserViewHelpers", () => {
  it("resolves the empty state message", () => {
    expect(
      resolveFlatJointBrowserEmptyState({
        searchQuery: "wrist",
        typeFilter: "all",
      })
    ).toBe("No joints match the filters");
    expect(
      resolveFlatJointBrowserEmptyState({
        searchQuery: "",
        typeFilter: "all",
      })
    ).toBe("No joints available");
  });

  it("resolves the joint group label from explicit or fallback labels", () => {
    expect(
      resolveJointGroupLabel({
        fallbackSectionLabel: "arm",
        jointName: "joint_b",
        structureJointLabels: { joint_b: "custom_arm" },
      })
    ).toBe("custom_arm");
    expect(
      resolveJointGroupLabel({
        fallbackSectionLabel: "arm",
        jointName: "joint_a",
        structureJointLabels: {},
      })
    ).toBe("arm");
    expect(
      resolveJointGroupLabel({
        fallbackSectionLabel: null,
        jointName: "joint_a",
        structureJointLabels: {},
      })
    ).toBeNull();
  });
});
