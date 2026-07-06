/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { deriveLocalSourceLabel } from "@/app/pages/index/coreFolderUploadScreenState";

const createFile = ({
  name,
  relativePath,
}: {
  name: string;
  relativePath?: string;
}): File => {
  const file = new File(["content"], name);
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

describe("deriveLocalSourceLabel", () => {
  it("uses the selected folder root from a browser relative path", () => {
    expect(
      deriveLocalSourceLabel([
        createFile({
          name: "robot.urdf",
          relativePath: "workspace\\robots\\robot.urdf",
        }),
        createFile({
          name: "mesh.stl",
          relativePath: "workspace\\meshes\\mesh.stl",
        }),
      ])
    ).toBe("workspace");
  });

  it("falls back to the file name for a single direct file", () => {
    expect(deriveLocalSourceLabel([createFile({ name: "robot.urdf" })])).toBe(
      "robot.urdf"
    );
  });
});
