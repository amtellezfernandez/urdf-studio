import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildPackageRootsFromMeshBlobMap,
  getJointLinks,
  normalizeMeshPathForMatch,
  parseMeshReference,
  parseUrdfDocument,
  parseURDF,
  prettyPrintURDF,
  resolveMeshCandidates,
  resolveMeshBlobFromReference,
  serializeUrdfDocument,
} from "@/shared/lib/urdfCore";

const SIMPLE_URDF =
  '<robot name="demo"><link name="base"/><joint name="hinge" type="fixed"><parent link="base"/><child link="tip"/></joint><link name="tip"/></robot>';

describe("studio URDF core facade", () => {
  beforeAll(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
    globalThis.XMLSerializer = dom.window.XMLSerializer as unknown as typeof XMLSerializer;
  });

  it("exposes parser and formatter helpers through the Studio facade", () => {
    const parsed = parseURDF(SIMPLE_URDF);

    expect(parsed.isValid).toBe(true);
    expect(prettyPrintURDF(SIMPLE_URDF)).toContain('<robot name="demo">');
  });

  it("exposes mesh path helpers through the Studio facade", () => {
    expect(normalizeMeshPathForMatch("meshes\\arm.stl")).toBe("meshes/arm.stl");
    expect(parseMeshReference("package://demo_description/meshes/arm.stl")).toMatchObject({
      packageName: "demo_description",
      path: "meshes/arm.stl",
      scheme: "package",
    });
  });

  it("exposes browser mesh resolver helpers through the Studio facade", () => {
    const blob = new Blob(["mesh"]);
    const meshFiles = {
      "robots/demo_description/meshes/arm.stl": blob,
    };
    const packageRoots = buildPackageRootsFromMeshBlobMap(meshFiles);
    const resolved = resolveMeshBlobFromReference(
      "package://demo_description/meshes/arm.stl",
      meshFiles,
      "robots/demo_description/urdf",
      packageRoots
    );

    expect(packageRoots.demo_description).toEqual(["robots/demo_description"]);
    expect(resolved?.path).toBe("robots/demo_description/meshes/arm.stl");
    expect(resolved?.blob).toBe(blob);
    expect(getJointLinks(SIMPLE_URDF, "hinge")).toEqual({ parentLink: "base", childLink: "tip" });
    expect(
      resolveMeshCandidates({
        ref: "package://demo_description/meshes/arm.obj",
        meshFiles,
        urdfBasePath: "robots/demo_description/urdf",
        packageRoots,
      })[0]?.resolvedPath
    ).toBe("robots/demo_description/meshes/arm.stl");
  });

  it("exposes browser URDF document helpers through the Studio facade", () => {
    const parsed = parseUrdfDocument(SIMPLE_URDF);

    expect(parsed).not.toBeNull();
    expect(serializeUrdfDocument(parsed!)).toContain('robot name="demo"');
  });
});
