// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { AXIS_PRESETS } from "@/shared/constants/jointConstants";
import {
  parseAxisValue,
  parseJointNumericInput,
  resolveAxisComponents,
  resolveJointAvailableLinks,
  resolveJointAxisPresetLabel,
  resolveJointOriginSnapshot,
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
});
