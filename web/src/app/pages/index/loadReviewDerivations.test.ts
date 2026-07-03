import { describe, expect, it } from "vitest";
import {
  buildCollisionMeshStats,
  buildInertialIssues,
  buildMeshRootHints,
  hasLoadReviewAttention,
} from "@/app/pages/index/loadReviewDerivations";
import type { LinkData, UrdfAnalysis } from "@/shared/lib/urdfCore";
import type { DebugMeshInfo } from "@/shared/types/feature";

const createDebugMeshInfo = (
  webkitRelativePath: string,
  filename = webkitRelativePath.split("/").pop() ?? "mesh.stl"
): DebugMeshInfo => ({
  filename,
  webkitRelativePath,
  found: true,
  registeredPaths: [],
});

const createAnalysis = (overrides: Partial<UrdfAnalysis>): UrdfAnalysis =>
  ({
    isValid: true,
    linkNames: [],
    linkDataByName: {},
    collisionEntries: [],
    ...overrides,
  }) as UrdfAnalysis;

const createLinkData = (
  name: string,
  inertial: LinkData["inertial"] = null
): LinkData => ({
  name,
  visuals: [],
  collisions: [],
  inertial,
});

describe("loadReviewDerivations", () => {
  it("builds compact mesh root hints from uploaded mesh paths", () => {
    expect(
      buildMeshRootHints([
        createDebugMeshInfo("robot/a/meshes/link.stl"),
        createDebugMeshInfo("robot/a/assets/arm.stl"),
        createDebugMeshInfo("robot/deep/folder/part.stl"),
        createDebugMeshInfo("single.stl"),
      ])
    ).toEqual(["robot/a/meshes", "robot/a/assets", "robot/deep/folder"]);
  });

  it("classifies missing, invalid-mass, and invalid-tensor inertial issues", () => {
    const analysis = createAnalysis({
      linkNames: ["missing", "bad_mass", "bad_tensor", "ok"],
      linkDataByName: {
        missing: createLinkData("missing"),
        bad_mass: createLinkData(
          "bad_mass",
          {
            mass: 0,
            inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
            origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
          }
        ),
        bad_tensor: createLinkData(
          "bad_tensor",
          {
            mass: 1,
            inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
            origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
          }
        ),
        ok: createLinkData(
          "ok",
          {
            mass: 1,
            inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
            origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
          }
        ),
      },
    });

    expect(buildInertialIssues(analysis)).toEqual({
      missing: ["missing"],
      invalidMass: ["bad_mass"],
      invalidTensor: ["bad_tensor"],
    });
  });

  it("counts matched and missing collision mesh references", () => {
    const analysis = createAnalysis({
      collisionEntries: [
        {
          geometry: { type: "mesh", filename: "meshes/base.stl" },
        },
        {
          geometry: { type: "mesh", filename: "meshes/missing.stl" },
        },
        {
          geometry: { type: "box", size: [1, 1, 1] },
        },
      ] as UrdfAnalysis["collisionEntries"],
    });

    expect(
      buildCollisionMeshStats({
        urdfAnalysis: analysis,
        meshFiles: {
          "meshes/base.stl": new Blob(["solid base\nendsolid base\n"], {
            type: "model/stl",
          }),
        },
        urdfBasePath: "",
        packageRoots: {},
      })
    ).toEqual({
      total: 2,
      matched: 1,
      missing: ["meshes/missing.stl"],
    });
  });

  it("combines load review attention signals", () => {
    expect(
      hasLoadReviewAttention({
        urdfValidationError: null,
        unmatchedURDFRefs: [],
        absoluteFileMeshRefs: [],
        missingPackageRefs: [],
        inertialIssues: { missing: [], invalidMass: [], invalidTensor: [] },
        collisionMeshStats: { total: 0, matched: 0, missing: [] },
        orientationNeedsAttention: false,
      })
    ).toBe(false);
    expect(
      hasLoadReviewAttention({
        urdfValidationError: null,
        unmatchedURDFRefs: [],
        absoluteFileMeshRefs: [],
        missingPackageRefs: [],
        inertialIssues: { missing: ["base"], invalidMass: [], invalidTensor: [] },
        collisionMeshStats: { total: 0, matched: 0, missing: [] },
        orientationNeedsAttention: false,
      })
    ).toBe(true);
  });
});
