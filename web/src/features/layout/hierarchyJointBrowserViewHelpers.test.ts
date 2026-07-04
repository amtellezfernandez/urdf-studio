import { describe, expect, it } from "vitest";

import { resolveHierarchyJointBrowserEmptyState } from "@/features/layout/hierarchyJointBrowserViewHelpers";

describe("hierarchyJointBrowserViewHelpers", () => {
  it("returns the loading state when the hierarchy tree is missing", () => {
    expect(
      resolveHierarchyJointBrowserEmptyState({
        hasHierarchyTree: false,
        hasFilteredJoints: false,
        searchQuery: "",
        typeFilter: "all",
      })
    ).toBe("Loading hierarchy...");
  });

  it("returns the filtered empty state when filters remove all joints", () => {
    expect(
      resolveHierarchyJointBrowserEmptyState({
        hasHierarchyTree: true,
        hasFilteredJoints: false,
        searchQuery: "wrist",
        typeFilter: "all",
      })
    ).toBe("No joints match the filters");
  });

  it("returns the generic empty state when no joints are available", () => {
    expect(
      resolveHierarchyJointBrowserEmptyState({
        hasHierarchyTree: true,
        hasFilteredJoints: false,
        searchQuery: "",
        typeFilter: "all",
      })
    ).toBe("No joints available");
  });
});
