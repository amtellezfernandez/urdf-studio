/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { validateJointLinkReassignment } from "@/shared/lib/urdfCore";

const URDF = `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link" />
  <link name="link_1" />
  <link name="link_2" />
  <link name="tool_link" />
  <joint name="joint_1" type="revolute">
    <parent link="base_link" />
    <child link="link_1" />
  </joint>
  <joint name="joint_2" type="revolute">
    <parent link="link_1" />
    <child link="link_2" />
  </joint>
  <joint name="joint_3" type="fixed">
    <parent link="link_2" />
    <child link="tool_link" />
  </joint>
</robot>`;

describe("validateJointLinkReassignment", () => {
  it("accepts a valid parent/child reassignment", () => {
    const result = validateJointLinkReassignment(
      URDF,
      "joint_3",
      "base_link",
      "tool_link"
    );
    expect(result.valid).toBe(true);
  });

  it("rejects identical parent and child links", () => {
    const result = validateJointLinkReassignment(
      URDF,
      "joint_2",
      "base_link",
      "base_link"
    );
    expect(result.valid).toBe(false);
    if ("error" in result) {
      expect(result.error).toMatch(/must be different/i);
    }
  });

  it("rejects updates that create a cycle", () => {
    const result = validateJointLinkReassignment(
      URDF,
      "joint_1",
      "link_2",
      "link_1"
    );
    expect(result.valid).toBe(false);
    if ("error" in result) {
      expect(result.error).toMatch(/cycle/i);
    }
  });

  it("rejects updates that create multiple parents for one child link", () => {
    const result = validateJointLinkReassignment(
      URDF,
      "joint_3",
      "base_link",
      "link_2"
    );
    expect(result.valid).toBe(false);
    if ("error" in result) {
      expect(result.error).toMatch(/multiple parent/i);
    }
  });
});
