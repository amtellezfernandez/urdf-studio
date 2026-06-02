import { describe, expect, it } from "vitest";

import { filterActionableUnmatchedMeshReferences } from "./candidateMeshWarnings";

describe("filterActionableUnmatchedMeshReferences", () => {
  it("suppresses warnings when meshes refs resolve through assets aliases", () => {
    const unresolved = filterActionableUnmatchedMeshReferences(
      "google_barkour_v0/barkour_v0.urdf",
      ["meshes/head.stl", "meshes/body.stl"],
      [
        { path: "google_barkour_v0/barkour_v0.urdf", type: "file" },
        { path: "google_barkour_v0/assets/head.stl", type: "file" },
        { path: "google_barkour_v0/assets/body.stl", type: "file" },
      ]
    );

    expect(unresolved).toEqual([]);
  });

  it("keeps warnings when no alias target exists", () => {
    const unresolved = filterActionableUnmatchedMeshReferences(
      "google_barkour_v0/barkour_v0.urdf",
      ["meshes/head.stl", "meshes/missing.stl"],
      [
        { path: "google_barkour_v0/barkour_v0.urdf", type: "file" },
        { path: "google_barkour_v0/assets/head.stl", type: "file" },
      ]
    );

    expect(unresolved).toEqual(["meshes/missing.stl"]);
  });
});
