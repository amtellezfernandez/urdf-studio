import { describe, expect, it } from "vitest";
import type { DebugMeshInfo } from "@/shared/types/feature";
import {
  formatMeshRegistrationDebugLine,
  formatUrdfMeshLoadDiagnostics,
} from "@/features/urdf/loader/urdfLoaderDiagnostics";

const meshInfo = ({
  filename,
  found = true,
  registeredPaths,
  webkitRelativePath,
}: {
  filename: string;
  found?: boolean;
  registeredPaths: string[];
  webkitRelativePath: string;
}): DebugMeshInfo =>
  ({
    filename,
    found,
    registeredPaths,
    webkitRelativePath,
  }) as DebugMeshInfo;

describe("urdfLoaderDiagnostics", () => {
  it("formats mesh registration debug lines", () => {
    expect(
      formatMeshRegistrationDebugLine({
        filename: "wheel.stl",
        normalizedPath: "robot/meshes/wheel.stl",
        relativePath: "/robot/meshes/wheel.stl",
      })
    ).toBe(
      'Mesh wheel.stl registered with webkitRelativePath: "/robot/meshes/wheel.stl" (normalized: "robot/meshes/wheel.stl")'
    );
  });

  it("formats compact URDF mesh load diagnostics", () => {
    const lines = formatUrdfMeshLoadDiagnostics({
      debugMeshInfo: [
        meshInfo({
          filename: "base.stl",
          registeredPaths: ["meshes/base.stl", "/meshes/base.stl", "base.stl"],
          webkitRelativePath: "robot/meshes/base.stl",
        }),
        meshInfo({
          filename: "missing.stl",
          found: false,
          registeredPaths: [],
          webkitRelativePath: "robot/meshes/missing.stl",
        }),
      ],
      loadedMeshAssetCount: 2,
      totalPathVariationCount: 7,
      unmatchedRefCount: 1,
      urdfMeshReferenceCount: 3,
    });

    expect(lines).toEqual([
      "Loaded 2 mesh files with 7 total path variations",
      "URDF references: 3 total, 1 matched, 1 unmatched",
      "  base.stl (robot/meshes/base.stl): 3 path variations",
      "    Primary: meshes/base.stl",
      "    Others: /meshes/base.stl, base.stl",
      "  missing.stl (robot/meshes/missing.stl): 0 path variations",
      "    Primary: N/A",
    ]);
  });
});
