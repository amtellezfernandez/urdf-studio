import { describe, expect, it } from "vitest";
import {
  LINK_SIDEBAR_GROUPING_DEFAULTS,
  extractMeshFilename,
  resolveLinkMeshGroupLabel,
} from "@/features/layout/linkSidebarGroupingHelpers";

describe("linkSidebarGroupingHelpers", () => {
  it("extracts a mesh filename from unix and windows-style paths", () => {
    expect(extractMeshFilename("meshes/arm.stl")).toBe("arm.stl");
    expect(extractMeshFilename("meshes\\tool\\gripper.obj")).toBe("gripper.obj");
    expect(extractMeshFilename("base_link")).toBe("base_link");
  });

  it("resolves mesh labels from visuals first and collisions second", () => {
    const analysis = {
      isValid: true,
      linkDataByName: {
        visual_link: {
          visuals: [{ geometry: { type: "mesh", params: { filename: "meshes/arm.stl" } } }],
          collisions: [{ geometry: { type: "mesh", params: { filename: "meshes/arm_collision.stl" } } }],
        },
        collision_link: {
          visuals: [],
          collisions: [{ geometry: { type: "mesh", params: { filename: "meshes/camera_mount.stl" } } }],
        },
        empty_link: {
          visuals: [],
          collisions: [],
        },
      },
    } as never;

    expect(resolveLinkMeshGroupLabel(analysis, "visual_link")).toBe("arm.stl");
    expect(resolveLinkMeshGroupLabel(analysis, "collision_link")).toBe("camera_mount.stl");
    expect(resolveLinkMeshGroupLabel(analysis, "empty_link")).toBe(
      LINK_SIDEBAR_GROUPING_DEFAULTS.meshGroupLabel
    );
    expect(resolveLinkMeshGroupLabel(null, "visual_link")).toBe(
      LINK_SIDEBAR_GROUPING_DEFAULTS.meshGroupLabel
    );
  });
});
