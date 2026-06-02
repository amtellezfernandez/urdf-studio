import fs from "node:fs";

import { JSDOM } from "jsdom";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";

import { composeUrdfPoseMatrix } from "@/shared/lib/spatialFrame";
import {
  analyzeUrdfDocument,
  parseUrdfDocument,
  type LinkData,
} from "@/shared/lib/urdfCore";
import {
  computeMeshBoundsFromArrayBuffer,
  parseURDF,
  resolveMeshBlobFromReference,
} from "@/shared/lib/urdfBrowser";
import { buildRepeatedInertiaDiagnostics } from "@/features/layout/page/repeatedInertiaDiagnostics";
import { buildRepeatedInertiaSymmetryChains } from "@/features/layout/page/repeatedInertiaSymmetry";
import { buildRobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import {
  applyRobotMirrorParallelFix,
  applyRobotMirrorSymmetryFix,
} from "@/features/layout/page/robotMirrorSymmetryFix";
import {
  collectRobotMirrorAffectedLinkNames,
  buildRobotMirrorSelectionLinks,
} from "@/features/layout/page/robotMirrorSymmetrySelection";
import { collectRobotMirrorPlaneTouchingLinkNamesFromBounds } from "@/features/layout/page/robotMirrorSymmetryVisualization";
import {
  parseOriginTriplet,
  parseRepeatedInertiaSymmetryRobot,
} from "@/features/layout/page/repeatedInertiaSymmetryRobot";
import { collectRobotMirrorSymmetryVisualizationLinkNames } from "@/features/layout/page/simulationPrepViewerState";
import { buildLinkCollisionGeometryReferences } from "@/features/viewer/inertiaGeometryReference";
import { computeReliableInertiaBox } from "@/features/viewer/inertialMath";

const LEKIWI_URDF_PATH = "web/public/demo/lekiwi.urdf";
const LEKIWI_URDF_BASE_PATH = "web/public/demo";
const PERTURBED_LEFT_MOUNT_ORIGIN =
  '<origin xyz="-0.05928203 0.057320510000000005 0.0" rpy="3.141592653589793 -0.0 0.0" />';
const PERTURBED_LEFT_MOUNT_ORIGIN_REPLACEMENT =
  '<origin xyz="-0.05928203 0.08232051000000001 0.0" rpy="3.141592653589793 -0.0 0.0" />';
const PERTURBED_LEFT_MOUNT_JOINT_NAME = "base_plate_layer1-v5_baseplate2left_mount";
const PERTURBED_LEFT_MOUNT_GROUP_LABEL = "drive_motor_mount-v11.stl";

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
      const meshPath = `${LEKIWI_URDF_BASE_PATH}/${meshReference}`;
      if (!fs.existsSync(meshPath)) {
        return;
      }
      meshReferences.add(meshReference);
    });
  });

  return Object.fromEntries(
    Array.from(meshReferences).map((meshReference) => [
      meshReference,
      new Blob([fs.readFileSync(`${LEKIWI_URDF_BASE_PATH}/${meshReference}`)]),
    ])
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
          LEKIWI_URDF_BASE_PATH
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

const buildVisualBoundsMap = async ({
  linkDataByName,
  meshFiles,
}: {
  linkDataByName: Record<string, LinkData>;
  meshFiles: Record<string, Blob>;
}) => {
  const boundsByLinkName = new Map<string, THREE.Box3>();

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
          LEKIWI_URDF_BASE_PATH
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
      boundsByLinkName.set(linkName, bounds.clone());
    }
  }

  return boundsByLinkName;
};

const buildLekiwiMirrorProbe = async (urdfContent: string) => {
  const parsed = parseURDF(urdfContent);
  const analysis = analyzeUrdfDocument(parsed.document);
  const meshFiles = buildMeshFiles(analysis.linkDataByName);
  const linkCentersLocal = await buildVisualBoundsCenterMap({
    linkDataByName: analysis.linkDataByName,
    meshFiles,
  });
  const linkLocalBoundsByName = await buildVisualBoundsMap({
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
  const robot = parseRepeatedInertiaSymmetryRobot(urdfContent, {
    linkCentersLocal,
  });
  const linkWorldMatrices =
    robot?.linkWorldMatrices ??
    new Map<string, THREE.Matrix4>();
  const check = buildRobotMirrorSymmetryCheck({
    linkCentersLocal,
    repeatedInertiaDiagnostics,
    urdfContent,
  });

  return {
    analysis,
    check,
    linkCentersLocal,
    linkLocalBoundsByName,
    linkWorldMatrices,
    meshFiles,
    repeatedInertiaDiagnostics,
    repeatedInertiaSymmetryChains,
  };
};

const resolveJointOriginXyz = (urdfContent: string, jointName: string): [number, number, number] => {
  const xmlDocument = parseUrdfDocument(urdfContent);
  const jointElement = xmlDocument?.querySelector(`robot > joint[name="${jointName}"]`) ?? null;
  const originElement = jointElement?.querySelector(":scope > origin") ?? null;
  return parseOriginTriplet(originElement?.getAttribute("xyz"));
};

const measureVectorDistanceMeters = (
  left: readonly number[],
  right: readonly number[]
): number =>
  new THREE.Vector3(left[0] ?? 0, left[1] ?? 0, left[2] ?? 0).distanceTo(
    new THREE.Vector3(right[0] ?? 0, right[1] ?? 0, right[2] ?? 0)
  );

const computeLinkBoxPlaneResidualRadians = async ({
  linkName,
  linkDataByName,
  meshFiles,
  planeNormalWorld,
  urdfContent,
}: {
  linkName: string;
  linkDataByName: Record<string, LinkData>;
  meshFiles: Record<string, Blob>;
  planeNormalWorld: readonly number[];
  urdfContent: string;
}): Promise<number | null> => {
  const linkData = linkDataByName[linkName];
  if (!linkData?.inertial) {
    return null;
  }
  const references = await buildLinkCollisionGeometryReferences({
    linkDataByName,
    meshFiles,
    urdfBasePath: LEKIWI_URDF_BASE_PATH,
  });
  const reliableBox = computeReliableInertiaBox({
    geometryReference: references.get(linkName) ?? null,
    inertia: linkData.inertial.inertia,
    inertialOrigin: linkData.inertial.origin.xyz,
    inertialRpy: linkData.inertial.origin.rpy,
    mass: linkData.inertial.mass,
  });
  if (!reliableBox) {
    return null;
  }
  const robot = parseRepeatedInertiaSymmetryRobot(urdfContent);
  const linkWorldMatrix = robot?.linkWorldMatrices.get(linkName) ?? null;
  if (!linkWorldMatrix) {
    return null;
  }
  const linkWorldQuaternion = new THREE.Quaternion().setFromRotationMatrix(linkWorldMatrix).normalize();
  const inertialQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      linkData.inertial.origin.rpy[0],
      linkData.inertial.origin.rpy[1],
      linkData.inertial.origin.rpy[2],
      "ZYX"
    )
  );
  const boxWorldQuaternion = linkWorldQuaternion
    .clone()
    .multiply(inertialQuaternion)
    .multiply(reliableBox.box.rotation.clone())
    .normalize();
  const planeNormal = new THREE.Vector3().fromArray(planeNormalWorld).normalize();
  const worldAxes = [
    new THREE.Vector3(1, 0, 0).applyQuaternion(boxWorldQuaternion).normalize(),
    new THREE.Vector3(0, 1, 0).applyQuaternion(boxWorldQuaternion).normalize(),
    new THREE.Vector3(0, 0, 1).applyQuaternion(boxWorldQuaternion).normalize(),
  ];
  const bestAxisDot = Math.max(...worldAxes.map((axisWorld) => Math.abs(axisWorld.dot(planeNormal))));
  return Math.acos(THREE.MathUtils.clamp(bestAxisDot, -1, 1));
};

describe("buildRobotMirrorSymmetryCheck on lekiwi", () => {
  beforeAll(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
    globalThis.XMLSerializer = dom.window.XMLSerializer as unknown as typeof XMLSerializer;
  });

  it("detects lekiwi mirror symmetry on a single root-frame plane", async () => {
    const urdfContent = fs.readFileSync(LEKIWI_URDF_PATH, "utf8");
    const {
      check,
      linkCentersLocal,
      linkLocalBoundsByName,
      linkWorldMatrices,
      repeatedInertiaDiagnostics,
      repeatedInertiaSymmetryChains,
    } = await buildLekiwiMirrorProbe(
      urdfContent
    );
    const touchingLinkNames = collectRobotMirrorPlaneTouchingLinkNamesFromBounds({
      check,
      linkLocalBoundsByName,
      linkWorldMatrices,
    });
    const selectionLinks = buildRobotMirrorSelectionLinks({
      repeatedInertiaDiagnostics,
      repeatedInertiaSymmetryChains,
      robotMirrorSymmetryCheck: check,
    });

    expect(check).not.toBeNull();
    expect(check?.planeLabel).toBe("yz");
    expect(Math.abs(check?.planeNormalWorld[0] ?? 0)).toBeGreaterThan(0.9);
    expect(check?.pairedLinkCount ?? 0).toBeGreaterThan(0);
    expect(check?.supportedGroupCount ?? 0).toBeGreaterThan(0);
    expect(collectRobotMirrorSymmetryVisualizationLinkNames(check!)).toEqual(
      (
        check!.centeredLinkNames.length > 0
          ? [...check!.centeredLinkNames]
          : [...check!.supportedLinkNames]
      ).sort((left, right) => left.localeCompare(right))
    );
    expect(touchingLinkNames).toContain("base_plate_layer1-v5");
    expect(touchingLinkNames.length).toBeGreaterThanOrEqual(check?.centeredLinkCount ?? 0);
    check?.centeredLinkNames.forEach((linkName) => {
      expect(touchingLinkNames).toContain(linkName);
    });
    expect(selectionLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          defaultExclusionReason: "radial-symmetry",
          meshLabel: "4-Omni-Directional-Wheel_Single_Body-v1.stl",
          preselected: false,
        }),
      ])
    );
    expect(selectionLinks.length).toBeGreaterThan(repeatedInertiaDiagnostics.length);
    const selectedLinkNames = selectionLinks
      .filter((selectionLink) => selectionLink.preselected)
      .map((selectionLink) => selectionLink.linkName);
    expect(selectedLinkNames.length).toBeGreaterThan(0);
    expect(selectedLinkNames).not.toContain("4-Omni-Directional-Wheel_Single_Body-v1");
    const driveMotorSelectionLink = selectionLinks.find(
      (selectionLink) =>
        selectionLink.meshLabel === PERTURBED_LEFT_MOUNT_GROUP_LABEL &&
        selectionLink.linkName === "drive_motor_mount-v11"
    );
    expect(driveMotorSelectionLink).toBeTruthy();
    const affectedLinkNames = collectRobotMirrorAffectedLinkNames({
      robotMirrorSymmetryCheck: check,
      linkCentersLocal,
      selectedLinkNames: driveMotorSelectionLink ? [driveMotorSelectionLink.linkName] : [],
      selectionLinks,
      urdfContent,
    });
    expect(affectedLinkNames).toEqual(["drive_motor_mount-v11"]);
    expect(affectedLinkNames).not.toContain("drive_motor_mount-v11-1");
    expect(affectedLinkNames).not.toContain("ST3215_Servo_Motor-v1-1");
    expect(affectedLinkNames).not.toContain("ST3215_Servo_Motor-v1");
    expect(affectedLinkNames).not.toContain("omni_wheel_mount-v5");
    expect(affectedLinkNames).not.toContain("4-Omni-Directional-Wheel_Single_Body-v1");
    expect(affectedLinkNames).not.toContain("drive_motor_mount-v11-2");
    expect(affectedLinkNames).not.toContain("ST3215_Servo_Motor-v1-2");
    const availableSelectionLink =
      selectionLinks.find((selectionLink) => selectionLink.status === "available") ?? null;
    if (availableSelectionLink) {
      expect(
        collectRobotMirrorAffectedLinkNames({
          robotMirrorSymmetryCheck: check,
          linkCentersLocal,
          selectedLinkNames: [availableSelectionLink.linkName],
          selectionLinks,
          urdfContent,
        })
      ).toHaveLength(0);
    }
  });

  it("increases the lekiwi mirror review count after a real branch is pushed off-plane", async () => {
    const urdfContent = fs.readFileSync(LEKIWI_URDF_PATH, "utf8");
    const { check: baseCheck } = await buildLekiwiMirrorProbe(urdfContent);
    const { check: perturbedCheck } = await buildLekiwiMirrorProbe(
      urdfContent.replace(
        PERTURBED_LEFT_MOUNT_ORIGIN,
        PERTURBED_LEFT_MOUNT_ORIGIN_REPLACEMENT
      )
    );

    expect(baseCheck).not.toBeNull();
    expect(perturbedCheck).not.toBeNull();
    expect(perturbedCheck?.planeLabel).toBe(baseCheck?.planeLabel);
    expect(perturbedCheck?.reviewLinkCount ?? -1).toBeGreaterThan(
      baseCheck?.reviewLinkCount ?? -1
    );
  });

  it("auto-aligns a selected lekiwi mirror mesh group and reduces the real mirror flaw", async () => {
    const baseUrdfContent = fs.readFileSync(LEKIWI_URDF_PATH, "utf8");
    const perturbedUrdfContent = baseUrdfContent.replace(
      PERTURBED_LEFT_MOUNT_ORIGIN,
      PERTURBED_LEFT_MOUNT_ORIGIN_REPLACEMENT
    );
    const baseProbe = await buildLekiwiMirrorProbe(baseUrdfContent);
    const perturbedProbe = await buildLekiwiMirrorProbe(perturbedUrdfContent);
    const selectionLinks = buildRobotMirrorSelectionLinks({
      repeatedInertiaDiagnostics: perturbedProbe.repeatedInertiaDiagnostics,
      repeatedInertiaSymmetryChains: perturbedProbe.repeatedInertiaSymmetryChains,
      robotMirrorSymmetryCheck: perturbedProbe.check,
    });
    const selectedLink = selectionLinks.find(
      (selectionLink) =>
        selectionLink.meshLabel === PERTURBED_LEFT_MOUNT_GROUP_LABEL &&
        selectionLink.linkName === "drive_motor_mount-v11"
    );

    expect(perturbedProbe.check).not.toBeNull();
    expect(selectedLink).toBeTruthy();

    const result = applyRobotMirrorSymmetryFix({
      linkCentersLocal: perturbedProbe.linkCentersLocal,
      robotMirrorSymmetryCheck: perturbedProbe.check,
      selectedLinkNames: selectedLink ? [selectedLink.linkName] : [],
      selectionLinks,
      urdfContent: perturbedUrdfContent,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const baseJointOrigin = resolveJointOriginXyz(baseUrdfContent, PERTURBED_LEFT_MOUNT_JOINT_NAME);
    const perturbedJointOrigin = resolveJointOriginXyz(
      perturbedUrdfContent,
      PERTURBED_LEFT_MOUNT_JOINT_NAME
    );
    const repairedJointOrigin = resolveJointOriginXyz(
      result.draftUrdfContent,
      PERTURBED_LEFT_MOUNT_JOINT_NAME
    );

    expect(result.alignedTargetLinkCount).toBeGreaterThan(0);
    expect(result.appliedStepCount).toBeGreaterThan(0);
    expect(
      measureVectorDistanceMeters(repairedJointOrigin, baseJointOrigin)
    ).toBeLessThan(measureVectorDistanceMeters(perturbedJointOrigin, baseJointOrigin));
  });

  it("makes a torqued preselected lekiwi inertia box parallel without centering it", async () => {
    const urdfContent = fs.readFileSync(LEKIWI_URDF_PATH, "utf8");
    const { analysis, check, meshFiles, repeatedInertiaDiagnostics, repeatedInertiaSymmetryChains } =
      await buildLekiwiMirrorProbe(urdfContent);
    const selectionLinks = buildRobotMirrorSelectionLinks({
      repeatedInertiaDiagnostics,
      repeatedInertiaSymmetryChains,
      robotMirrorSymmetryCheck: check,
    });
    const preselectedLinks = selectionLinks.filter((selectionLink) => selectionLink.preselected);
    const residuals = await Promise.all(
      preselectedLinks.map(async (selectionLink) => ({
        linkName: selectionLink.linkName,
        residualRadians: await computeLinkBoxPlaneResidualRadians({
          linkName: selectionLink.linkName,
          linkDataByName: analysis.linkDataByName,
          meshFiles,
          planeNormalWorld: check?.planeNormalWorld ?? [1, 0, 0],
          urdfContent,
        }),
      }))
    );
    const targetResidual = residuals
      .filter((entry): entry is { linkName: string; residualRadians: number } => entry.residualRadians !== null)
      .sort((left, right) => right.residualRadians - left.residualRadians)[0];

    expect(check).not.toBeNull();
    expect(targetResidual).toBeTruthy();
    expect(targetResidual?.residualRadians ?? 0).toBeGreaterThan(0.1);

    const result = await applyRobotMirrorParallelFix({
      meshFiles,
      robotMirrorSymmetryCheck: check,
      selectedLinkNames: targetResidual ? [targetResidual.linkName] : [],
      selectionLinks,
      urdfBasePath: LEKIWI_URDF_BASE_PATH,
      urdfContent,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !targetResidual) {
      return;
    }
    const repairedResidualRadians = await computeLinkBoxPlaneResidualRadians({
      linkName: targetResidual.linkName,
      linkDataByName: analyzeUrdfDocument(parseURDF(result.draftUrdfContent).document).linkDataByName,
      meshFiles,
      planeNormalWorld: check?.planeNormalWorld ?? [1, 0, 0],
      urdfContent: result.draftUrdfContent,
    });

    expect(repairedResidualRadians).not.toBeNull();
    expect(repairedResidualRadians ?? Number.POSITIVE_INFINITY).toBeLessThan(
      targetResidual.residualRadians
    );
    expect(repairedResidualRadians ?? Number.POSITIVE_INFINITY).toBeLessThan(1e-3);
  });
});
