import { describe, expect, it } from "vitest";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import type { MeshFiles } from "@/shared/types/feature";
import {
  collectMissingPackages,
  summarizeUrdfLoadIssues,
} from "@/features/urdf/loader/urdfLoadIssues";

const blob = new Blob(["mesh"]);

const createAnalysis = ({
  absoluteFileMeshRefs = [],
  meshReferences,
}: {
  absoluteFileMeshRefs?: string[];
  meshReferences: string[];
}) =>
  ({
    absoluteFileMeshRefs,
    meshReferences,
  }) as UrdfAnalysis;

describe("urdfLoadIssues", () => {
  it("reports unresolved relative mesh references without treating absolute file refs as unmatched", () => {
    const summary = summarizeUrdfLoadIssues({
      analysis: createAnalysis({
        absoluteFileMeshRefs: ["file:///tmp/private.stl"],
        meshReferences: ["meshes/base.stl", "file:///tmp/private.stl"],
      }),
      meshFiles: {},
      packageRoots: {},
      parsedIsValid: true,
      urdfBasePath: "",
    });

    expect(summary.unmatchedRefs).toEqual(["meshes/base.stl"]);
    expect(summary.absoluteFileRefs).toEqual(["file:///tmp/private.stl"]);
    expect(summary.missingPackages).toEqual([]);
    expect(summary.hasIssues).toBe(true);
  });

  it("does not report package refs when package roots resolve the asset", () => {
    const meshFiles: MeshFiles = {
      "robots/pkg/meshes/link.stl": blob,
    };
    const summary = summarizeUrdfLoadIssues({
      analysis: createAnalysis({
        meshReferences: ["package://pkg/meshes/link.stl"],
      }),
      meshFiles,
      packageRoots: {
        pkg: ["robots/pkg"],
      },
      parsedIsValid: true,
      urdfBasePath: "",
    });

    expect(summary.unmatchedRefs).toEqual([]);
    expect(summary.missingPackages).toEqual([]);
    expect(summary.hasIssues).toBe(false);
  });

  it("reports each missing package once", () => {
    expect(
      collectMissingPackages({
        meshFiles: {},
        meshReferences: [
          "package://missing/meshes/a.stl",
          "package://missing/meshes/b.stl",
          "package://other/meshes/c.stl",
        ],
        packageRoots: {},
      })
    ).toEqual(["missing", "other"]);
  });

  it("keeps invalid URDF state visible even when all assets resolve", () => {
    const summary = summarizeUrdfLoadIssues({
      analysis: createAnalysis({
        meshReferences: ["meshes/base.stl"],
      }),
      meshFiles: {
        "meshes/base.stl": blob,
      },
      packageRoots: {},
      parsedIsValid: false,
      urdfBasePath: "",
    });

    expect(summary.unmatchedRefs).toEqual([]);
    expect(summary.hasIssues).toBe(true);
  });
});
