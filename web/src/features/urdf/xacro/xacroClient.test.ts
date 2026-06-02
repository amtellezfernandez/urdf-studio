/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { collectXacroSupportFiles } from "./xacroClient";

const createFile = (name: string, relativePath?: string): File => {
  const file = new File(["content"], name, { type: "text/plain" });
  if (relativePath) {
    Object.defineProperty(file, "webkitRelativePath", {
      value: relativePath,
      configurable: true,
    });
  }
  return file;
};

describe("collectXacroSupportFiles", () => {
  it("includes trans support files used by xacro includes", () => {
    const files = [
      createFile("main.xacro", "robot/urdf/main.xacro"),
      createFile("main.trans", "robot/urdf/main.trans"),
      createFile("package.xml", "robot/package.xml"),
      createFile("mesh.stl", "robot/meshes/mesh.stl"),
    ];

    const supportFiles = collectXacroSupportFiles(files);
    const supportPaths = supportFiles.map(
      (file) => (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    );

    expect(supportPaths).toContain("robot/urdf/main.xacro");
    expect(supportPaths).toContain("robot/urdf/main.trans");
    expect(supportPaths).toContain("robot/package.xml");
    expect(supportPaths).not.toContain("robot/meshes/mesh.stl");
  });
});

