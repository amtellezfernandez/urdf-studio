import { describe, expect, it } from "vitest";

import { resolveMeshCandidates } from "@/shared/lib/urdfCore";
import type { MeshFiles } from "@/shared/types/feature";

describe("resolveMeshCandidates", () => {
  it("resolves package mesh references with package roots", () => {
    const meshBlob = new Blob(["mesh"], { type: "application/octet-stream" });
    const meshFiles: MeshFiles = {
      "pkg_a/meshes/link.stl": meshBlob,
    };

    const matches = resolveMeshCandidates({
      ref: "package://pkg_a/meshes/link.stl",
      meshFiles,
      packageRoots: { pkg_a: ["pkg_a"] },
      urdfBasePath: "pkg_a/urdf",
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.resolvedPath).toBe("pkg_a/meshes/link.stl");
    expect(matches[0]?.blob).toBe(meshBlob);
  });

  it("deduplicates candidates that resolve to the same file", () => {
    const meshBlob = new Blob(["mesh"], { type: "application/octet-stream" });
    const meshFiles: MeshFiles = {
      "pkg_a/meshes/link.stl": meshBlob,
    };

    const matches = resolveMeshCandidates({
      ref: "package://pkg_a/meshes/link.obj",
      meshFiles,
      packageRoots: { pkg_a: ["pkg_a"] },
      urdfBasePath: "pkg_a/urdf",
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.resolvedPath).toBe("pkg_a/meshes/link.stl");
  });

  it("resolves candidates from inferred package roots when explicit roots are incomplete", () => {
    const barkourBlob = new Blob(["barkour"], { type: "application/octet-stream" });
    const otherBlob = new Blob(["other"], { type: "application/octet-stream" });
    const meshFiles: MeshFiles = {
      "google_barkour_v0/assets/head.stl": barkourBlob,
      "other_pkg/assets/head.stl": otherBlob,
    };

    const matches = resolveMeshCandidates({
      ref: "package://google_barkour_v0/assets/head.stl",
      meshFiles,
      packageRoots: { other_pkg: ["other_pkg"] },
      urdfBasePath: "",
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.resolvedPath).toBe("google_barkour_v0/assets/head.stl");
    expect(matches[0]?.blob).toBe(barkourBlob);
  });
});
