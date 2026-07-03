/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import type { MeshFiles } from "@/shared/types/feature";
import {
  getFileRelativePath,
  indexMeshResources,
  registerMeshFilePaths,
} from "@/features/urdf/loader/urdfMeshIndex";

const createFile = ({
  content = "mesh",
  name,
  relativePath,
}: {
  content?: string;
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

describe("urdfMeshIndex", () => {
  it("reads browser folder relative paths with file-name fallback", () => {
    expect(getFileRelativePath(createFile({ name: "base.stl" }))).toBe("base.stl");
    expect(
      getFileRelativePath(
        createFile({
          name: "base.stl",
          relativePath: "workspace/robot/meshes/base.stl",
        })
      )
    ).toBe("workspace/robot/meshes/base.stl");
  });

  it("registers useful path aliases and removes ambiguous basename keys", () => {
    const firstBlob = new Blob(["left"]);
    const secondBlob = new Blob(["right"]);
    const meshes: MeshFiles = {};
    const collisionKeys = new Set<string>();

    registerMeshFilePaths(
      meshes,
      collisionKeys,
      "robot/meshes/left/finger.stl",
      "finger.stl",
      firstBlob
    );
    registerMeshFilePaths(
      meshes,
      collisionKeys,
      "robot/meshes/right/finger.stl",
      "finger.stl",
      secondBlob
    );

    expect(meshes["finger.stl"]).toBeUndefined();
    expect(collisionKeys.has("finger.stl")).toBe(true);
    expect(meshes["meshes/left/finger.stl"]).toBe(firstBlob);
    expect(meshes["meshes/right/finger.stl"]).toBe(secondBlob);
    expect(meshes["left/finger.stl"]).toBe(firstBlob);
    expect(meshes["right/finger.stl"]).toBe(secondBlob);
  });

  it("indexes mesh assets while preserving previously registered meshes", async () => {
    const existingBlob = new Blob(["existing"]);
    const file = createFile({
      name: "wheel.stl",
      relativePath: "robot/meshes/wheel.stl",
    });

    const { meshAssets, meshes } = await indexMeshResources(
      [file, createFile({ name: "notes.txt", relativePath: "robot/notes.txt" })],
      {
        "existing.stl": existingBlob,
      }
    );

    expect(meshAssets).toEqual([
      expect.objectContaining({
        filename: "wheel.stl",
        relativePath: "robot/meshes/wheel.stl",
      }),
    ]);
    expect(meshes["existing.stl"]).toBe(existingBlob);
    expect(meshes["robot/meshes/wheel.stl"]).toBe(meshAssets[0]?.blob);
    expect(meshes["notes.txt"]).toBeInstanceOf(Blob);
  });
});
