import { describe, expect, it } from "vitest";

import { buildLinkCollisionGeometryReferences } from "@/features/viewer/inertiaGeometryReference";

const UNIT_CUBE_STL = `solid cube
facet normal 0 0 1
 outer loop
  vertex 0 0 1
  vertex 1 0 1
  vertex 1 1 1
 endloop
endfacet
facet normal 0 0 1
 outer loop
  vertex 0 0 1
  vertex 1 1 1
  vertex 0 1 1
 endloop
endfacet
facet normal 0 0 -1
 outer loop
  vertex 0 0 0
  vertex 1 1 0
  vertex 1 0 0
 endloop
endfacet
facet normal 0 0 -1
 outer loop
  vertex 0 0 0
  vertex 0 1 0
  vertex 1 1 0
 endloop
endfacet
facet normal 0 1 0
 outer loop
  vertex 0 1 0
  vertex 0 1 1
  vertex 1 1 1
 endloop
endfacet
facet normal 0 1 0
 outer loop
  vertex 0 1 0
  vertex 1 1 1
  vertex 1 1 0
 endloop
endfacet
facet normal 0 -1 0
 outer loop
  vertex 0 0 0
  vertex 1 0 1
  vertex 0 0 1
 endloop
endfacet
facet normal 0 -1 0
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 1 0 1
 endloop
endfacet
facet normal 1 0 0
 outer loop
  vertex 1 0 0
  vertex 1 1 1
  vertex 1 0 1
 endloop
endfacet
facet normal 1 0 0
 outer loop
  vertex 1 0 0
  vertex 1 1 0
  vertex 1 1 1
 endloop
endfacet
facet normal -1 0 0
 outer loop
  vertex 0 0 0
  vertex 0 0 1
  vertex 0 1 1
 endloop
endfacet
facet normal -1 0 0
 outer loop
  vertex 0 0 0
  vertex 0 1 1
  vertex 0 1 0
 endloop
endfacet
endsolid cube`;

describe("buildLinkCollisionGeometryReferences", () => {
  it("builds primitive references directly from collision primitives", async () => {
    const references = await buildLinkCollisionGeometryReferences({
      linkDataByName: {
        base_link: {
          name: "base_link",
          visuals: [],
          inertial: null,
          collisions: [
            {
              origin: { xyz: [1, 2, 3], rpy: [0, 0, 0] },
              geometry: { type: "box", params: { size: "2 4 6" } },
            },
          ],
        },
      },
      meshFiles: {},
    });

    const reference = references.get("base_link");
    expect(reference?.source).toBe("primitive");
    expect(reference?.primitiveCount).toBe(1);
    expect(reference?.points).toContainEqual([0, 0, 0]);
    expect(reference?.points).toContainEqual([2, 4, 6]);
  });

  it("builds mesh-bounds references from cached mesh collisions", async () => {
    const references = await buildLinkCollisionGeometryReferences({
      linkDataByName: {
        arm_link: {
          name: "arm_link",
          visuals: [],
          inertial: null,
          collisions: [
            {
              origin: { xyz: [1, 2, 3], rpy: [0, 0, 0] },
              geometry: {
                type: "mesh",
                params: { filename: "cube.stl", scale: "2 3 4" },
              },
            },
          ],
        },
      },
      meshFiles: {
        "cube.stl": new Blob([UNIT_CUBE_STL], { type: "model/stl" }),
      },
    });

    const reference = references.get("arm_link");
    expect(reference?.source).toBe("mesh-bounds");
    expect(reference?.meshCount).toBe(1);
    expect(reference?.points).toContainEqual([1, 2, 3]);
    expect(reference?.points).toContainEqual([3, 5, 7]);
  });
});
