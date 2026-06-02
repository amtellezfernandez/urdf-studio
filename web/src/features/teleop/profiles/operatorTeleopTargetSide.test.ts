import { describe, expect, it } from "vitest";

import {
  resolveOperatorTeleopProfileTargetSide,
  resolveOperatorTeleopSideFromTokens,
  tokenizeOperatorTeleopTargetName,
} from "@/features/teleop/profiles/operatorTeleopTargetSide";

describe("operatorTeleopTargetSide", () => {
  it("tokenizes common snake, kebab, and camel case target names", () => {
    expect(tokenizeOperatorTeleopTargetName("openarm_leftJoint1")).toEqual([
      "openarm",
      "left",
      "joint1",
    ]);
    expect(tokenizeOperatorTeleopTargetName("right-shoulder_pan")).toEqual([
      "right",
      "shoulder",
      "pan",
    ]);
  });

  it("resolves side from tokens without substring false positives", () => {
    expect(resolveOperatorTeleopSideFromTokens(["left", "arm"])).toBe("left");
    expect(resolveOperatorTeleopSideFromTokens(["right", "arm"])).toBe("right");
    expect(resolveOperatorTeleopSideFromTokens(["cleft", "joint"])).toBe("center");
  });

  it("prefers explicit profile target side over joint-name inference", () => {
    expect(
      resolveOperatorTeleopProfileTargetSide({
        controlTargetSide: "right",
        controlledJointNames: ["openarm_left_joint1"],
      }),
    ).toBe("right");
    expect(
      resolveOperatorTeleopProfileTargetSide({
        controlTargetSide: null,
        controlledJointNames: ["openarm_left_joint1", "openarm_right_joint1"],
      }),
    ).toBe("mixed");
  });
});
