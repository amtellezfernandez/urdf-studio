import { describe, expect, it } from "vitest";

import type { JointLimits } from "@/shared/lib/urdfBrowser";
import {
  buildJointTypeEntries,
  buildJointTypeNamesByType,
  getJointTypeLabel,
} from "@/features/viewer/components/viewerJointTypesPanelState";

const jointLimits = {
  fixed_mount: { type: "fixed" },
  shoulder: { type: "revolute" },
  wrist: { type: "continuous" },
  slide: { type: "prismatic" },
  custom_joint: { type: "custom" },
  elbow: { type: "revolute" },
} as unknown as JointLimits;

describe("ViewerJointTypesPanel helpers", () => {
  it("groups joint names by URDF joint type", () => {
    expect(buildJointTypeNamesByType(jointLimits)).toEqual({
      continuous: ["wrist"],
      custom: ["custom_joint"],
      fixed: ["fixed_mount"],
      prismatic: ["slide"],
      revolute: ["shoulder", "elbow"],
    });
  });

  it("orders known joint types before unknown types and marks selected type", () => {
    const entries = buildJointTypeEntries({
      jointLimits,
      selectedJoint: "slide",
    });

    expect(entries.map((entry) => [entry.type, entry.count, entry.isSelected])).toEqual([
      ["revolute", 2, false],
      ["continuous", 1, false],
      ["prismatic", 1, true],
      ["fixed", 1, false],
      ["custom", 1, false],
    ]);
  });

  it("formats joint type labels without changing unknown type spelling", () => {
    expect(getJointTypeLabel("prismatic")).toBe("Prismatic");
    expect(getJointTypeLabel("custom_drive")).toBe("Custom_drive");
  });
});
