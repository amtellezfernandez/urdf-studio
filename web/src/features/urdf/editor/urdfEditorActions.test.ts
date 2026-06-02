/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  changeJointEffort,
  changeJointOrigin,
} from "@/features/urdf/editor/urdfEditorActions";

const BASE_URDF = `<?xml version="1.0" encoding="UTF-8"?>
<robot name="demo">
  <link name="base_link"/>
  <link name="tool_link"/>
  <joint name="mount_joint" type="fixed">
    <parent link="base_link"/>
    <child link="tool_link"/>
  </joint>
</robot>`;

describe("urdfEditorActions", () => {
  it("adds a missing origin when updating a joint origin", () => {
    const result = changeJointOrigin(
      BASE_URDF,
      "mount_joint",
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6]
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain('<origin xyz="0.1 0.2 0.3" rpy="0.4 0.5 0.6"/>');
  });

  it("fails cleanly when the target joint is missing", () => {
    const result = changeJointOrigin(
      BASE_URDF,
      "missing_joint",
      [0, 0, 0],
      [0, 0, 0]
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unable to update origin for joint "missing_joint"');
    expect(result.content).toBe(BASE_URDF);
  });

  it("adds effort to a joint without an existing limit", () => {
    const result = changeJointEffort(BASE_URDF, "mount_joint", 12.5);

    expect(result.success).toBe(true);
    expect(result.content).toContain('<limit effort="12.5"/>');
  });

  it("updates effort while preserving other limit attributes", () => {
    const urdf = `<?xml version="1.0" encoding="UTF-8"?>
<robot name="demo">
  <link name="base_link"/>
  <link name="tool_link"/>
  <joint name="mount_joint" type="revolute">
    <parent link="base_link"/>
    <child link="tool_link"/>
    <limit lower="-1" upper="1" velocity="2" effort="4"/>
  </joint>
</robot>`;

    const result = changeJointEffort(urdf, "mount_joint", 6);

    expect(result.success).toBe(true);
    expect(result.content).toContain('lower="-1"');
    expect(result.content).toContain('upper="1"');
    expect(result.content).toContain('velocity="2"');
    expect(result.content).toContain('effort="6"');
  });

  it("removes effort without removing other limit attributes", () => {
    const urdf = `<?xml version="1.0" encoding="UTF-8"?>
<robot name="demo">
  <link name="base_link"/>
  <link name="tool_link"/>
  <joint name="mount_joint" type="revolute">
    <parent link="base_link"/>
    <child link="tool_link"/>
    <limit lower="-1" upper="1" velocity="2" effort="4"/>
  </joint>
</robot>`;

    const result = changeJointEffort(urdf, "mount_joint", null);

    expect(result.success).toBe(true);
    expect(result.content).toContain('lower="-1"');
    expect(result.content).toContain('upper="1"');
    expect(result.content).toContain('velocity="2"');
    expect(result.content).not.toContain("effort=");
  });
});
