import { describe, expect, it } from "vitest";

import {
  countSelectedValues,
  filterStringArrayMembers,
  filterStringSetMembers,
  toggleSelectAllStringSetValues,
  toggleStringSetGroup,
  toggleStringSetValue,
} from "@/features/layout/jointListSidebarSelection";

describe("jointListSidebarSelection", () => {
  it("toggles one set value", () => {
    expect(toggleStringSetValue(new Set(["a"]), "a")).toEqual(new Set());
    expect(toggleStringSetValue(new Set(["a"]), "b")).toEqual(new Set(["a", "b"]));
  });

  it("toggles a group on when not all values are selected", () => {
    const result = toggleStringSetGroup(new Set(["base"]), ["arm", "gripper"]);
    expect(result).toEqual(new Set(["arm", "base", "gripper"]));
  });

  it("toggles a group off when all values are selected", () => {
    const result = toggleStringSetGroup(new Set(["arm", "base", "gripper"]), ["arm", "gripper"]);
    expect(result).toEqual(new Set(["base"]));
  });

  it("filters set members against allowed values", () => {
    const result = filterStringSetMembers(new Set(["arm", "ghost"]), new Set(["arm", "base"]));
    expect(result).toEqual(new Set(["arm"]));
  });

  it("filters array members against allowed values", () => {
    const result = filterStringArrayMembers(["arm", "ghost"], new Set(["arm", "base"]));
    expect(result).toEqual(["arm"]);
  });

  it("counts selected values from the candidate list", () => {
    const result = countSelectedValues(["arm", "base", "gripper"], new Set(["arm", "ghost"]));
    expect(result).toBe(1);
  });

  it("toggles select all values on and off", () => {
    expect(toggleSelectAllStringSetValues(new Set(["base"]), ["arm", "gripper"], false)).toEqual(
      new Set(["arm", "base", "gripper"])
    );
    expect(
      toggleSelectAllStringSetValues(
        new Set(["arm", "base", "gripper"]),
        ["arm", "gripper"],
        true
      )
    ).toEqual(new Set(["base"]));
  });
});
