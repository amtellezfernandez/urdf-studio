/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { parseUrdfDocument } from "@/shared/lib/urdfCore";
import { readUrdfJointTopology } from "@/shared/lib/urdfTopology";

describe("urdfTopology", () => {
  it("reads valid joint topology and normalizes empty joint types", () => {
    const document = parseUrdfDocument(`
      <robot name="demo">
        <link name="base" />
        <link name="arm" />
        <link name="tool" />
        <joint name="base_to_arm" type=" revolute ">
          <parent link="base" />
          <child link="arm" />
        </joint>
        <joint name="arm_to_tool" type="">
          <parent link="arm" />
          <child link="tool" />
        </joint>
        <joint name="invalid">
          <parent link="tool" />
        </joint>
      </robot>
    `);
    const robotElement = document?.querySelector("robot");

    expect(robotElement).not.toBeNull();
    expect(readUrdfJointTopology(robotElement!)).toMatchObject([
      {
        childLinkName: "arm",
        jointName: "base_to_arm",
        jointType: "revolute",
        parentLinkName: "base",
      },
      {
        childLinkName: "tool",
        jointName: "arm_to_tool",
        jointType: "fixed",
        parentLinkName: "arm",
      },
    ]);
  });
});
