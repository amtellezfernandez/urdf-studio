import { describe, expect, it } from "vitest";
import type { LinkData } from "@/shared/lib/urdfBrowser";

import {
  canAddMeshCollisionForLink,
  isEntireLinkSectionBatchSelected,
  linkHasMeshVisual,
  resolveLinkBrowserEmptyState,
  resolveLinkStatusSummary,
  resolveVisibleLinkNames,
} from "@/features/layout/linkBrowserViewHelpers";

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

describe("linkBrowserViewHelpers", () => {
  it("resolves the empty state message", () => {
    expect(resolveLinkBrowserEmptyState("arm")).toBe("No links match the search");
    expect(resolveLinkBrowserEmptyState("")).toBe("No links available");
  });

  it("keeps only the end-effector link visible when a section is collapsed", () => {
    expect(
      resolveVisibleLinkNames({
        effectiveEndEffectorLink: "tool0",
        isCollapsed: true,
        sectionItemNames: ["base", "tool0", "wrist"],
      })
    ).toEqual(["tool0"]);
    expect(
      resolveVisibleLinkNames({
        effectiveEndEffectorLink: "tool0",
        isCollapsed: false,
        sectionItemNames: ["base", "tool0", "wrist"],
      })
    ).toEqual(["base", "tool0", "wrist"]);
  });

  it("checks full section batch selection", () => {
    expect(
      isEntireLinkSectionBatchSelected({
        sectionItemNames: ["a", "b"],
        selectedBatchLinks: new Set(["a", "b"]),
      })
    ).toBe(true);
    expect(
      isEntireLinkSectionBatchSelected({
        sectionItemNames: ["a", "b"],
        selectedBatchLinks: new Set(["a"]),
      })
    ).toBe(false);
  });

  it("detects mesh visuals and manual collision eligibility", () => {
    const linkData = createMeshLinkData("meshes/tool.stl");
    expect(linkHasMeshVisual(linkData)).toBe(true);
    expect(canAddMeshCollisionForLink({ hasUrdfCollision: false, linkData })).toBe(true);
    expect(canAddMeshCollisionForLink({ hasUrdfCollision: true, linkData })).toBe(false);
  });

  it("builds the compact status summary", () => {
    expect(
      resolveLinkStatusSummary({
        hasEeStatus: true,
        isCollisionMerged: false,
        isCollisionSimplified: true,
      })
    ).toEqual({
      label: "Simp+EE",
      title: "Collision simplification enabled • Marked as end effector",
    });
  });
});
