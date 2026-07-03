/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { analyzeLoadedUrdfContent } from "@/features/urdf/loader/loadedUrdfAnalysis";

describe("loadedUrdfAnalysis", () => {
  const fixtures = {
    singleToolUrdf: `<?xml version="1.0"?>
<robot name="single_tool">
  <link name="base_link" />
  <link name="arm_link" />
  <link name="tool_tip" />
  <joint name="arm_joint" type="revolute">
    <parent link="base_link" />
    <child link="arm_link" />
    <limit lower="-1" upper="1" effort="10" velocity="1" />
  </joint>
  <joint name="tool_joint" type="revolute">
    <parent link="arm_link" />
    <child link="tool_tip" />
    <limit lower="-1" upper="1" effort="10" velocity="1" />
  </joint>
</robot>`,
  };

  it("analyzes valid URDF content and resolves a single auto end-effector", () => {
    const result = analyzeLoadedUrdfContent({
      meshFiles: {},
      packageRoots: {},
      parsedContent: fixtures.singleToolUrdf,
      urdfBasePath: "",
    });

    expect(result.validationError).toBeNull();
    expect(result.autoEndEffector).toBe("tool_tip");
    expect(result.analysis.linkNames).toEqual(
      expect.arrayContaining(["base_link", "arm_link", "tool_tip"])
    );
    expect(result.issueSummary.hasIssues).toBe(false);
  });

  it("reports missing mesh references through the shared issue summary", () => {
    const result = analyzeLoadedUrdfContent({
      meshFiles: {},
      packageRoots: {},
      parsedContent: `<?xml version="1.0"?>
<robot name="missing_mesh">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/base.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      urdfBasePath: "",
    });

    expect(result.issueSummary.unmatchedRefs).toEqual(["meshes/base.stl"]);
    expect(result.issueSummary.hasIssues).toBe(true);
  });

  it("surfaces invalid XML as a validation error", () => {
    const result = analyzeLoadedUrdfContent({
      meshFiles: {},
      packageRoots: {},
      parsedContent: '<robot name="broken"><link name="base_link"></robot>',
      urdfBasePath: "",
    });

    expect(result.validationError).toBeTruthy();
    expect(result.autoEndEffector).toBeNull();
    expect(result.issueSummary.hasIssues).toBe(true);
  });
});
