import { describe, expect, it } from "vitest";
import {
  buildDebugMeshInfo,
  type IndexedMeshAsset,
} from "@/features/urdf/loader/urdfMeshDebugInfo";
import type { MeshFiles } from "@/shared/types/feature";

const createAsset = ({
  blob = new Blob(["mesh"]),
  filename,
  relativePath,
}: {
  blob?: Blob;
  filename: string;
  relativePath: string;
}): IndexedMeshAsset => ({
  blob,
  filename,
  relativePath,
});

describe("urdfMeshDebugInfo", () => {
  it("matches URDF mesh references against registered path suffixes", () => {
    const blob = new Blob(["left"]);
    const debugInfo = buildDebugMeshInfo(
      [
        createAsset({
          blob,
          filename: "finger.stl",
          relativePath: "workspace/robot/meshes/left/finger.stl",
        }),
      ],
      {
        "workspace/robot/meshes/left/finger.stl": blob,
      },
      ["meshes/left/finger.stl"]
    );

    expect(debugInfo).toEqual([
      {
        filename: "finger.stl",
        found: true,
        registeredPaths: ["workspace/robot/meshes/left/finger.stl"],
        urdfReference: "meshes/left/finger.stl",
        webkitRelativePath: "workspace/robot/meshes/left/finger.stl",
      },
    ]);
  });

  it("decodes URI-encoded references before matching", () => {
    const blob = new Blob(["base"]);
    const meshes: MeshFiles = {
      "meshes/base part.stl": blob,
    };

    const [debugInfo] = buildDebugMeshInfo(
      [
        createAsset({
          blob,
          filename: "base part.stl",
          relativePath: "meshes/base part.stl",
        }),
      ],
      meshes,
      ["meshes/base%20part.stl"]
    );

    expect(debugInfo?.found).toBe(true);
    expect(debugInfo?.urdfReference).toBe("meshes/base%20part.stl");
  });

  it("does not match absolute file references and limits reported path variations", () => {
    const blob = new Blob(["mesh"]);
    const meshes = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [`alias-${index}.stl`, blob])
    );

    const [debugInfo] = buildDebugMeshInfo(
      [
        createAsset({
          blob,
          filename: "base.stl",
          relativePath: "base.stl",
        }),
      ],
      meshes,
      ["file:///tmp/base.stl"]
    );

    expect(debugInfo?.found).toBe(false);
    expect(debugInfo?.urdfReference).toBeUndefined();
    expect(debugInfo?.registeredPaths).toHaveLength(20);
  });
});
