/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  createExpandedXacroUrdfFile,
  createLoadedUrdfFile,
} from "@/features/urdf/loader/urdfFileFactory";
import type { BrowserFileWithRelativePath } from "@/shared/lib/browserFilePaths";

describe("urdfFileFactory", () => {
  it("creates stable viz URDF file names", async () => {
    const file = createLoadedUrdfFile("<robot />", "robot.urdf");

    expect(file.name).toBe("viz-robot.urdf");
    expect(file.type).toBe("application/xml");
    expect(await file.text()).toBe("<robot />");
  });

  it("adds timestamps before the URDF extension", () => {
    const file = createLoadedUrdfFile("<robot />", "robot.urdf", 1234);

    expect(file.name).toBe("viz-robot_1234.urdf");
  });

  it("creates expanded Xacro URDF files with a browser relative path", async () => {
    const file = createExpandedXacroUrdfFile({
      content: "<robot />",
      filename: "robot.urdf",
      relativePath: "robots/robot.urdf",
    });

    expect(file.name).toBe("robot.urdf");
    expect((file as BrowserFileWithRelativePath).webkitRelativePath).toBe(
      "robots/robot.urdf"
    );
    expect(await file.text()).toBe("<robot />");
  });
});
