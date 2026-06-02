import { describe, expect, it } from "vitest";
import {
  buildAlphabeticalLinkSections,
  buildMeshGroupedLinkSections,
} from "@/features/layout/linkSidebarGrouping";

describe("linkSidebarGrouping", () => {
  it("builds mesh-grouped link sections from visual mesh filenames", () => {
    const sections = buildMeshGroupedLinkSections({
      analysis: {
        isValid: true,
        linkDataByName: {
          arm_left: {
            visuals: [
              {
                geometry: {
                  type: "mesh",
                  params: { filename: "meshes/arm.stl" },
                },
              },
            ],
            collisions: [],
          },
          arm_right: {
            visuals: [
              {
                geometry: {
                  type: "mesh",
                  params: { filename: "meshes/arm.stl" },
                },
              },
            ],
            collisions: [],
          },
          camera_mount: {
            visuals: [],
            collisions: [
              {
                geometry: {
                  type: "mesh",
                  params: { filename: "meshes/camera_mount.stl" },
                },
              },
            ],
          },
          base_link: {
            visuals: [],
            collisions: [],
          },
        },
      } as never,
      filteredLinks: ["camera_mount", "arm_right", "base_link", "arm_left"],
    });

    expect(sections).toEqual([
      {
        id: "mesh:arm.stl",
        label: "arm.stl",
        items: ["arm_left", "arm_right"],
      },
      {
        id: "mesh:camera_mount.stl",
        label: "camera_mount.stl",
        items: ["camera_mount"],
      },
      {
        id: "mesh:Other",
        label: "Other",
        items: ["base_link"],
      },
    ]);
  });

  it("builds one alphabetical section with sorted links", () => {
    expect(buildAlphabeticalLinkSections(["wheel_right", "arm_left", "base_link"])).toEqual([
      {
        id: "alpha:a-z",
        label: "A-Z",
        items: ["arm_left", "base_link", "wheel_right"],
      },
    ]);
  });
});
