// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { AXIS_PRESETS } from "@/shared/constants/jointConstants";
import {
  jointTypeNeedsLimits,
  parseAxisValue,
  parseJointNumericInput,
  resolveAxisComponents,
  resolveJointAvailableLinks,
  resolveJointAxisPresetLabel,
  resolveJointLimitCommitState,
  resolveJointLimitDisplayValue,
  resolveJointLimitLocalState,
  resolveJointOriginSnapshot,
  resolveJointTypeChangeLimits,
} from "@/features/layout/jointControlHelpers";

const PARSE_OPTIONS = {
  onParseError: () => {},
  onRobotMissing: () => {},
  onXacroDetected: () => {},
  onOversize: () => {},
  onDepthExceeded: () => {},
};

describe("jointControlHelpers", () => {
  it("parses numeric inputs with empty fallback", () => {
    expect(parseJointNumericInput(" 1.25 ")).toBe(1.25);
    expect(parseJointNumericInput("")).toBeUndefined();
    expect(parseJointNumericInput("abc")).toBeUndefined();
  });

  it("parses axis values and resolves fallback components", () => {
    expect(parseAxisValue("2.5")).toBe(2.5);
    expect(parseAxisValue("bad")).toBeNull();
    expect(
      resolveAxisComponents({
        fallbackAxis: [0, 0, 1],
        localAxisX: "1",
        localAxisY: "bad",
        localAxisZ: "",
      })
    ).toEqual([1, 0, 1]);
  });

  it("matches axis preset labels with tolerance", () => {
    expect(
      resolveJointAxisPresetLabel({
        axis: [1, 0, 0.0005],
        axisPresets: AXIS_PRESETS,
      })
    ).toBe("X (1 0 0)");
    expect(
      resolveJointAxisPresetLabel({
        axis: [0.25, 0.25, 0.25],
        axisPresets: AXIS_PRESETS,
      })
    ).toBe("Custom");
  });

  it("resolves joint origin snapshots from URDF content", () => {
    const urdfContent = `
      <robot name="test">
        <joint name="joint_a" type="revolute">
          <origin xyz="1 2 3" rpy="0.1 0.2 0.3"/>
        </joint>
      </robot>
    `;

    expect(
      resolveJointOriginSnapshot({
        jointName: "joint_a",
        parseOptions: PARSE_OPTIONS,
        urdfContent,
      })
    ).toEqual({
      xyz: [1, 2, 3],
      rpy: [0.1, 0.2, 0.3],
    });
    expect(
      resolveJointOriginSnapshot({
        jointName: "missing",
        parseOptions: PARSE_OPTIONS,
        urdfContent,
      })
    ).toEqual({
      xyz: [0, 0, 0],
      rpy: [0, 0, 0],
    });
  });

  it("resolves available links from analysis or raw URDF", () => {
    expect(
      resolveJointAvailableLinks({
        urdfAnalysis: {
          isValid: true,
          linkNames: ["tool", "base_link"],
        } as never,
      })
    ).toEqual(["base_link", "tool"]);

    const urdfContent = `
      <robot name="test">
        <link name="tool"/>
        <link name="base_link"/>
      </robot>
    `;
    expect(resolveJointAvailableLinks({ urdfContent })).toEqual(["base_link", "tool"]);
    expect(resolveJointAvailableLinks({ urdfContent: "<broken>" })).toEqual([]);
  });

  it("resolves joint limit local state and type requirements", () => {
    expect(
      resolveJointLimitLocalState({
        jointInfo: { type: "revolute", lower: -1, upper: 2 } as never,
      })
    ).toEqual({ lower: "-1", upper: "2" });
    expect(
      resolveJointLimitLocalState({
        jointInfo: { type: "continuous", lower: -1, upper: 2 } as never,
      })
    ).toEqual({ lower: "", upper: "" });
    expect(jointTypeNeedsLimits("prismatic")).toBe(true);
    expect(jointTypeNeedsLimits("fixed")).toBe(false);
  });

  it("resolves joint limit display values in radians or degrees", () => {
    expect(
      resolveJointLimitDisplayValue({
        angleUnit: "rad",
        fallbackLimit: 1.25,
        localLimit: "",
      })
    ).toBe(1.25);
    expect(
      resolveJointLimitDisplayValue({
        angleUnit: "deg",
        fallbackLimit: null,
        localLimit: "1",
      })
    ).toBeCloseTo(57.2957795);
    expect(
      resolveJointLimitDisplayValue({
        angleUnit: "rad",
        fallbackLimit: undefined,
        localLimit: "bad",
      })
    ).toBeUndefined();
    expect(
      resolveJointLimitDisplayValue({
        angleUnit: "rad",
        fallbackLimit: Number.POSITIVE_INFINITY,
        localLimit: "",
      })
    ).toBeUndefined();
  });

  it("validates limit commit state", () => {
    expect(
      resolveJointLimitCommitState({
        currentType: "revolute",
        localLowerLimit: "-1",
        localUpperLimit: "1",
      })
    ).toEqual({ lower: -1, upper: 1 });
    expect(
      resolveJointLimitCommitState({
        currentType: "prismatic",
        localLowerLimit: "",
        localUpperLimit: "",
      })
    ).toEqual({ errorMessage: "Prismatic joints require limits." });
    expect(
      resolveJointLimitCommitState({
        currentType: "revolute",
        localLowerLimit: "2",
        localUpperLimit: "1",
      })
    ).toEqual({ errorMessage: "Lower limit must be <= upper limit" });
  });

  it("resolves limits for joint type changes", () => {
    expect(
      resolveJointTypeChangeLimits({
        jointInfo: { type: "continuous", lower: -0.5, upper: 0.5 } as never,
        localLowerLimit: "-1",
        localUpperLimit: "1",
        newType: "revolute",
      })
    ).toEqual({ lower: -1, upper: 1 });
    expect(
      resolveJointTypeChangeLimits({
        jointInfo: { type: "continuous", lower: -0.5, upper: 0.5 } as never,
        localLowerLimit: "",
        localUpperLimit: "",
        newType: "prismatic",
      })
    ).toEqual({ lower: -0.5, upper: 0.5 });
    expect(
      resolveJointTypeChangeLimits({
        jointInfo: { type: "continuous", lower: -0.5, upper: 0.5 } as never,
        localLowerLimit: "-1",
        localUpperLimit: "1",
        newType: "fixed",
      })
    ).toEqual({ lower: undefined, upper: undefined });
  });
});
