/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  buildPackageRootsFromFiles,
  extractMeshReferencesFromUrdfContent,
  getBasePathFromRelativePath,
  readUrdfDocumentsFromFiles,
} from "@/features/urdf/loader/urdfLoaderFiles";

const createFile = ({
  content,
  name,
  relativePath,
}: {
  content: string;
  name: string;
  relativePath?: string;
}): File => {
  const file = new File([content], name);
  if (relativePath) {
    Object.defineProperty(file, "webkitRelativePath", {
      configurable: true,
      enumerable: true,
      value: relativePath,
      writable: false,
    });
  }
  return file;
};

describe("urdfLoaderFiles", () => {
  it("derives base paths from normalized relative paths", () => {
    expect(getBasePathFromRelativePath("robot.urdf")).toBe("");
    expect(getBasePathFromRelativePath("/workspace/robot/main.urdf")).toBe("workspace/robot");
    expect(getBasePathFromRelativePath("workspace//robot/main.urdf")).toBe("workspace/robot");
  });

  it("reads URDF and Xacro documents using normalized upload paths", async () => {
    const documents = await readUrdfDocumentsFromFiles([
      createFile({
        content: '<robot name="a" />',
        name: "main.urdf",
        relativePath: "/workspace/main.urdf",
      }),
      createFile({
        content: '<robot name="b" />',
        name: "arm.xacro",
        relativePath: "workspace/macros/arm.xacro",
      }),
      createFile({
        content: "mesh",
        name: "part.stl",
        relativePath: "workspace/meshes/part.stl",
      }),
    ]);

    expect(documents).toEqual({
      "workspace/macros/arm.xacro": '<robot name="b" />',
      "workspace/main.urdf": '<robot name="a" />',
    });
  });

  it("builds package roots from uploaded package.xml files", async () => {
    const packageRoots = await buildPackageRootsFromFiles([
      createFile({
        content: "<package><name>robot_description</name></package>",
        name: "package.xml",
        relativePath: "src/robot_description/package.xml",
      }),
      createFile({
        content: "mesh",
        name: "base.stl",
        relativePath: "src/robot_description/meshes/base.stl",
      }),
    ]);

    expect(packageRoots.robot_description).toEqual(["src/robot_description"]);
  });

  it("extracts raw mesh references from URDF content", () => {
    const refs = extractMeshReferencesFromUrdfContent(`<?xml version="1.0"?>
<robot name="TestBot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://pkg/meshes/a.stl" />
      </geometry>
    </visual>
    <collision>
      <geometry>
        <mesh filename="file:///abs/b.stl" />
      </geometry>
    </collision>
    <visual>
      <geometry>
        <mesh filename="meshes/c.stl" />
      </geometry>
    </visual>
  </link>
</robot>`);

    expect(refs).toEqual(
      expect.arrayContaining(["package://pkg/meshes/a.stl", "file:///abs/b.stl", "meshes/c.stl"])
    );
  });
});
