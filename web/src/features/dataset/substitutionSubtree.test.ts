/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { applySubstitutionSubtree } from "@/features/dataset/substitutionSubtree";

describe("applySubstitutionSubtree", () => {
  const HOST_ROOT_LINK = "arm_mount";
  const REPLACEMENT_ROOT_LINK = "tool_base";

  it("replaces a host subtree with a replacement subtree and rewrites relative mesh paths", () => {
    const hostUrdf = `<?xml version="1.0"?>
<robot name="host_robot">
  <link name="base_link"/>
  <joint name="base_to_arm" type="fixed">
    <parent link="base_link"/>
    <child link="arm_mount"/>
  </joint>
  <link name="arm_mount"/>
  <joint name="arm_to_tool" type="fixed">
    <parent link="arm_mount"/>
    <child link="tool_link"/>
  </joint>
  <link name="tool_link"/>
</robot>`;
    const replacementUrdf = `<?xml version="1.0"?>
<robot name="replacement_robot">
  <link name="tool_base">
    <visual>
      <geometry>
        <mesh filename="meshes/tool.stl"/>
      </geometry>
    </visual>
  </link>
  <joint name="tool_base_to_tip" type="fixed">
    <parent link="tool_base"/>
    <child link="tool_tip"/>
  </joint>
  <link name="tool_tip"/>
</robot>`;

    const result = applySubstitutionSubtree({
      hostUrdfContent: hostUrdf,
      replacementUrdfContent: replacementUrdf,
      hostRootLink: HOST_ROOT_LINK,
      replacementRootLink: REPLACEMENT_ROOT_LINK,
      replacementUrdfPath: "github/acme/replacement/main/robot/tool.urdf",
    });

    expect(result.urdfContent).not.toContain('link name="arm_mount"');
    expect(result.urdfContent).not.toContain('link name="tool_link"');
    expect(result.urdfContent).toContain('child link="tool_base"');
    expect(result.urdfContent).toContain(
      'mesh filename="github/acme/replacement/main/robot/meshes/tool.stl"'
    );
    expect(result.preview).toMatchObject({
      hostRootLink: HOST_ROOT_LINK,
      replacementRootLink: REPLACEMENT_ROOT_LINK,
      replacedLinkCount: 2,
      replacedJointCount: 2,
      importedLinkCount: 2,
      importedJointCount: 1,
    });
  });

  it("imports referenced materials, transmissions, and gazebo blocks for the replacement subtree", () => {
    const hostUrdf = `<?xml version="1.0"?>
<robot name="host_robot">
  <link name="base_link"/>
  <joint name="base_to_arm" type="fixed">
    <parent link="base_link"/>
    <child link="arm_mount"/>
  </joint>
  <link name="arm_mount"/>
  <material name="host_blue">
    <color rgba="0 0 1 1"/>
  </material>
</robot>`;
    const replacementUrdf = `<?xml version="1.0"?>
<robot name="replacement_robot">
  <material name="host_blue">
    <color rgba="1 0 0 1"/>
  </material>
  <link name="tool_base">
    <visual>
      <geometry>
        <mesh filename="meshes/tool.stl"/>
      </geometry>
      <material name="host_blue"/>
    </visual>
  </link>
  <joint name="tool_base_to_tip" type="fixed">
    <parent link="tool_base"/>
    <child link="tool_tip"/>
  </joint>
  <link name="tool_tip"/>
  <transmission name="tool_trans">
    <joint name="tool_base_to_tip"/>
  </transmission>
  <gazebo reference="tool_base">
    <material>Gazebo/Red</material>
  </gazebo>
</robot>`;

    const result = applySubstitutionSubtree({
      hostUrdfContent: hostUrdf,
      replacementUrdfContent: replacementUrdf,
      hostRootLink: HOST_ROOT_LINK,
      replacementRootLink: REPLACEMENT_ROOT_LINK,
      replacementUrdfPath: "replacement/tool.urdf",
    });

    expect(result.preview.importedMaterialCount).toBe(1);
    expect(result.preview.importedTransmissionCount).toBe(1);
    expect(result.preview.importedGazeboCount).toBe(1);
    expect(result.preview.renamedMaterials.length).toBe(1);
    expect(result.urdfContent).toContain('material name="host_blue__tool_base_1"');
    expect(result.urdfContent).toContain('joint name="tool_base_to_tip"');
    expect(result.urdfContent).toContain('<transmission name="tool_trans">');
    expect(result.urdfContent).toContain('<gazebo reference="tool_base">');
  });

  it("renames imported links and joints when they collide with host names", () => {
    const hostUrdf = `<?xml version="1.0"?>
<robot name="host_robot">
  <link name="base_link"/>
  <joint name="base_to_arm" type="fixed">
    <parent link="base_link"/>
    <child link="arm_mount"/>
  </joint>
  <link name="arm_mount"/>
  <link name="tool_tip"/>
</robot>`;
    const replacementUrdf = `<?xml version="1.0"?>
<robot name="replacement_robot">
  <link name="arm_mount"/>
  <joint name="base_to_arm" type="fixed">
    <parent link="arm_mount"/>
    <child link="tool_tip"/>
  </joint>
  <link name="tool_tip"/>
</robot>`;

    const result = applySubstitutionSubtree({
      hostUrdfContent: hostUrdf,
      replacementUrdfContent: replacementUrdf,
      hostRootLink: HOST_ROOT_LINK,
      replacementRootLink: HOST_ROOT_LINK,
      replacementUrdfPath: "replacement/tool.urdf",
    });

    expect(result.preview.renamedLinks.length).toBeGreaterThan(0);
    expect(result.preview.renamedJoints.length).toBeGreaterThan(0);
    expect(result.urdfContent).toContain("tool_tip__arm_mount_1");
    expect(result.urdfContent).toContain("base_to_arm__arm_mount_1");
  });

  it("rewrites replacement package mesh paths using the matching staged package root", () => {
    const hostUrdf = `<?xml version="1.0"?>
<robot name="host_robot">
  <link name="base_link"/>
  <joint name="base_to_arm" type="fixed">
    <parent link="base_link"/>
    <child link="arm_mount"/>
  </joint>
  <link name="arm_mount"/>
</robot>`;
    const replacementUrdf = `<?xml version="1.0"?>
<robot name="replacement_robot">
  <link name="tool_base">
    <visual>
      <geometry>
        <mesh filename="package://tool_pkg/meshes/tool.stl"/>
      </geometry>
    </visual>
  </link>
</robot>`;
    const matchingPackageRoot = "staged/replacement/tool_pkg";
    const fallbackPackageRoot = "staged/other/tool_pkg";
    const replacementUrdfPath = `${matchingPackageRoot}/urdf/tool.urdf`;

    const result = applySubstitutionSubtree({
      hostUrdfContent: hostUrdf,
      replacementUrdfContent: replacementUrdf,
      hostRootLink: HOST_ROOT_LINK,
      replacementRootLink: REPLACEMENT_ROOT_LINK,
      replacementUrdfPath,
      packageRoots: {
        tool_pkg: [fallbackPackageRoot, matchingPackageRoot],
      },
    });

    expect(result.preview.rewrittenMeshPaths).toEqual([
      {
        from: "package://tool_pkg/meshes/tool.stl",
        to: `${matchingPackageRoot}/meshes/tool.stl`,
      },
    ]);
    expect(result.urdfContent).toContain(`mesh filename="${matchingPackageRoot}/meshes/tool.stl"`);
  });
});
