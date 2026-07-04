import { describe, expect, it } from "vitest";

import {
  DEFAULT_STRUCTURE_GROUP_LABEL,
  normalizeStructureGroupDisplayLabel,
  parseStructureGroupLabel,
  resolveStructureGroupLabelForName,
} from "@/features/layout/structureGroupHelpers";

describe("structureGroupHelpers", () => {
  it("parses known and unknown group labels", () => {
    expect(parseStructureGroupLabel("arm3")).toEqual({ kind: "arm", index: 3 });
    expect(parseStructureGroupLabel("base")).toEqual({ kind: "base", index: 0 });
    expect(parseStructureGroupLabel("gripper1")).toEqual({
      kind: DEFAULT_STRUCTURE_GROUP_LABEL,
      index: 1,
    });
  });

  it("normalizes display labels", () => {
    expect(normalizeStructureGroupDisplayLabel("arm2")).toBe("Arm2");
    expect(normalizeStructureGroupDisplayLabel("")).toBe("Other");
  });

  it("resolves effective group labels for names", () => {
    expect(
      resolveStructureGroupLabelForName({
        labelsByName: { joint_a: "arm1" },
        name: "joint_a",
      })
    ).toBe("arm1");
    expect(
      resolveStructureGroupLabelForName({
        labelsByName: { joint_a: "   " },
        name: "joint_a",
      })
    ).toBe(DEFAULT_STRUCTURE_GROUP_LABEL);
  });
});
