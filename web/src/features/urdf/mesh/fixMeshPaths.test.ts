/** @vitest-environment jsdom */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { fixMeshPaths } from "@/shared/lib/urdfBrowser";

const TEST_BOT_PACKAGE_NAME = "TestBot_description";
const DUPE_MESHES_PACKAGE_NAME = "DupeMeshes_description";
const MIXED_MESHES_PACKAGE_NAME = "MixedMeshes_description";

const BASE_URDF = (meshPath: string) => `<?xml version="1.0"?>
<robot name="TestBot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="${meshPath}" />
      </geometry>
    </visual>
  </link>
</robot>`;

describe("fixMeshPaths", () => {
  const consoleError = console.error;

  beforeAll(() => {
    console.error = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    console.error = consoleError;
  });

  it("returns unchanged content when no mesh elements exist", () => {
    const urdf = `<?xml version="1.0"?><robot name="NoMeshes"></robot>`;
    const result = fixMeshPaths(urdf);
    expect(result.urdfContent).toContain('<robot name="NoMeshes"');
    expect(result.corrections.length).toBe(0);
  });

  it("skips meshes with empty filename attributes", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="EmptyMesh">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="" />
      </geometry>
    </visual>
  </link>
</robot>`;
    const result = fixMeshPaths(urdf);
    expect(result.corrections.length).toBe(0);
    expect(result.urdfContent).toContain('mesh filename=""');
  });

  it("preserves package:// scheme and normalizes path segments", () => {
    const urdf = BASE_URDF("package://test_bot/meshes/../arm.stl");
    const result = fixMeshPaths(urdf);
    expect(result.urdfContent).toContain('mesh filename="package://test_bot/arm.stl"');
  });

  it("preserves file:// absolute paths", () => {
    const urdf = BASE_URDF("file:///home/user/meshes/arm.stl");
    const result = fixMeshPaths(urdf);
    expect(result.urdfContent).toContain('mesh filename="file:///home/user/meshes/arm.stl"');
  });

  it("normalizes file:// relative paths", () => {
    const urdf = BASE_URDF("file://meshes/../arm.stl");
    const result = fixMeshPaths(urdf);
    expect(result.urdfContent).toContain('mesh filename="file://arm.stl"');
  });

  it("normalizes relative mesh paths to package:// with detected package name", () => {
    const urdf = BASE_URDF("meshes/arm.stl");
    const result = fixMeshPaths(urdf);
    expect(result.urdfContent).toContain(
      `mesh filename="package://${TEST_BOT_PACKAGE_NAME}/meshes/arm.stl"`
    );
  });

  it("removes duplicate slashes in package:// paths", () => {
    const urdf = BASE_URDF("package://test_bot//meshes///arm.stl");
    const result = fixMeshPaths(urdf);
    expect(result.urdfContent).toContain('mesh filename="package://test_bot/meshes/arm.stl"');
  });

  it("converts Windows-style paths to package://", () => {
    const urdf = BASE_URDF("meshes\\arm.stl");
    const result = fixMeshPaths(urdf);
    expect(result.urdfContent).toContain(
      `mesh filename="package://${TEST_BOT_PACKAGE_NAME}/meshes/arm.stl"`
    );
  });

  it("converts absolute Windows paths to package://", () => {
    const urdf = BASE_URDF("C:\\robot\\meshes\\arm.stl");
    const result = fixMeshPaths(urdf);
    expect(result.urdfContent).toContain(
      `mesh filename="package://${TEST_BOT_PACKAGE_NAME}/meshes/arm.stl"`
    );
  });

  it("keeps absolute file:// paths intact even with duplicate slashes", () => {
    const urdf = BASE_URDF("file:////home/user//meshes///arm.stl");
    const result = fixMeshPaths(urdf);
    expect(result.urdfContent).toContain('mesh filename="file:///home/user/meshes/arm.stl"');
  });

  it("fixes duplicate meshes consistently (visual + collision)", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="DupeMeshes">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/arm.stl" />
      </geometry>
    </visual>
    <collision>
      <geometry>
        <mesh filename="meshes/arm.stl" />
      </geometry>
    </collision>
  </link>
</robot>`;
    const result = fixMeshPaths(urdf);
    const expected = `mesh filename="package://${DUPE_MESHES_PACKAGE_NAME}/meshes/arm.stl"`;
    expect(result.urdfContent.match(new RegExp(expected, "g"))?.length).toBe(2);
    expect(result.corrections.length).toBe(2);
  });

  it("reports corrections with context", () => {
    const urdf = BASE_URDF("/abs/meshes/arm.stl");
    const result = fixMeshPaths(urdf);
    expect(result.corrections.length).toBe(1);
    expect(result.corrections[0].linkName).toBe("base_link");
    expect(result.corrections[0].element).toBe("visual");
  });

  it("handles mixed visual/collision mesh paths independently", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="MixedMeshes">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/vis.stl" />
      </geometry>
    </visual>
    <collision>
      <geometry>
        <mesh filename="file://meshes/../col.stl" />
      </geometry>
    </collision>
  </link>
</robot>`;
    const result = fixMeshPaths(urdf);
    expect(result.urdfContent).toContain(
      `mesh filename="package://${MIXED_MESHES_PACKAGE_NAME}/meshes/vis.stl"`
    );
    expect(result.urdfContent).toContain('mesh filename="file://col.stl"');
  });

  it("preserves package:// URIs with no trailing path", () => {
    const urdf = BASE_URDF("package://test_bot");
    const result = fixMeshPaths(urdf);
    expect(result.urdfContent).toContain('mesh filename="package://test_bot"');
  });

  it("returns original content and no corrections for malformed URDF", () => {
    const badUrdf = "<robot><link></robot>";
    const result = fixMeshPaths(badUrdf);
    expect(result.urdfContent).toBe(badUrdf);
    expect(result.corrections.length).toBe(0);
  });

  it("treats multiple <robot> elements as invalid and makes no changes", () => {
    const urdf = `<?xml version="1.0"?>
<root>
  <robot name="First">
    <link name="base_link">
      <visual><geometry><mesh filename="meshes/first.stl"/></geometry></visual>
    </link>
  </robot>
  <robot name="Second">
    <link name="base_link_2">
      <visual><geometry><mesh filename="meshes/second.stl"/></geometry></visual>
    </link>
  </robot>
</root>`;
    const result = fixMeshPaths(urdf);
    expect(result.urdfContent).toBe(urdf);
    expect(result.corrections.length).toBe(0);
  });
});
