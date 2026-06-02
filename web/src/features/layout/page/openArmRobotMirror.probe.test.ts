import fs from "node:fs";

import { JSDOM } from "jsdom";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";

import { composeUrdfPoseMatrix } from "@/shared/lib/spatialFrame";
import { analyzeUrdfDocument, type LinkData } from "@/shared/lib/urdfCore";
import {
  computeMeshBoundsFromArrayBuffer,
  parseURDF,
  resolveMeshBlobFromReference,
} from "@/shared/lib/urdfBrowser";
import { buildRepeatedInertiaDiagnostics } from "@/features/layout/page/repeatedInertiaDiagnostics";
import { buildRepeatedInertiaSymmetryChains } from "@/features/layout/page/repeatedInertiaSymmetry";
import { buildRobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import { buildRobotMirrorSelectionLinks } from "@/features/layout/page/robotMirrorSymmetrySelection";

const OPENARM_MIRROR_FIXTURE = {
  armLinkPairCount: 8,
  mirrorNormalAlignmentThreshold: 0.99,
  mirrorPlaneNormalIndex: 1,
  packageMeshPrefix: "package://openarm_description/",
  urdfBasePath: "web/public/demo/openarm/openarm_description",
  urdfPath: "web/public/demo/openarm/openarm_description/openarm.urdf",
} as const;
const OPENARM_PACKAGE_ROOTS = {
  openarm_description: ["openarm_description"],
};

const buildPrimitiveBounds = (
  visual: NonNullable<LinkData["visuals"]>[number]
): THREE.Box3 | null => {
  if (visual.geometry.type === "box") {
    const [x = 0, y = 0, z = 0] = (visual.geometry.params.size ?? "0 0 0")
      .split(/\s+/)
      .map(Number);
    return new THREE.Box3(
      new THREE.Vector3(-x / 2, -y / 2, -z / 2),
      new THREE.Vector3(x / 2, y / 2, z / 2)
    );
  }
  if (visual.geometry.type === "sphere") {
    const radius = Number(visual.geometry.params.radius ?? 0);
    return new THREE.Box3(
      new THREE.Vector3(-radius, -radius, -radius),
      new THREE.Vector3(radius, radius, radius)
    );
  }
  if (visual.geometry.type === "cylinder") {
    const radius = Number(visual.geometry.params.radius ?? 0);
    const length = Number(visual.geometry.params.length ?? 0);
    return new THREE.Box3(
      new THREE.Vector3(-radius, -radius, -length / 2),
      new THREE.Vector3(radius, radius, length / 2)
    );
  }
  return null;
};

const resolveOpenArmMeshPath = (meshReference: string): string =>
  `${OPENARM_MIRROR_FIXTURE.urdfBasePath}/${meshReference.replace(
    OPENARM_MIRROR_FIXTURE.packageMeshPrefix,
    ""
  )}`;

const buildMeshFiles = (linkDataByName: Record<string, LinkData>) => {
  const meshReferences = new Set<string>();

  Object.values(linkDataByName).forEach((linkData) => {
    linkData.visuals.forEach((visual) => {
      if (visual.geometry.type !== "mesh") {
        return;
      }
      const meshReference = visual.geometry.params.filename?.trim();
      if (!meshReference) {
        return;
      }
      const meshPath = resolveOpenArmMeshPath(meshReference);
      if (!fs.existsSync(meshPath)) {
        return;
      }
      meshReferences.add(meshReference);
    });
  });

  return Object.fromEntries(
    Array.from(meshReferences).map((meshReference) => {
      const meshPath = resolveOpenArmMeshPath(meshReference);
      return [meshReference, new Blob([fs.readFileSync(meshPath)])];
    })
  );
};

const buildVisualBoundsCenterMap = async ({
  linkDataByName,
  meshFiles,
}: {
  linkDataByName: Record<string, LinkData>;
  meshFiles: Record<string, Blob>;
}) => {
  const centers = new Map<string, THREE.Vector3>();

  for (const [linkName, linkData] of Object.entries(linkDataByName)) {
    const bounds = new THREE.Box3();
    let hasGeometry = false;

    for (const visual of linkData.visuals) {
      let localBounds = buildPrimitiveBounds(visual);
      if (visual.geometry.type === "mesh") {
        const meshReference = visual.geometry.params.filename?.trim();
        if (!meshReference) {
          continue;
        }
        const resolved = resolveMeshBlobFromReference(
          meshReference,
          meshFiles,
          OPENARM_MIRROR_FIXTURE.urdfBasePath,
          OPENARM_PACKAGE_ROOTS
        );
        if (!resolved) {
          continue;
        }
        const meshBounds = computeMeshBoundsFromArrayBuffer(
          await resolved.blob.arrayBuffer(),
          visual.geometry.params.scale ?? "1 1 1"
        );
        if (!meshBounds) {
          continue;
        }
        localBounds = new THREE.Box3(
          new THREE.Vector3(...meshBounds.min),
          new THREE.Vector3(...meshBounds.max)
        );
      }
      if (!localBounds) {
        continue;
      }
      const transformedBounds = localBounds.applyMatrix4(
        composeUrdfPoseMatrix(visual.origin, new THREE.Matrix4())
      );
      if (!hasGeometry) {
        bounds.copy(transformedBounds);
        hasGeometry = true;
      } else {
        bounds.union(transformedBounds);
      }
    }

    if (hasGeometry) {
      centers.set(linkName, bounds.getCenter(new THREE.Vector3()));
    }
  }

  return centers;
};

describe("buildRobotMirrorSymmetryCheck on OpenArm", () => {
  beforeAll(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
    globalThis.XMLSerializer = dom.window.XMLSerializer as unknown as typeof XMLSerializer;
  });

  it("detects the real bimanual OpenArm mirror plane across left and right arms", async () => {
    const urdfContent = fs.readFileSync(OPENARM_MIRROR_FIXTURE.urdfPath, "utf8");
    const parsed = parseURDF(urdfContent);
    const analysis = analyzeUrdfDocument(parsed.document);
    const meshFiles = buildMeshFiles(analysis.linkDataByName);
    const linkCentersLocal = await buildVisualBoundsCenterMap({
      linkDataByName: analysis.linkDataByName,
      meshFiles,
    });
    const repeatedInertiaDiagnostics = buildRepeatedInertiaDiagnostics({
      linkDataByName: analysis.linkDataByName,
    });
    const repeatedInertiaSymmetryChains = buildRepeatedInertiaSymmetryChains({
      linkCentersLocal,
      repeatedInertiaDiagnostics,
      urdfContent,
    });
    const check = buildRobotMirrorSymmetryCheck({
      linkDataByName: analysis.linkDataByName,
      linkCentersLocal,
      repeatedInertiaDiagnostics,
      urdfContent,
    });
    const directLinkDataCheck = buildRobotMirrorSymmetryCheck({
      linkDataByName: analysis.linkDataByName,
      linkCentersLocal,
      repeatedInertiaDiagnostics: [],
      urdfContent,
    });
    const selectionLinks = buildRobotMirrorSelectionLinks({
      linkDataByName: analysis.linkDataByName,
      repeatedInertiaDiagnostics,
      repeatedInertiaSymmetryChains,
      robotMirrorSymmetryCheck: check,
    });
    expect(check).not.toBeNull();
    expect(directLinkDataCheck?.planeLabel).toBe("xz");
    expect(check?.planeLabel).toBe("xz");
    expect(
      Math.abs(check?.planeNormalWorld[OPENARM_MIRROR_FIXTURE.mirrorPlaneNormalIndex] ?? 0)
    ).toBeGreaterThan(
      OPENARM_MIRROR_FIXTURE.mirrorNormalAlignmentThreshold
    );
    expect(check?.matchedPairCount).toBeGreaterThanOrEqual(
      OPENARM_MIRROR_FIXTURE.armLinkPairCount
    );
    expect(check?.supportedLinkNames).toEqual(
      expect.arrayContaining([
        "openarm_left_link0",
        "openarm_left_link7",
        "openarm_right_link0",
        "openarm_right_link7",
      ])
    );
    expect(selectionLinks.filter((selectionLink) => selectionLink.preselected).length).toBeGreaterThan(
      0
    );
  });
});
