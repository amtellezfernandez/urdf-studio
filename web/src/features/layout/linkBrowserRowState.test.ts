import { describe, expect, it } from "vitest";
import type { LinkData } from "@/shared/lib/urdfBrowser";
import { resolveLinkBrowserRowState } from "@/features/layout/linkBrowserRowState";

const createMeshLinkData = (filename: string): LinkData =>
  ({
    name: "mesh_link",
    visuals: [
      {
        geometry: {
          type: "mesh",
          params: { filename },
        },
      },
    ],
    collisions: [],
  }) as unknown as LinkData;

describe("linkBrowserRowState", () => {
  it("derives merged collision and end-effector status", () => {
    const state = resolveLinkBrowserRowState({
      effectiveEndEffectorLink: "link_a",
      linkData: createMeshLinkData("meshes/link_a.stl"),
      linkName: "link_a",
      linksWithCollisionSet: new Set(["link_a"]),
      mergedLinkSet: new Set(["link_a"]),
      simplifiedLinkSet: new Set(["link_a"]),
      voxelDerivedInertialLinkSet: new Set(),
    });

    expect(state.hasUrdfCollision).toBe(true);
    expect(state.isCollisionMerged).toBe(true);
    expect(state.isCollisionSimplified).toBe(true);
    expect(state.canAddMeshCollision).toBe(false);
    expect(state.hasEeStatus).toBe(true);
    expect(state.statusSummary).toEqual({
      label: "Mrg+EE",
      title: "Merged collision active • Marked as end effector",
    });
  });

  it("allows adding mesh collision only when the link has a mesh visual and no URDF collision", () => {
    const state = resolveLinkBrowserRowState({
      effectiveEndEffectorLink: null,
      linkData: createMeshLinkData("meshes/link_b.stl"),
      linkName: "link_b",
      linksWithCollisionSet: new Set(),
      mergedLinkSet: new Set(),
      simplifiedLinkSet: new Set(),
      voxelDerivedInertialLinkSet: new Set(["link_b"]),
    });

    expect(state.hasUrdfCollision).toBe(false);
    expect(state.canAddMeshCollision).toBe(true);
    expect(state.hasVoxelDerivedInertial).toBe(true);
    expect(state.statusSummary).toEqual({ label: "", title: "" });
  });
});
