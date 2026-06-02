import { describe, expect, it } from "vitest";
import type { MeshBlobMap as MeshFiles } from "@/shared/lib/urdfBrowser";

import { resolveMeshBlob, resolveMeshBlobFromReference } from "@/shared/lib/urdfBrowser";

const makeBlob = (label: string) => new Blob([label], { type: "application/octet-stream" });

describe("meshResolver", () => {
  it("does not resolve an ambiguous filename-only fallback", () => {
    const blobA = makeBlob("a");
    const blobB = makeBlob("b");
    const meshFiles: MeshFiles = {
      "pkg_a/meshes/link.stl": blobA,
      "pkg_b/meshes/link.stl": blobB,
    };

    const resolved = resolveMeshBlobFromReference("package://pkg_missing/meshes/link.stl", meshFiles);
    expect(resolved).toBeNull();
  });

  it("resolves package references to their package-scoped roots", () => {
    const blobA = makeBlob("a");
    const blobB = makeBlob("b");
    const meshFiles: MeshFiles = {
      "pkg_a/meshes/link.stl": blobA,
      "pkg_b/meshes/link.stl": blobB,
    };

    const resolved = resolveMeshBlobFromReference(
      "package://pkg_a/meshes/link.stl",
      meshFiles,
      "pkg_a/urdf",
      { pkg_a: ["pkg_a"], pkg_b: ["pkg_b"] }
    );

    expect(resolved?.path).toBe("pkg_a/meshes/link.stl");
    expect(resolved?.blob).toBe(blobA);
  });

  it("infers package roots from in-memory mesh files", () => {
    const blob = makeBlob("mesh");
    const meshFiles: MeshFiles = {
      "robots/pkg_a/meshes/link.stl": blob,
    };

    const resolved = resolveMeshBlobFromReference("package://pkg_a/meshes/link.stl", meshFiles);

    expect(resolved?.path).toBe("robots/pkg_a/meshes/link.stl");
    expect(resolved?.blob).toBe(blob);
  });

  it("merges inferred package roots when explicit roots miss the referenced package", () => {
    const barkourBlob = makeBlob("barkour");
    const otherBlob = makeBlob("other");
    const meshFiles: MeshFiles = {
      "google_barkour_v0/assets/head.stl": barkourBlob,
      "other_pkg/assets/head.stl": otherBlob,
    };

    const resolved = resolveMeshBlobFromReference(
      "package://google_barkour_v0/assets/head.stl",
      meshFiles,
      "",
      { other_pkg: ["other_pkg"] }
    );

    expect(resolved?.path).toBe("google_barkour_v0/assets/head.stl");
    expect(resolved?.blob).toBe(barkourBlob);
  });

  it("keeps unique filename fallback behavior", () => {
    const uniqueBlob = makeBlob("unique");
    const meshFiles: MeshFiles = {
      "pkg_b/meshes/unique_link.stl": uniqueBlob,
    };

    const resolved = resolveMeshBlob("nonexistent/unique_link.stl", meshFiles);
    expect(resolved?.path).toBe("pkg_b/meshes/unique_link.stl");
    expect(resolved?.blob).toBe(uniqueBlob);
  });
});
