import fs from "node:fs";

import { JSDOM } from "jsdom";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { beforeAll, describe, expect, it } from "vitest";

import { composeUrdfPoseMatrix } from "@/shared/lib/spatialFrame";
import { analyzeUrdfDocument, type LinkData } from "@/shared/lib/urdfCore";
import {
  computeMeshBoundsFromArrayBuffer,
  parseURDF,
  resolveMeshBlobFromReference,
} from "@/shared/lib/urdfBrowser";
import { buildRepeatedInertiaDiagnostics } from "@/features/layout/page/repeatedInertiaDiagnostics";
import {
  buildRepeatedInertiaSymmetryChains,
  type RepeatedInertiaSymmetryChain,
} from "@/features/layout/page/repeatedInertiaSymmetry";
import { applyRepeatedInertiaSymmetryFix } from "@/features/layout/page/repeatedInertiaSymmetryFix";
import {
  REPEATED_INERTIA_SYMMETRY_REPAIR_MIN_STEP_METERS,
  REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS,
} from "@/features/layout/page/repeatedInertiaSymmetryParams";
import { parseRepeatedInertiaSymmetryRobot } from "@/features/layout/page/repeatedInertiaSymmetryRobot";
import { collectRepeatedInertiaSymmetryScopedLinkNames } from "@/features/layout/page/simulationPrepViewerState";
import { changeJointOrigin } from "@/features/urdf/editor/urdfEditorActions";

const LEKIWI_URDF_PATH = "web/public/demo/lekiwi.urdf";
const LEKIWI_URDF_BASE_PATH = "web/public/demo";
const TARGET_OUTLIER_BRANCH_ROOT = "drive_motor_mount-v11-2";
const TARGET_MESH_REFERENCES = [
  "meshes/drive_motor_mount-v11.stl",
  "meshes/ST3215_Servo_Motor-v1.stl",
  "meshes/omni_wheel_mount-v5.stl",
  "meshes/4-Omni-Directional-Wheel_Single_Body-v1.stl",
] as const;

const readMeshFiles = () =>
  Object.fromEntries(
    TARGET_MESH_REFERENCES.map((reference) => [
      reference,
      new Blob([fs.readFileSync(`${LEKIWI_URDF_BASE_PATH}/${reference}`)]),
    ])
  );

const STL_LOADER = new STLLoader();

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

const computeMeshSurfaceCentroidFromArrayBuffer = (arrayBuffer: ArrayBuffer) => {
  const geometry = STL_LOADER.parse(arrayBuffer);
  const position = geometry.getAttribute("position");
  const vertexA = new THREE.Vector3();
  const vertexB = new THREE.Vector3();
  const vertexC = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const triangleCentroid = new THREE.Vector3();
  const weightedCentroidSum = new THREE.Vector3();
  let totalArea = 0;

  for (let vertexIndex = 0; vertexIndex + 2 < position.count; vertexIndex += 3) {
    vertexA.fromBufferAttribute(position, vertexIndex);
    vertexB.fromBufferAttribute(position, vertexIndex + 1);
    vertexC.fromBufferAttribute(position, vertexIndex + 2);
    edgeAB.subVectors(vertexB, vertexA);
    edgeAC.subVectors(vertexC, vertexA);
    const triangleArea = cross.crossVectors(edgeAB, edgeAC).length() * 0.5;
    if (!Number.isFinite(triangleArea) || triangleArea <= 0) {
      continue;
    }
    triangleCentroid.copy(vertexA).add(vertexB).add(vertexC).multiplyScalar(1 / 3);
    weightedCentroidSum.addScaledVector(triangleCentroid, triangleArea);
    totalArea += triangleArea;
  }

  return totalArea > 0
    ? weightedCentroidSum.multiplyScalar(1 / totalArea)
    : null;
};

const buildVisualSurfaceCentroidMap = async ({
  linkDataByName,
  meshFiles,
}: {
  linkDataByName: Record<string, LinkData>;
  meshFiles: Record<string, Blob>;
}) => {
  const centers = new Map<string, THREE.Vector3>();

  for (const [linkName, linkData] of Object.entries(linkDataByName)) {
    const weightedCenterSum = new THREE.Vector3();
    let visualCount = 0;

    for (const visual of linkData.visuals) {
      let localCenter: THREE.Vector3 | null = null;
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
        const localMeshCenter = computeMeshSurfaceCentroidFromArrayBuffer(
          await resolved.blob.arrayBuffer()
        );
        if (!localMeshCenter) {
          continue;
        }
        const scaleComponents = (visual.geometry.params.scale ?? "1 1 1")
          .split(/\s+/)
          .map(Number);
        localCenter = new THREE.Vector3(
          localMeshCenter.x * (scaleComponents[0] ?? 1),
          localMeshCenter.y * (scaleComponents[1] ?? 1),
          localMeshCenter.z * (scaleComponents[2] ?? 1)
        );
      } else {
        localCenter = buildPrimitiveBounds(visual)?.getCenter(new THREE.Vector3()) ?? null;
      }
      if (!localCenter) {
        continue;
      }
      localCenter.applyMatrix4(composeUrdfPoseMatrix(visual.origin, new THREE.Matrix4()));
      weightedCenterSum.add(localCenter);
      visualCount += 1;
    }

    if (visualCount > 0) {
      centers.set(linkName, weightedCenterSum.multiplyScalar(1 / visualCount));
    }
  }

  return centers;
};

const round = (value: number) => Number(value.toFixed(6));

const TARGET_LINK_NAMES = [
  "drive_motor_mount-v11-2",
  "ST3215_Servo_Motor-v1-2",
  "omni_wheel_mount-v5-2",
  "4-Omni-Directional-Wheel_Single_Body-v1-2",
] as const;
const LEKIWI_WHEEL_BRANCH_FAMILY = [
  {
    branchRootLinkName: "drive_motor_mount-v11",
    servoLinkName: "ST3215_Servo_Motor-v1",
    wheelBodyLinkName: "4-Omni-Directional-Wheel_Single_Body-v1",
    wheelMountLinkName: "omni_wheel_mount-v5",
  },
  {
    branchRootLinkName: "drive_motor_mount-v11-1",
    servoLinkName: "ST3215_Servo_Motor-v1-1",
    wheelBodyLinkName: "4-Omni-Directional-Wheel_Single_Body-v1-1",
    wheelMountLinkName: "omni_wheel_mount-v5-1",
  },
  {
    branchRootLinkName: "drive_motor_mount-v11-2",
    servoLinkName: "ST3215_Servo_Motor-v1-2",
    wheelBodyLinkName: "4-Omni-Directional-Wheel_Single_Body-v1-2",
    wheelMountLinkName: "omni_wheel_mount-v5-2",
  },
] as const;
const TARGET_DRIVE_MOUNT_LINK_NAME = "drive_motor_mount-v11-2";
const TARGET_SERVO_LINK_NAME = "ST3215_Servo_Motor-v1-2";
const TARGET_WHEEL_MOUNT_LINK_NAME = "omni_wheel_mount-v5-2";
const TARGET_WHEEL_BODY_LINK_NAME = "4-Omni-Directional-Wheel_Single_Body-v1-2";

const TARGET_JOINT_NAMES = [
  "base_plate_layer1-v5_baseplate2bottom_mount",
  "drive_motor_mount-v11-2_Rigid-2",
  "ST3215_Servo_Motor-v1-2_Revolute-60",
  "omni_wheel_mount-v5-2_Rigid-61",
] as const;
const EXPECTED_EDITED_JOINT_NAME_BY_LINK_NAME = new Map<string, string>([
  [TARGET_DRIVE_MOUNT_LINK_NAME, TARGET_JOINT_NAMES[0]],
  [TARGET_WHEEL_MOUNT_LINK_NAME, TARGET_JOINT_NAMES[2]],
]);
const RESIDUAL_IMPROVEMENT_EPSILON_METERS = 1e-9;
const BRANCH_LOCAL_POSITION_EPSILON_METERS = 1e-9;
const BRANCH_LOCAL_ANGLE_EPSILON_RADIANS = 1e-9;

const resolveTargetChains = ({
  linkCentersLocal,
  repeatedInertiaDiagnostics,
  urdfContent,
}: {
  linkCentersLocal: Map<string, THREE.Vector3>;
  repeatedInertiaDiagnostics: ReturnType<typeof buildRepeatedInertiaDiagnostics>;
  urdfContent: string;
}) =>
  buildRepeatedInertiaSymmetryChains({
    linkCentersLocal,
    repeatedInertiaDiagnostics,
    urdfContent,
  });

const resolveTargetChain = ({
  linkCentersLocal,
  repeatedInertiaDiagnostics,
  urdfContent,
}: {
  linkCentersLocal: Map<string, THREE.Vector3>;
  repeatedInertiaDiagnostics: ReturnType<typeof buildRepeatedInertiaDiagnostics>;
  urdfContent: string;
}) =>
  resolveTargetChains({
    linkCentersLocal,
    repeatedInertiaDiagnostics,
    urdfContent,
  }).find((candidate) => candidate.outlierBranchRootLinkName === TARGET_OUTLIER_BRANCH_ROOT) ?? null;

const resolveTargetChainOrThrow = ({
  linkCentersLocal,
  repeatedInertiaDiagnostics,
  urdfContent,
}: {
  linkCentersLocal: Map<string, THREE.Vector3>;
  repeatedInertiaDiagnostics: ReturnType<typeof buildRepeatedInertiaDiagnostics>;
  urdfContent: string;
}): RepeatedInertiaSymmetryChain => {
  const candidates = resolveTargetChains({
    linkCentersLocal,
    repeatedInertiaDiagnostics,
    urdfContent,
  });
  const chain = resolveTargetChain({
    linkCentersLocal,
    repeatedInertiaDiagnostics,
    urdfContent,
  });
  expect(
    chain,
    `Diagnostics: ${repeatedInertiaDiagnostics.length}; detected outlier roots: ${candidates
      .map((candidate) => candidate.outlierBranchRootLinkName)
      .join(", ")}`
  ).not.toBeNull();
  return chain!;
};

const expectTrackedLinksToMatchIdealPositions = ({
  chain,
  linkCentersLocal,
  urdfContent,
}: {
  chain: RepeatedInertiaSymmetryChain;
  linkCentersLocal: Map<string, THREE.Vector3>;
  urdfContent: string;
}) => {
  const robot = parseRepeatedInertiaSymmetryRobot(urdfContent, { linkCentersLocal });
  const outlierRow = chain.branchRows.find(
    (row) => row.branchRootLinkName === chain.outlierBranchRootLinkName
  );
  expect(robot).not.toBeNull();
  expect(outlierRow).toBeDefined();
  outlierRow?.linkRows.forEach((linkRow) => {
    const actualPosition =
      robot?.linkReferenceCentersWorld.get(linkRow.linkName) ??
      robot?.linkWorldPositions.get(linkRow.linkName) ??
      null;
    expect(actualPosition).not.toBeNull();
    expect(
      actualPosition?.distanceTo(new THREE.Vector3().fromArray(linkRow.idealPositionMeters)) ?? 0
    ).toBeLessThan(REPEATED_INERTIA_SYMMETRY_REPAIR_MIN_STEP_METERS);
  });
};

const expectTrackedLinksToRemainVisuallyAligned = ({
  chain,
  linkCentersLocal,
  urdfContent,
}: {
  chain: RepeatedInertiaSymmetryChain;
  linkCentersLocal: Map<string, THREE.Vector3>;
  urdfContent: string;
}) => {
  const robot = parseRepeatedInertiaSymmetryRobot(urdfContent, { linkCentersLocal });
  const outlierRow = chain.branchRows.find(
    (row) => row.branchRootLinkName === chain.outlierBranchRootLinkName
  );
  expect(robot).not.toBeNull();
  expect(outlierRow).toBeDefined();
  outlierRow?.linkRows.forEach((linkRow) => {
    const actualPosition =
      robot?.linkReferenceCentersWorld.get(linkRow.linkName) ??
      robot?.linkWorldPositions.get(linkRow.linkName) ??
      null;
    expect(actualPosition).not.toBeNull();
    expect(
      actualPosition?.distanceTo(new THREE.Vector3().fromArray(linkRow.idealPositionMeters)) ?? 0
    ).toBeLessThan(REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS);
  });
};

const resolveTrackedResidualDistances = ({
  chain,
  linkCentersLocal,
  urdfContent,
}: {
  chain: RepeatedInertiaSymmetryChain;
  linkCentersLocal: Map<string, THREE.Vector3>;
  urdfContent: string;
}) => {
  const robot = parseRepeatedInertiaSymmetryRobot(urdfContent, { linkCentersLocal });
  const outlierRow = chain.branchRows.find(
    (row) => row.branchRootLinkName === chain.outlierBranchRootLinkName
  );
  return (
    outlierRow?.linkRows.map((linkRow) => {
      const actualPosition =
        robot?.linkReferenceCentersWorld.get(linkRow.linkName) ??
        robot?.linkWorldPositions.get(linkRow.linkName) ??
        null;
      return actualPosition == null
        ? Number.POSITIVE_INFINITY
        : actualPosition.distanceTo(new THREE.Vector3().fromArray(linkRow.idealPositionMeters));
    }) ?? []
  );
};

const resolveTrackedResidualDistancesByLinkName = ({
  chain,
  linkCentersLocal,
  urdfContent,
}: {
  chain: RepeatedInertiaSymmetryChain;
  linkCentersLocal: Map<string, THREE.Vector3>;
  urdfContent: string;
}) => {
  const robot = parseRepeatedInertiaSymmetryRobot(urdfContent, { linkCentersLocal });
  const outlierRow = chain.branchRows.find(
    (row) => row.branchRootLinkName === chain.outlierBranchRootLinkName
  );
  return new Map(
    (outlierRow?.linkRows ?? []).map((linkRow) => {
      const actualPosition =
        robot?.linkReferenceCentersWorld.get(linkRow.linkName) ??
        robot?.linkWorldPositions.get(linkRow.linkName) ??
        null;
      return [
        linkRow.linkName,
        actualPosition == null
          ? Number.POSITIVE_INFINITY
          : actualPosition.distanceTo(new THREE.Vector3().fromArray(linkRow.idealPositionMeters)),
      ] as const;
    })
  );
};

const resolveRelativeLinkTransform = ({
  fromLinkName,
  robot,
  toLinkName,
}: {
  fromLinkName: string;
  robot: NonNullable<ReturnType<typeof parseRepeatedInertiaSymmetryRobot>>;
  toLinkName: string;
}) => {
  const fromMatrix = robot.linkWorldMatrices.get(fromLinkName) ?? null;
  const toMatrix = robot.linkWorldMatrices.get(toLinkName) ?? null;
  if (!fromMatrix || !toMatrix) {
    return null;
  }
  const relativeMatrix = new THREE.Matrix4()
    .copy(fromMatrix)
    .invert()
    .multiply(toMatrix);
  return {
    position: new THREE.Vector3().setFromMatrixPosition(relativeMatrix),
    quaternion: new THREE.Quaternion().setFromRotationMatrix(relativeMatrix).normalize(),
  };
};

const resolveQuaternionAngleRadians = (
  left: THREE.Quaternion,
  right: THREE.Quaternion
): number => {
  const normalizedLeft = left.clone().normalize();
  const normalizedRight = right.clone().normalize();
  const absoluteDot = Math.min(1, Math.abs(normalizedLeft.dot(normalizedRight)));
  return 2 * Math.acos(absoluteDot);
};

const applySingleRepairStep = ({
  step,
  linkCentersLocal,
  urdfContent,
}: {
  step: NonNullable<RepeatedInertiaSymmetryChain["recommendedRepair"]>["steps"][number];
  linkCentersLocal: Map<string, THREE.Vector3>;
  urdfContent: string;
}) => {
  const robot = parseRepeatedInertiaSymmetryRobot(urdfContent, { linkCentersLocal });
  const joint = robot?.jointByChildLink.get(step.childLinkName) ?? null;
  const parentMatrix = robot?.linkWorldMatrices.get(step.parentLinkName) ?? null;
  const currentLinkPosition = robot?.linkWorldPositions.get(step.childLinkName) ?? null;
  const currentAlignmentPoint =
    robot?.linkReferenceCentersWorld.get(step.childLinkName) ??
    robot?.linkWorldPositions.get(step.childLinkName) ??
    null;
  if (!joint || !parentMatrix || !currentLinkPosition || !currentAlignmentPoint) {
    return urdfContent;
  }
  const targetAlignmentPoint = new THREE.Vector3().fromArray(step.targetPositionMeters);
  const translationDeltaWorld = targetAlignmentPoint.clone().sub(currentAlignmentPoint);
  if (translationDeltaWorld.length() < REPEATED_INERTIA_SYMMETRY_REPAIR_MIN_STEP_METERS) {
    return urdfContent;
  }
  const targetLinkPosition = currentLinkPosition.clone().add(translationDeltaWorld);
  const targetLocalPosition = targetLinkPosition.applyMatrix4(
    new THREE.Matrix4().copy(parentMatrix).invert()
  );
  const result = changeJointOrigin(
    urdfContent,
    step.jointName,
    [
      targetLocalPosition.x,
      targetLocalPosition.y,
      targetLocalPosition.z,
    ],
    joint.originRpy
  );
  return result.success ? result.content : urdfContent;
};

describe("lekiwi symmetry probe", () => {
  beforeAll(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
    globalThis.XMLSerializer = dom.window.XMLSerializer as unknown as typeof XMLSerializer;
  });

  it("aligns the real lekiwi wheel branch all the way to the wheel copy", async () => {
    const urdfContent = fs.readFileSync(LEKIWI_URDF_PATH, "utf8");
    const parsed = parseURDF(urdfContent);
    const analysis = analyzeUrdfDocument(parsed.document);
    const meshFiles = readMeshFiles();
    const linkCentersLocal = await buildVisualBoundsCenterMap({
      linkDataByName: analysis.linkDataByName,
      meshFiles,
    });
    const repeatedInertiaDiagnostics = buildRepeatedInertiaDiagnostics({
      linkDataByName: analysis.linkDataByName,
    }).filter((group) =>
      TARGET_MESH_REFERENCES.includes(
        group.meshReference as (typeof TARGET_MESH_REFERENCES)[number]
      )
    );
    const chain = resolveTargetChain({
      linkCentersLocal,
      repeatedInertiaDiagnostics,
      urdfContent,
    });

    expect(chain).not.toBeNull();
    expect(chain?.recommendedRepair).toMatchObject({
      articulatedBoundaryJointName: null,
      blockedTargetLinkNames: [
        TARGET_SERVO_LINK_NAME,
        TARGET_WHEEL_BODY_LINK_NAME,
      ],
      stepCount: 2,
    });
    expect(chain?.recommendedRepair?.steps.map((step) => step.childLinkName)).toEqual([
      TARGET_DRIVE_MOUNT_LINK_NAME,
      TARGET_WHEEL_MOUNT_LINK_NAME,
    ]);
    expect(collectRepeatedInertiaSymmetryScopedLinkNames(chain!)).toEqual(
      [...TARGET_LINK_NAMES].sort((left, right) => left.localeCompare(right))
    );

    const beforeRobot = parseRepeatedInertiaSymmetryRobot(urdfContent, { linkCentersLocal });
    const beforeJointOrigins = new Map(
      TARGET_LINK_NAMES.map((linkName) => [
        linkName,
        beforeRobot?.jointByChildLink.get(linkName)?.originXyz.map(round) ?? null,
      ])
    );

    const fixResult = await applyRepeatedInertiaSymmetryFix({
      chain: chain!,
      linkCentersLocal,
      repeatedInertiaDiagnostics,
      urdfContent,
    });

    expect(fixResult).toMatchObject({
      ok: true,
      appliedStepCount: 2,
      mode: "multi-joint",
      summary:
        "Updated 2 joints in branch drive_motor_mount-v11-2; 2 connected targets moved with them.",
    });
    if (!fixResult.ok) {
      return;
    }

    const afterRobot = parseRepeatedInertiaSymmetryRobot(fixResult.draftUrdfContent, {
      linkCentersLocal,
    });
    expect(afterRobot).not.toBeNull();
    ([TARGET_DRIVE_MOUNT_LINK_NAME, TARGET_WHEEL_MOUNT_LINK_NAME] as const).forEach((linkName) => {
      expect(beforeRobot?.jointByChildLink.get(linkName)?.jointName).toBe(
        EXPECTED_EDITED_JOINT_NAME_BY_LINK_NAME.get(linkName)
      );
      expect(afterRobot?.jointByChildLink.get(linkName)?.originXyz.map(round)).not.toEqual(
        beforeJointOrigins.get(linkName) ?? null
      );
    });

    expectTrackedLinksToRemainVisuallyAligned({
      chain: chain!,
      linkCentersLocal,
      urdfContent: fixResult.draftUrdfContent,
    });
  });

  it("improves the real lekiwi branch residual after each joint edit until perfect", async () => {
    const urdfContent = fs.readFileSync(LEKIWI_URDF_PATH, "utf8");
    const parsed = parseURDF(urdfContent);
    const analysis = analyzeUrdfDocument(parsed.document);
    const meshFiles = readMeshFiles();
    const linkCentersLocal = await buildVisualBoundsCenterMap({
      linkDataByName: analysis.linkDataByName,
      meshFiles,
    });
    const repeatedInertiaDiagnostics = buildRepeatedInertiaDiagnostics({
      linkDataByName: analysis.linkDataByName,
    }).filter((group) =>
      TARGET_MESH_REFERENCES.includes(
        group.meshReference as (typeof TARGET_MESH_REFERENCES)[number]
      )
    );
    const chain = resolveTargetChain({
      linkCentersLocal,
      repeatedInertiaDiagnostics,
      urdfContent,
    });

    expect(chain?.recommendedRepair?.steps).toHaveLength(2);

    let tracedUrdfContent = urdfContent;
    let previousMaxResidual = Math.max(
      ...resolveTrackedResidualDistances({
        chain: chain!,
        linkCentersLocal,
        urdfContent: tracedUrdfContent,
      })
    );

    chain?.recommendedRepair?.steps.forEach((step, index) => {
      tracedUrdfContent = applySingleRepairStep({
        step,
        linkCentersLocal,
        urdfContent: tracedUrdfContent,
      });
      const currentMaxResidual = Math.max(
        ...resolveTrackedResidualDistances({
          chain: chain!,
          linkCentersLocal,
          urdfContent: tracedUrdfContent,
        })
      );
      expect(currentMaxResidual).toBeLessThan(
        previousMaxResidual - RESIDUAL_IMPROVEMENT_EPSILON_METERS
      );
      previousMaxResidual = currentMaxResidual;
      expect(index).toBeLessThan(2);
    });

    expect(previousMaxResidual).toBeLessThan(REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS);
    expectTrackedLinksToRemainVisuallyAligned({
      chain: chain!,
      linkCentersLocal,
      urdfContent: tracedUrdfContent,
    });
  });

  it("keeps detecting the lekiwi wheel family after the first partial auto-align step", async () => {
    const urdfContent = fs.readFileSync(LEKIWI_URDF_PATH, "utf8");
    const parsed = parseURDF(urdfContent);
    const analysis = analyzeUrdfDocument(parsed.document);
    const meshFiles = readMeshFiles();
    const linkCentersLocal = await buildVisualBoundsCenterMap({
      linkDataByName: analysis.linkDataByName,
      meshFiles,
    });
    const repeatedInertiaDiagnostics = buildRepeatedInertiaDiagnostics({
      linkDataByName: analysis.linkDataByName,
    }).filter((group) =>
      TARGET_MESH_REFERENCES.includes(
        group.meshReference as (typeof TARGET_MESH_REFERENCES)[number]
      )
    );

    const currentChain = resolveTargetChainOrThrow({
      linkCentersLocal,
      repeatedInertiaDiagnostics,
      urdfContent,
    });
    const currentStep = currentChain.recommendedRepair?.steps[0] ?? null;
    expect(currentStep).not.toBeNull();
    expect(currentStep?.childLinkName).toBe(TARGET_LINK_NAMES[0]);

    const tracedUrdfContent = applySingleRepairStep({
      step: currentStep!,
      linkCentersLocal,
      urdfContent,
    });
    const nextChain = resolveTargetChainOrThrow({
      linkCentersLocal,
      repeatedInertiaDiagnostics,
      urdfContent: tracedUrdfContent,
    });
    expect(nextChain.outlierBranchRootLinkName).toBe(TARGET_OUTLIER_BRANCH_ROOT);
    expect(collectRepeatedInertiaSymmetryScopedLinkNames(nextChain)).toEqual(
      [...TARGET_LINK_NAMES].sort((left, right) => left.localeCompare(right))
    );
    const remainingStepLinkNames =
      nextChain.recommendedRepair?.steps.map((step) => step.childLinkName) ?? [];
    expect(remainingStepLinkNames).toEqual([TARGET_WHEEL_MOUNT_LINK_NAME]);
  });

  it("keeps the ST3215 servo visually aligned after the root rigid-island move", async () => {
    const urdfContent = fs.readFileSync(LEKIWI_URDF_PATH, "utf8");
    const parsed = parseURDF(urdfContent);
    const analysis = analyzeUrdfDocument(parsed.document);
    const meshFiles = readMeshFiles();
    const linkCentersLocal = await buildVisualBoundsCenterMap({
      linkDataByName: analysis.linkDataByName,
      meshFiles,
    });
    const repeatedInertiaDiagnostics = buildRepeatedInertiaDiagnostics({
      linkDataByName: analysis.linkDataByName,
    }).filter((group) =>
      TARGET_MESH_REFERENCES.includes(
        group.meshReference as (typeof TARGET_MESH_REFERENCES)[number]
      )
    );
    const chain = resolveTargetChainOrThrow({
      linkCentersLocal,
      repeatedInertiaDiagnostics,
      urdfContent,
    });

    const initialResiduals = resolveTrackedResidualDistancesByLinkName({
      chain,
      linkCentersLocal,
      urdfContent,
    });

    const rootStep = chain.recommendedRepair?.steps[0] ?? null;
    const wheelMountStep = chain.recommendedRepair?.steps[1] ?? null;
    expect(rootStep).not.toBeNull();
    expect(wheelMountStep).not.toBeNull();
    if (!rootStep || !wheelMountStep) {
      return;
    }

    const afterRootStepUrdf = applySingleRepairStep({
      step: rootStep,
      linkCentersLocal,
      urdfContent,
    });
    const afterRootStepResiduals = resolveTrackedResidualDistancesByLinkName({
      chain,
      linkCentersLocal,
      urdfContent: afterRootStepUrdf,
    });

    const afterWheelMountStepUrdf = applySingleRepairStep({
      step: wheelMountStep,
      linkCentersLocal,
      urdfContent: afterRootStepUrdf,
    });
    const afterWheelMountStepResiduals = resolveTrackedResidualDistancesByLinkName({
      chain,
      linkCentersLocal,
      urdfContent: afterWheelMountStepUrdf,
    });

    const driveResidualAfterRoot =
      afterRootStepResiduals.get("drive_motor_mount-v11-2") ?? Number.POSITIVE_INFINITY;
    const servoResidualInitial =
      initialResiduals.get("ST3215_Servo_Motor-v1-2") ?? Number.POSITIVE_INFINITY;
    const servoResidualAfterRoot =
      afterRootStepResiduals.get("ST3215_Servo_Motor-v1-2") ?? Number.POSITIVE_INFINITY;
    const servoResidualAfterWheelMount =
      afterWheelMountStepResiduals.get("ST3215_Servo_Motor-v1-2") ?? Number.POSITIVE_INFINITY;
    const wheelMountResidualAfterWheelMount =
      afterWheelMountStepResiduals.get("omni_wheel_mount-v5-2") ?? Number.POSITIVE_INFINITY;
    const wheelBodyResidualAfterWheelMount =
      afterWheelMountStepResiduals.get("4-Omni-Directional-Wheel_Single_Body-v1-2") ??
      Number.POSITIVE_INFINITY;

    expect(driveResidualAfterRoot).toBeLessThan(REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS);
    expect(servoResidualAfterRoot).toBeLessThan(servoResidualInitial);
    expect(servoResidualAfterRoot).toBeLessThan(
      REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS
    );
    expect(servoResidualAfterWheelMount).toBeCloseTo(
      servoResidualAfterRoot,
      9
    );
    expect(wheelMountResidualAfterWheelMount).toBeLessThan(
      REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS
    );
    expect(wheelBodyResidualAfterWheelMount).toBeLessThan(
      REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS
    );
  });

  it("reports centroid-based residuals for the fully aligned lekiwi wheel meshes", async () => {
    const urdfContent = fs.readFileSync(LEKIWI_URDF_PATH, "utf8");
    const parsed = parseURDF(urdfContent);
    const analysis = analyzeUrdfDocument(parsed.document);
    const meshFiles = readMeshFiles();
    const boundsCenterMap = await buildVisualBoundsCenterMap({
      linkDataByName: analysis.linkDataByName,
      meshFiles,
    });
    const surfaceCentroidMap = await buildVisualSurfaceCentroidMap({
      linkDataByName: analysis.linkDataByName,
      meshFiles,
    });
    const repeatedInertiaDiagnostics = buildRepeatedInertiaDiagnostics({
      linkDataByName: analysis.linkDataByName,
    }).filter((group) =>
      TARGET_MESH_REFERENCES.includes(
        group.meshReference as (typeof TARGET_MESH_REFERENCES)[number]
      )
    );
    const chain = resolveTargetChainOrThrow({
      linkCentersLocal: boundsCenterMap,
      repeatedInertiaDiagnostics,
      urdfContent,
    });
    const fixResult = await applyRepeatedInertiaSymmetryFix({
      chain,
      linkCentersLocal: boundsCenterMap,
      repeatedInertiaDiagnostics,
      urdfContent,
    });
    expect(fixResult.ok).toBe(true);
    if (!fixResult.ok) {
      return;
    }

    const centroidChain = resolveTargetChainOrThrow({
      linkCentersLocal: surfaceCentroidMap,
      repeatedInertiaDiagnostics,
      urdfContent,
    });
    const centroidResiduals = resolveTrackedResidualDistancesByLinkName({
      chain: centroidChain,
      linkCentersLocal: surfaceCentroidMap,
      urdfContent: fixResult.draftUrdfContent,
    });
    const driveMountResidualMeters =
      centroidResiduals.get(TARGET_DRIVE_MOUNT_LINK_NAME) ?? Number.POSITIVE_INFINITY;
    const servoResidualMeters =
      centroidResiduals.get(TARGET_SERVO_LINK_NAME) ?? Number.POSITIVE_INFINITY;
    const wheelMountResidualMeters =
      centroidResiduals.get(TARGET_WHEEL_MOUNT_LINK_NAME) ?? Number.POSITIVE_INFINITY;
    const wheelBodyResidualMeters =
      centroidResiduals.get(TARGET_WHEEL_BODY_LINK_NAME) ?? Number.POSITIVE_INFINITY;

    expect(servoResidualMeters).toBeLessThan(REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS);
    expect(wheelMountResidualMeters).toBeLessThan(
      REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS
    );
    expect(wheelBodyResidualMeters).toBeLessThan(
      REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS
    );
    expect(driveMountResidualMeters).toBeGreaterThan(servoResidualMeters);
  });

  it("preserves the outlier branch fixed subassemblies while auto-align runs", async () => {
    const urdfContent = fs.readFileSync(LEKIWI_URDF_PATH, "utf8");
    const parsed = parseURDF(urdfContent);
    const analysis = analyzeUrdfDocument(parsed.document);
    const meshFiles = readMeshFiles();
    const linkCentersLocal = await buildVisualBoundsCenterMap({
      linkDataByName: analysis.linkDataByName,
      meshFiles,
    });
    const repeatedInertiaDiagnostics = buildRepeatedInertiaDiagnostics({
      linkDataByName: analysis.linkDataByName,
    }).filter((group) =>
      TARGET_MESH_REFERENCES.includes(
        group.meshReference as (typeof TARGET_MESH_REFERENCES)[number]
      )
    );
    const chain = resolveTargetChainOrThrow({
      linkCentersLocal,
      repeatedInertiaDiagnostics,
      urdfContent,
    });
    const fixResult = await applyRepeatedInertiaSymmetryFix({
      chain,
      linkCentersLocal,
      repeatedInertiaDiagnostics,
      urdfContent,
    });
    expect(fixResult.ok).toBe(true);
    if (!fixResult.ok) {
      return;
    }

    const beforeRobot = parseRepeatedInertiaSymmetryRobot(urdfContent, {
      linkCentersLocal,
    });
    const alignedRobot = parseRepeatedInertiaSymmetryRobot(fixResult.draftUrdfContent, {
      linkCentersLocal,
    });
    expect(beforeRobot).not.toBeNull();
    expect(alignedRobot).not.toBeNull();
    if (!beforeRobot || !alignedRobot) {
      return;
    }
    const fixedComparisons = [
      {
        fromLinkKey: "branchRootLinkName",
        label: "drive mount -> servo",
        toLinkKey: "servoLinkName",
      },
      {
        fromLinkKey: "wheelMountLinkName",
        label: "wheel mount -> wheel body",
        toLinkKey: "wheelBodyLinkName",
      },
    ] as const;
    const outlierBranch = LEKIWI_WHEEL_BRANCH_FAMILY[2];

    fixedComparisons.forEach((comparison) => {
      const beforeTransform = resolveRelativeLinkTransform({
        fromLinkName: outlierBranch[comparison.fromLinkKey],
        robot: beforeRobot,
        toLinkName: outlierBranch[comparison.toLinkKey],
      });
      const afterTransform = resolveRelativeLinkTransform({
        fromLinkName: outlierBranch[comparison.fromLinkKey],
        robot: alignedRobot,
        toLinkName: outlierBranch[comparison.toLinkKey],
      });
      expect(beforeTransform).not.toBeNull();
      expect(afterTransform).not.toBeNull();
      if (!beforeTransform || !afterTransform) {
        return;
      }
      expect(
        afterTransform.position.distanceTo(beforeTransform.position),
        `${comparison.label} position drift`
      ).toBeLessThan(BRANCH_LOCAL_POSITION_EPSILON_METERS);
      expect(
        resolveQuaternionAngleRadians(afterTransform.quaternion, beforeTransform.quaternion),
        `${comparison.label} orientation drift`
      ).toBeLessThan(BRANCH_LOCAL_ANGLE_EPSILON_RADIANS);
    });
  });
});
