/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { resolveFolderUrdfSource } from "@/features/urdf/loader/urdfFolderSource";
import type { BrowserFileWithRelativePath } from "@/shared/lib/browserFilePaths";

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

describe("urdfFolderSource", () => {
  it("rejects folders without a URDF or Xacro source", async () => {
    await expect(
      resolveFolderUrdfSource([
        createFile({ content: "mesh", name: "part.stl", relativePath: "meshes/part.stl" }),
      ] as unknown as FileList)
    ).rejects.toThrow("No URDF or Xacro file found");
  });

  it("selects the first URDF and includes all URDF documents", async () => {
    const result = await resolveFolderUrdfSource([
      createFile({
        content: '<robot name="main" />',
        name: "main.urdf",
        relativePath: "/workspace/main.urdf",
      }),
      createFile({
        content: '<robot name="secondary" />',
        name: "secondary.urdf",
        relativePath: "workspace/secondary.urdf",
      }),
    ] as unknown as FileList);

    expect(result.expandedFromXacro).toBe(false);
    expect(result.filename).toBe("main.urdf");
    expect(result.relativePath).toBe("workspace/main.urdf");
    expect(result.urdfContent).toBe('<robot name="main" />');
    expect(result.urdfDocuments).toEqual({
      "workspace/main.urdf": '<robot name="main" />',
      "workspace/secondary.urdf": '<robot name="secondary" />',
    });
    expect(result.warnings).toEqual([
      "Multiple URDF files found (2), using only the first one: main.urdf",
    ]);
  });

  it("expands Xacro sources with injected expansion runtime", async () => {
    const expandXacroFile = vi.fn(async () => ({ urdf: '<robot name="expanded" />' }));
    const result = await resolveFolderUrdfSource(
      [
        createFile({
          content: "<robot />",
          name: "robot.urdf.xacro",
          relativePath: "robots/robot.urdf.xacro",
        }),
        createFile({
          content: "<package><name>robots</name></package>",
          name: "package.xml",
          relativePath: "package.xml",
        }),
      ] as unknown as FileList,
      { expandXacroFile }
    );

    expect(expandXacroFile).toHaveBeenCalledWith(
      "robots/robot.urdf.xacro",
      expect.arrayContaining([expect.objectContaining({ name: "robot.urdf.xacro" })])
    );
    expect(result.expandedFromXacro).toBe(true);
    expect(result.filename).toBe("robot.urdf");
    expect(result.relativePath).toBe("robots/robot.urdf");
    expect((result.file as BrowserFileWithRelativePath).webkitRelativePath).toBe(
      "robots/robot.urdf"
    );
    expect(result.urdfDocuments).toEqual({
      "robots/robot.urdf": '<robot name="expanded" />',
    });
  });
});
