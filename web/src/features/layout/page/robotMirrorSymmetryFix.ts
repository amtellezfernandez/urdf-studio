import * as THREE from "three";

import { analyzeUrdfDocument, type LinkData } from "@/shared/lib/urdfCore";
import { parseURDF } from "@/shared/lib/urdfBrowser";
import type { MeshFiles } from "@/shared/types/feature";
import { changeJointOrigin } from "@/features/urdf/editor/urdfEditorActions";
import { updateInertialInLink } from "@/features/urdf/editor/updateLinkData";
import {
  buildRobotMirrorSymmetryAlignmentTargets,
  type RobotMirrorOrientationMode,
  type RobotMirrorSymmetryAlignmentTarget,
  type RobotMirrorSymmetryCheck,
} from "@/features/layout/page/robotMirrorSymmetry";
import {
  ROBOT_MIRROR_INERTIAL_CENTER_REPAIR_MIN_STEP_METERS,
  ROBOT_MIRROR_SYMMETRY_REPAIR_MAX_VALIDATION_RESIDUAL_METERS,
  ROBOT_MIRROR_SYMMETRY_REPAIR_MIN_STEP_RADIANS,
  ROBOT_MIRROR_SYMMETRY_REPAIR_MIN_STEP_METERS,
} from "@/features/layout/page/robotMirrorSymmetryParams";
import type { RobotMirrorSelectionLink } from "@/features/layout/page/robotMirrorSymmetrySelection";
import { toSortedUniqueRobotMirrorLinkNames } from "@/features/layout/page/robotMirrorLinkNames";
import {
  parseRepeatedInertiaSymmetryRobot,
  type ParsedRobot,
  type RepeatedInertiaSymmetryLinkCentersLocal,
} from "@/features/layout/page/repeatedInertiaSymmetryRobot";
import { buildLinkCollisionGeometryReferences } from "@/features/viewer/inertiaGeometryReference";
import { computeReliableInertiaBox } from "@/features/viewer/inertialMath";

const URDF_RPY_ORDER: THREE.EulerOrder = "ZYX";
const LINK_FRAME_AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
] as const;

export type RobotMirrorLinkResult = {
  counterpartLinkName: string | null;
  finalResidualMeters: number | null;
  linkName: string;
  movedDistanceMeters: number;
  orientationDecision:
    | RobotMirrorSymmetryAlignmentTarget["orientationDecision"]
    | "no-automatic-target";
  orientationSkipReason:
    | RobotMirrorSymmetryAlignmentTarget["orientationSkipReason"]
    | "no-automatic-target";
  planeNormalResidualRadians: number | null;
  repairMode:
    | "ignored"
    | "inertia-center-and-orientation"
    | "inertia-center-only"
    | "orientation-only"
    | "position-and-orientation"
    | "position-only"
    | "unchanged";
  rotationAppliedRadians: number;
  inertialOriginMovedDistanceMeters?: number;
  selectionStatus: RobotMirrorSelectionLink["status"];
};

export type RobotMirrorOutcome = {
  linkResults?: RobotMirrorLinkResult[];
  message: string;
  tone: "success" | "warning";
};
export type RobotMirrorFixMode = "center-only" | "full-align" | "orientation-only";

export type RobotMirrorSymmetryFixResult =
  | {
      ok: true;
      alignedTargetLinkCount: number;
      appliedStepCount: number;
      draftUrdfContent: string;
      ignoredSelectedLinkCount: number;
      linkResults: RobotMirrorLinkResult[];
      summary: string;
    }
  | {
      ok: false;
      error: string;
    };

export type RobotMirrorFixAvailability = {
  centerOnlyActionableTargetCount: number;
  centerOnlyAvailable: boolean;
  orientationOnlyActionableTargetCount: number;
  orientationOnlyAvailable: boolean;
};

export type RobotMirrorActionableSelection = {
  availability: RobotMirrorFixAvailability;
  deemphasizedVisualizationLinkNames: string[];
  visualizationLinkNames: string[];
};

const INVALID_URDF_ERROR = "Mirror repair requires a valid URDF.";
const NO_SELECTION_ERROR = "Select at least one mirror link before running Auto Align Mirror.";
const NO_ACTIONABLE_TARGETS_ERROR =
  "The selected mirror links do not expose any automatic mirror targets.";
const ALREADY_ALIGNED_ERROR =
  "The selected mirror links are already aligned closely enough for automatic repair.";

const buildUnavailableRobotMirrorFixAvailability = (): RobotMirrorFixAvailability => ({
  centerOnlyActionableTargetCount: 0,
  centerOnlyAvailable: false,
  orientationOnlyActionableTargetCount: 0,
  orientationOnlyAvailable: false,
});

const toPositionTuple = (vector: THREE.Vector3): [number, number, number] => [
  vector.x,
  vector.y,
  vector.z,
];

const toQuaternion = (value: readonly number[]): THREE.Quaternion =>
  new THREE.Quaternion(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1).normalize();

const toRpyTuple = (quaternion: THREE.Quaternion): [number, number, number] => {
  const euler = new THREE.Euler().setFromQuaternion(quaternion, URDF_RPY_ORDER);
  return [euler.x, euler.y, euler.z];
};

const parseMirrorRobotOrThrow = ({
  linkCentersLocal,
  urdfContent,
}: {
  linkCentersLocal?: RepeatedInertiaSymmetryLinkCentersLocal | null;
  urdfContent: string;
}): ParsedRobot => {
  const robot = parseRepeatedInertiaSymmetryRobot(urdfContent, {
    linkCentersLocal,
  });
  if (!robot) {
    throw new Error(INVALID_URDF_ERROR);
  }
  return robot;
};

const resolveLinkAlignmentPointWorld = (
  robot: ParsedRobot,
  linkName: string
): THREE.Vector3 | null =>
  robot.linkReferenceCentersWorld.get(linkName) ?? robot.linkWorldPositions.get(linkName) ?? null;

const resolveLinkWorldQuaternion = (robot: ParsedRobot, linkName: string): THREE.Quaternion | null => {
  const linkMatrix = robot.linkWorldMatrices.get(linkName) ?? null;
  return linkMatrix ? new THREE.Quaternion().setFromRotationMatrix(linkMatrix).normalize() : null;
};

const resolvePlaneNormalResidualRadians = ({
  planeNormalWorld,
  worldQuaternion,
}: {
  planeNormalWorld: THREE.Vector3;
  worldQuaternion: THREE.Quaternion;
}): number => {
  const normalizedPlaneNormal = planeNormalWorld.clone().normalize();
  const bestAxisDot = Math.max(
    ...LINK_FRAME_AXES.map((axisLocal) =>
      Math.abs(axisLocal.clone().applyQuaternion(worldQuaternion).normalize().dot(normalizedPlaneNormal))
    )
  );
  return Math.acos(THREE.MathUtils.clamp(bestAxisDot, -1, 1));
};

const buildForcedPlaneParallelWorldQuaternion = ({
  currentWorldQuaternion,
  planeNormalWorld,
}: {
  currentWorldQuaternion: THREE.Quaternion;
  planeNormalWorld: THREE.Vector3;
}): THREE.Quaternion | null => {
  const normalizedPlaneNormal = planeNormalWorld.clone().normalize();
  const candidates = LINK_FRAME_AXES.map((axisLocal) => {
    const axisWorld = axisLocal.clone().applyQuaternion(currentWorldQuaternion).normalize();
    const axisSign = axisWorld.dot(normalizedPlaneNormal) >= 0 ? 1 : -1;
    const targetAxisWorld = normalizedPlaneNormal.clone().multiplyScalar(axisSign);
    const alignmentQuaternion = new THREE.Quaternion().setFromUnitVectors(axisWorld, targetAxisWorld);
    return {
      deltaRadians: axisWorld.angleTo(targetAxisWorld),
      quaternion: currentWorldQuaternion.clone().premultiply(alignmentQuaternion).normalize(),
    };
  }).sort((left, right) => left.deltaRadians - right.deltaRadians);
  return candidates[0]?.quaternion ?? null;
};

const resolveLinkDepth = ({
  linkName,
  parentByChildLink,
}: {
  linkName: string;
  parentByChildLink: ReadonlyMap<string, string>;
}): number => {
  let depth = 0;
  let cursor = linkName;
  while (parentByChildLink.has(cursor)) {
    cursor = parentByChildLink.get(cursor)!;
    depth += 1;
  }
  return depth;
};

const buildSelectedMirrorTargets = ({
  check,
  orientationMode,
  robot,
  selectedLinkNames,
  selectionLinks,
}: {
  check: RobotMirrorSymmetryCheck;
  orientationMode: RobotMirrorOrientationMode;
  robot: ParsedRobot;
  selectedLinkNames: readonly string[];
  selectionLinks: readonly RobotMirrorSelectionLink[];
}): {
  actionableTargets: RobotMirrorSymmetryAlignmentTarget[];
  ignoredSelectedLinks: RobotMirrorSelectionLink[];
  selectedSelectionLinks: RobotMirrorSelectionLink[];
  ignoredSelectedLinkCount: number;
  selectedLinkCount: number;
  selectedMeshCount: number;
} => {
  const selectedLinkNameSet = new Set(selectedLinkNames);
  const selectedSelectionLinks = selectionLinks.filter((selectionLink) =>
    selectedLinkNameSet.has(selectionLink.linkName)
  );
  const targetByLinkName = new Map<string, RobotMirrorSymmetryAlignmentTarget>();
  const selectionLinksByGroupKey = new Map<string, RobotMirrorSelectionLink[]>();

  selectionLinks.forEach((selectionLink) => {
    const currentLinks = selectionLinksByGroupKey.get(selectionLink.groupKey) ?? [];
    currentLinks.push(selectionLink);
    selectionLinksByGroupKey.set(selectionLink.groupKey, currentLinks);
  });

  Array.from(new Set(selectedSelectionLinks.map((selectionLink) => selectionLink.groupKey))).forEach(
    (groupKey) => {
      const groupSelectionLinks = selectionLinksByGroupKey.get(groupKey) ?? [];
      const groupSelectedLinkNameSet = new Set(
        groupSelectionLinks
          .filter((selectionLink) => selectedLinkNameSet.has(selectionLink.linkName))
          .map((selectionLink) => selectionLink.linkName)
      );
      if (groupSelectedLinkNameSet.size === 0) {
        return;
      }
    buildRobotMirrorSymmetryAlignmentTargets({
      check,
      linkNames: groupSelectionLinks.map((selectionLink) => selectionLink.linkName),
      orientationMode,
      robot,
    }).forEach((target) => {
      if (groupSelectedLinkNameSet.has(target.linkName)) {
        targetByLinkName.set(target.linkName, target);
      }
    });
    }
  );

  const actionableTargets = Array.from(targetByLinkName.values())
    .filter((target) => robot.jointByChildLink.has(target.linkName))
    .sort(
      (left, right) =>
        resolveLinkDepth({
          linkName: left.linkName,
          parentByChildLink: robot.parentByChildLink,
        }) -
          resolveLinkDepth({
            linkName: right.linkName,
            parentByChildLink: robot.parentByChildLink,
          }) || left.linkName.localeCompare(right.linkName)
    );
  const actionableLinkNameSet = new Set(actionableTargets.map((target) => target.linkName));
  const ignoredSelectedLinks = selectedSelectionLinks.filter(
    (selectionLink) => !actionableLinkNameSet.has(selectionLink.linkName)
  );
  const selectedLinkCount = new Set(selectedSelectionLinks.map((selectionLink) => selectionLink.linkName)).size;

  return {
    actionableTargets,
    ignoredSelectedLinks,
    ignoredSelectedLinkCount: ignoredSelectedLinks.length,
    selectedSelectionLinks,
    selectedLinkCount,
    selectedMeshCount: new Set(selectedSelectionLinks.map((selectionLink) => selectionLink.meshLabel)).size,
  };
};

const buildRobotMirrorLinkResults = ({
  actionableTargets,
  ignoredSelectedLinks,
  initialRobot,
  planeNormalWorld,
  repairedRobot,
  selectedSelectionLinks,
}: {
  actionableTargets: readonly RobotMirrorSymmetryAlignmentTarget[];
  ignoredSelectedLinks: readonly RobotMirrorSelectionLink[];
  initialRobot: ParsedRobot;
  planeNormalWorld: THREE.Vector3;
  repairedRobot: ParsedRobot;
  selectedSelectionLinks: readonly RobotMirrorSelectionLink[];
}): RobotMirrorLinkResult[] => {
  const targetByLinkName = new Map(actionableTargets.map((target) => [target.linkName, target] as const));
  const ignoredLinkNameSet = new Set(ignoredSelectedLinks.map((selectionLink) => selectionLink.linkName));

  return [...selectedSelectionLinks]
    .sort((left, right) => left.linkName.localeCompare(right.linkName))
    .map((selectionLink) => {
      const target = targetByLinkName.get(selectionLink.linkName) ?? null;
      if (!target || ignoredLinkNameSet.has(selectionLink.linkName)) {
        return {
          counterpartLinkName: selectionLink.counterpartLinkName,
          finalResidualMeters: null,
          linkName: selectionLink.linkName,
          movedDistanceMeters: 0,
          orientationDecision: "no-automatic-target",
          orientationSkipReason: "no-automatic-target",
          planeNormalResidualRadians: null,
          repairMode: "ignored",
          rotationAppliedRadians: 0,
          selectionStatus: selectionLink.status,
        } satisfies RobotMirrorLinkResult;
      }

      const initialAlignmentPoint = resolveLinkAlignmentPointWorld(initialRobot, selectionLink.linkName);
      const finalAlignmentPoint = resolveLinkAlignmentPointWorld(repairedRobot, selectionLink.linkName);
      const initialWorldQuaternion = resolveLinkWorldQuaternion(initialRobot, selectionLink.linkName);
      const finalWorldQuaternion = resolveLinkWorldQuaternion(repairedRobot, selectionLink.linkName);
      const targetAlignmentPoint = new THREE.Vector3().fromArray(target.targetPositionMeters);
      const movedDistanceMeters =
        initialAlignmentPoint && finalAlignmentPoint
          ? initialAlignmentPoint.distanceTo(finalAlignmentPoint)
          : 0;
      const rotationAppliedRadians =
        initialWorldQuaternion && finalWorldQuaternion
          ? initialWorldQuaternion.angleTo(finalWorldQuaternion)
          : 0;
      const finalResidualMeters = finalAlignmentPoint
        ? finalAlignmentPoint.distanceTo(targetAlignmentPoint)
        : null;
      const planeNormalResidualRadians = finalWorldQuaternion
        ? resolvePlaneNormalResidualRadians({
            planeNormalWorld,
            worldQuaternion: finalWorldQuaternion,
          })
        : null;
      const repairMode =
        movedDistanceMeters < ROBOT_MIRROR_SYMMETRY_REPAIR_MIN_STEP_METERS &&
        rotationAppliedRadians < ROBOT_MIRROR_SYMMETRY_REPAIR_MIN_STEP_RADIANS
          ? "unchanged"
          : movedDistanceMeters < ROBOT_MIRROR_SYMMETRY_REPAIR_MIN_STEP_METERS
            ? "orientation-only"
          : rotationAppliedRadians < ROBOT_MIRROR_SYMMETRY_REPAIR_MIN_STEP_RADIANS
            ? "position-only"
            : "position-and-orientation";

      return {
        counterpartLinkName: selectionLink.counterpartLinkName,
        finalResidualMeters,
        linkName: selectionLink.linkName,
        movedDistanceMeters,
        orientationDecision: target.orientationDecision,
        orientationSkipReason: target.orientationSkipReason,
        planeNormalResidualRadians,
        repairMode,
        rotationAppliedRadians,
        selectionStatus: selectionLink.status,
      } satisfies RobotMirrorLinkResult;
    });
};

const validateMirrorTargets = ({
  linkCentersLocal,
  targets,
  urdfContent,
}: {
  linkCentersLocal?: RepeatedInertiaSymmetryLinkCentersLocal | null;
  targets: readonly RobotMirrorSymmetryAlignmentTarget[];
  urdfContent: string;
}): string | null => {
  const repairedRobot = parseRepeatedInertiaSymmetryRobot(urdfContent, {
    linkCentersLocal,
  });
  if (!repairedRobot) {
    return INVALID_URDF_ERROR;
  }

  for (const target of targets) {
    const actualPointWorld = resolveLinkAlignmentPointWorld(repairedRobot, target.linkName);
    if (!actualPointWorld) {
      return `Mirror repair could not resolve the final pose for ${target.linkName}.`;
    }
    const residualMeters = actualPointWorld.distanceTo(
      new THREE.Vector3().fromArray(target.targetPositionMeters)
    );
    if (residualMeters > ROBOT_MIRROR_SYMMETRY_REPAIR_MAX_VALIDATION_RESIDUAL_METERS) {
      return `Mirror repair left ${target.linkName} ${(
        residualMeters * 1000
      ).toFixed(1)} mm away from its mirror target.`;
    }
  }

  return null;
};

const buildMirrorFixSummary = ({
  actionableTargetCount,
  appliedStepCount,
  fixMode,
  ignoredSelectedLinkCount,
  selectedMeshCount,
}: {
  actionableTargetCount: number;
  appliedStepCount: number;
  fixMode: RobotMirrorFixMode;
  ignoredSelectedLinkCount: number;
  selectedMeshCount: number;
}): string => {
  const meshLabel = selectedMeshCount === 1 ? "mesh" : "meshes";
  const targetLabel = actionableTargetCount === 1 ? "target" : "targets";
  const jointLabel = appliedStepCount === 1 ? "joint" : "joints";
  const actionLabel =
    fixMode === "orientation-only"
      ? "Aligned orientation for"
      : fixMode === "center-only"
        ? "Centered"
        : "Aligned";
  if (ignoredSelectedLinkCount === 0) {
    return `${actionLabel} ${actionableTargetCount} mirror ${targetLabel} across ${selectedMeshCount} selected ${meshLabel} with ${appliedStepCount} ${jointLabel}.`;
  }
  const ignoredLabel = ignoredSelectedLinkCount === 1 ? "link" : "links";
  return `${actionLabel} ${actionableTargetCount} mirror ${targetLabel} across ${selectedMeshCount} selected ${meshLabel} with ${appliedStepCount} ${jointLabel}; ${ignoredSelectedLinkCount} selected ${ignoredLabel} could not be mirrored automatically.`;
};

const collectCenterOnlyActionableLinkNames = ({
  robot,
  targets,
}: {
  robot: ParsedRobot;
  targets: readonly RobotMirrorSymmetryAlignmentTarget[];
}): string[] =>
  toSortedUniqueRobotMirrorLinkNames(
    targets.flatMap((target) => {
      const currentAlignmentPoint = resolveLinkAlignmentPointWorld(robot, target.linkName);
      if (!currentAlignmentPoint) {
        return [];
      }
      const targetAlignmentPoint = new THREE.Vector3().fromArray(target.targetPositionMeters);
      return currentAlignmentPoint.distanceTo(targetAlignmentPoint) >=
        ROBOT_MIRROR_SYMMETRY_REPAIR_MIN_STEP_METERS
        ? [target.linkName]
        : [];
    })
  );

type MirrorOrientationAssessment = {
  canAssess: boolean;
  needsCenterFix: boolean;
  needsFix: boolean;
  needsOrientationFix: boolean;
};

const resolveReferenceCenterInLinkFrame = ({
  inertialOrigin,
  inertialQuaternion,
  referenceCenterInInertialFrame,
}: {
  inertialOrigin: [number, number, number];
  inertialQuaternion: THREE.Quaternion;
  referenceCenterInInertialFrame: readonly number[];
}): THREE.Vector3 =>
  new THREE.Vector3(
    referenceCenterInInertialFrame[0] ?? 0,
    referenceCenterInInertialFrame[1] ?? 0,
    referenceCenterInInertialFrame[2] ?? 0
  )
    .applyQuaternion(inertialQuaternion)
    .add(new THREE.Vector3().fromArray(inertialOrigin));

const buildMirrorOrientationAssessmentByLinkName = async ({
  meshFiles,
  packageRoots,
  planeNormalWorld,
  selectedSelectionLinks,
  urdfBasePath,
  urdfContent,
}: {
  meshFiles: MeshFiles;
  packageRoots?: Record<string, string[]>;
  planeNormalWorld: THREE.Vector3;
  selectedSelectionLinks: readonly RobotMirrorSelectionLink[];
  urdfBasePath?: string;
  urdfContent: string;
}): Promise<Map<string, MirrorOrientationAssessment>> => {
  const assessmentByLinkName = new Map<string, MirrorOrientationAssessment>();
  if (selectedSelectionLinks.length === 0) {
    return assessmentByLinkName;
  }

  const parsed = parseURDF(urdfContent);
  const analysis = analyzeUrdfDocument(parsed.document);
  const geometryReferences = await buildLinkCollisionGeometryReferences({
    linkDataByName: analysis.linkDataByName,
    meshFiles,
    packageRoots,
    urdfBasePath,
  });
  const currentRobot = parseRepeatedInertiaSymmetryRobot(urdfContent);
  if (!currentRobot) {
    return assessmentByLinkName;
  }

  selectedSelectionLinks.forEach((selectionLink) => {
    const linkData = analysis.linkDataByName[selectionLink.linkName] as LinkData | undefined;
    const currentLinkMatrix = currentRobot.linkWorldMatrices.get(selectionLink.linkName) ?? null;
    const currentLinkWorldQuaternion = currentLinkMatrix
      ? new THREE.Quaternion().setFromRotationMatrix(currentLinkMatrix).normalize()
      : null;
    if (!linkData?.inertial || !currentLinkWorldQuaternion) {
      assessmentByLinkName.set(selectionLink.linkName, {
        canAssess: false,
        needsCenterFix: false,
        needsFix: false,
        needsOrientationFix: false,
      });
      return;
    }

    const reliableBox = computeReliableInertiaBox({
      geometryReference: geometryReferences.get(selectionLink.linkName) ?? null,
      inertia: linkData.inertial.inertia,
      inertialOrigin: linkData.inertial.origin.xyz,
      inertialRpy: linkData.inertial.origin.rpy,
      mass: linkData.inertial.mass,
    });
    if (!reliableBox) {
      assessmentByLinkName.set(selectionLink.linkName, {
        canAssess: false,
        needsCenterFix: false,
        needsFix: false,
        needsOrientationFix: false,
      });
      return;
    }

    const inertialQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        linkData.inertial.origin.rpy[0],
        linkData.inertial.origin.rpy[1],
        linkData.inertial.origin.rpy[2],
        URDF_RPY_ORDER
      )
    );
    const currentBoxWorldQuaternion = currentLinkWorldQuaternion
      .clone()
      .multiply(inertialQuaternion)
      .multiply(reliableBox.box.rotation.clone())
      .normalize();
    const targetBoxWorldQuaternion = buildForcedPlaneParallelWorldQuaternion({
      currentWorldQuaternion: currentBoxWorldQuaternion,
      planeNormalWorld,
    });
    if (!targetBoxWorldQuaternion) {
      assessmentByLinkName.set(selectionLink.linkName, {
        canAssess: false,
        needsCenterFix: false,
        needsFix: false,
        needsOrientationFix: false,
      });
      return;
    }

    const targetInertialQuaternion = currentLinkWorldQuaternion
      .clone()
      .invert()
      .multiply(targetBoxWorldQuaternion)
      .multiply(reliableBox.box.rotation.clone().invert())
      .normalize();
    const rotationAppliedRadians = inertialQuaternion
      .clone()
      .normalize()
      .angleTo(targetInertialQuaternion);
    const targetInertialOrigin = reliableBox.referenceBox?.center
      ? resolveReferenceCenterInLinkFrame({
          inertialOrigin: linkData.inertial.origin.xyz,
          inertialQuaternion,
          referenceCenterInInertialFrame: reliableBox.referenceBox.center,
        })
      : null;
    const currentInertialOrigin = new THREE.Vector3().fromArray(linkData.inertial.origin.xyz);
    const inertialOriginMovedDistanceMeters = targetInertialOrigin
      ? currentInertialOrigin.distanceTo(targetInertialOrigin)
      : 0;
    const needsCenterFix =
      inertialOriginMovedDistanceMeters >= ROBOT_MIRROR_INERTIAL_CENTER_REPAIR_MIN_STEP_METERS;
    const needsOrientationFix =
      rotationAppliedRadians >= ROBOT_MIRROR_SYMMETRY_REPAIR_MIN_STEP_RADIANS;
    assessmentByLinkName.set(selectionLink.linkName, {
      canAssess: true,
      needsCenterFix,
      needsFix: needsOrientationFix || needsCenterFix,
      needsOrientationFix,
    });
  });

  return assessmentByLinkName;
};

export const resolveRobotMirrorActionableSelection = async ({
  alwaysIncludeVisualizationLinkNames = [],
  linkCentersLocal,
  meshFiles,
  packageRoots,
  robotMirrorSymmetryCheck,
  selectedLinkNames,
  selectionLinks,
  urdfBasePath,
  urdfContent,
}: {
  alwaysIncludeVisualizationLinkNames?: readonly string[];
  linkCentersLocal?: RepeatedInertiaSymmetryLinkCentersLocal | null;
  meshFiles: MeshFiles;
  packageRoots?: Record<string, string[]>;
  robotMirrorSymmetryCheck: RobotMirrorSymmetryCheck | null | undefined;
  selectedLinkNames: readonly string[];
  selectionLinks: readonly RobotMirrorSelectionLink[];
  urdfBasePath?: string;
  urdfContent: string;
}): Promise<RobotMirrorActionableSelection> => {
  const unavailableSelection: RobotMirrorActionableSelection = {
    availability: buildUnavailableRobotMirrorFixAvailability(),
    deemphasizedVisualizationLinkNames: [],
    visualizationLinkNames: [],
  };
  if (!robotMirrorSymmetryCheck || selectedLinkNames.length === 0) {
    return unavailableSelection;
  }

  let parsedRobot: ParsedRobot;
  try {
    parsedRobot = parseMirrorRobotOrThrow({
      linkCentersLocal,
      urdfContent,
    });
  } catch {
    return unavailableSelection;
  }

  const { actionableTargets, selectedSelectionLinks, selectedLinkCount } = buildSelectedMirrorTargets({
    check: robotMirrorSymmetryCheck,
    orientationMode: "conservative",
    robot: parsedRobot,
    selectedLinkNames,
    selectionLinks,
  });
  if (selectedLinkCount === 0) {
    return unavailableSelection;
  }

  const selectedLinkNameSet = new Set(selectedLinkNames);
  const selectedAlwaysIncludedVisualizationLinkNames = toSortedUniqueRobotMirrorLinkNames(
    alwaysIncludeVisualizationLinkNames.filter((linkName) => selectedLinkNameSet.has(linkName))
  );
  const centerOnlyActionableLinkNames = collectCenterOnlyActionableLinkNames({
    robot: parsedRobot,
    targets: actionableTargets,
  });
  const planeNormalWorld = new THREE.Vector3()
    .fromArray(robotMirrorSymmetryCheck.planeNormalWorld)
    .normalize();
  const planeOriginWorld = new THREE.Vector3().fromArray(robotMirrorSymmetryCheck.originMeters);
  const orientationAssessmentByLinkName = await buildMirrorOrientationAssessmentByLinkName({
    meshFiles,
    packageRoots,
    planeNormalWorld,
    selectedSelectionLinks,
    urdfBasePath,
    urdfContent,
  });
  const orientationOnlyActionableLinkNames = toSortedUniqueRobotMirrorLinkNames(
    selectedSelectionLinks.flatMap((selectionLink) =>
      orientationAssessmentByLinkName.get(selectionLink.linkName)?.needsFix
        ? [selectionLink.linkName]
        : []
    )
  );

  const actionableVisualizationLinkNameSet = new Set([
    ...centerOnlyActionableLinkNames,
    ...orientationOnlyActionableLinkNames,
  ]);

  return {
    availability: {
      centerOnlyActionableTargetCount: centerOnlyActionableLinkNames.length,
      centerOnlyAvailable: centerOnlyActionableLinkNames.length > 0,
      orientationOnlyActionableTargetCount: orientationOnlyActionableLinkNames.length,
      orientationOnlyAvailable: orientationOnlyActionableLinkNames.length > 0,
    },
    deemphasizedVisualizationLinkNames: toSortedUniqueRobotMirrorLinkNames(
      selectedAlwaysIncludedVisualizationLinkNames.filter(
        (linkName) => {
          if (actionableVisualizationLinkNameSet.has(linkName)) {
            return false;
          }
          const currentAlignmentPoint = resolveLinkAlignmentPointWorld(parsedRobot, linkName);
          if (!currentAlignmentPoint) {
            return false;
          }
          const planeDistanceMeters = Math.abs(
            currentAlignmentPoint.clone().sub(planeOriginWorld).dot(planeNormalWorld)
          );
          if (planeDistanceMeters >= ROBOT_MIRROR_SYMMETRY_REPAIR_MIN_STEP_METERS) {
            return false;
          }
          const orientationAssessment = orientationAssessmentByLinkName.get(linkName) ?? null;
          return orientationAssessment?.canAssess === true && orientationAssessment.needsFix === false;
        }
      )
    ),
    visualizationLinkNames: toSortedUniqueRobotMirrorLinkNames([
      ...selectedAlwaysIncludedVisualizationLinkNames,
      ...centerOnlyActionableLinkNames,
      ...orientationOnlyActionableLinkNames,
    ]),
  };
};

export const applyRobotMirrorParallelFix = async ({
  meshFiles,
  packageRoots,
  robotMirrorSymmetryCheck,
  selectedLinkNames,
  selectionLinks,
  urdfBasePath,
  urdfContent,
}: {
  meshFiles: MeshFiles;
  packageRoots?: Record<string, string[]>;
  robotMirrorSymmetryCheck: RobotMirrorSymmetryCheck | null | undefined;
  selectedLinkNames: readonly string[];
  selectionLinks: readonly RobotMirrorSelectionLink[];
  urdfBasePath?: string;
  urdfContent: string;
}): Promise<RobotMirrorSymmetryFixResult> => {
  if (!robotMirrorSymmetryCheck) {
    return {
      ok: false,
      error: "Robot-wide mirror symmetry is not available for this URDF.",
    };
  }
  if (selectedLinkNames.length === 0) {
    return {
      ok: false,
      error: NO_SELECTION_ERROR,
    };
  }

  let robot: ParsedRobot;
  try {
    robot = parseMirrorRobotOrThrow({
      urdfContent,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : INVALID_URDF_ERROR,
    };
  }

  const selectedLinkNameSet = new Set(selectedLinkNames);
  const selectedSelectionLinks = selectionLinks.filter((selectionLink) =>
    selectedLinkNameSet.has(selectionLink.linkName)
  );
  if (selectedSelectionLinks.length === 0) {
    return {
      ok: false,
      error: NO_ACTIONABLE_TARGETS_ERROR,
    };
  }

  const parsed = parseURDF(urdfContent);
  const analysis = analyzeUrdfDocument(parsed.document);
  const geometryReferences = await buildLinkCollisionGeometryReferences({
    linkDataByName: analysis.linkDataByName,
    meshFiles,
    packageRoots,
    urdfBasePath,
  });
  const planeNormalWorld = new THREE.Vector3()
    .fromArray(robotMirrorSymmetryCheck.planeNormalWorld)
    .normalize();
  let nextUrdfContent = urdfContent;
  let appliedStepCount = 0;
  const linkResults: RobotMirrorLinkResult[] = [];
  let ignoredSelectedLinkCount = 0;

  for (const selectionLink of [...selectedSelectionLinks].sort((left, right) =>
    left.linkName.localeCompare(right.linkName)
  )) {
    const currentParsed = parseURDF(nextUrdfContent);
    const currentAnalysis = analyzeUrdfDocument(currentParsed.document);
    const linkData = currentAnalysis.linkDataByName[selectionLink.linkName] as LinkData | undefined;
    const currentRobot = parseRepeatedInertiaSymmetryRobot(nextUrdfContent);
    const currentLinkWorldQuaternion =
      currentRobot?.linkWorldMatrices.get(selectionLink.linkName)
        ? new THREE.Quaternion()
            .setFromRotationMatrix(currentRobot.linkWorldMatrices.get(selectionLink.linkName)!)
            .normalize()
        : null;
    if (!linkData?.inertial || !currentLinkWorldQuaternion) {
      ignoredSelectedLinkCount += 1;
      linkResults.push({
        counterpartLinkName: selectionLink.counterpartLinkName,
        finalResidualMeters: null,
        inertialOriginMovedDistanceMeters: 0,
        linkName: selectionLink.linkName,
        movedDistanceMeters: 0,
        orientationDecision: "no-automatic-target",
        orientationSkipReason: "no-automatic-target",
        planeNormalResidualRadians: null,
        repairMode: "ignored",
        rotationAppliedRadians: 0,
        selectionStatus: selectionLink.status,
      });
      continue;
    }

    const reliableBox = computeReliableInertiaBox({
      geometryReference: geometryReferences.get(selectionLink.linkName) ?? null,
      inertia: linkData.inertial.inertia,
      inertialOrigin: linkData.inertial.origin.xyz,
      inertialRpy: linkData.inertial.origin.rpy,
      mass: linkData.inertial.mass,
    });
    if (!reliableBox) {
      ignoredSelectedLinkCount += 1;
      linkResults.push({
        counterpartLinkName: selectionLink.counterpartLinkName,
        finalResidualMeters: null,
        inertialOriginMovedDistanceMeters: 0,
        linkName: selectionLink.linkName,
        movedDistanceMeters: 0,
        orientationDecision: "no-automatic-target",
        orientationSkipReason: "no-automatic-target",
        planeNormalResidualRadians: null,
        repairMode: "ignored",
        rotationAppliedRadians: 0,
        selectionStatus: selectionLink.status,
      });
      continue;
    }

    const inertialQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        linkData.inertial.origin.rpy[0],
        linkData.inertial.origin.rpy[1],
        linkData.inertial.origin.rpy[2],
        URDF_RPY_ORDER
      )
    );
    const currentBoxWorldQuaternion = currentLinkWorldQuaternion
      .clone()
      .multiply(inertialQuaternion)
      .multiply(reliableBox.box.rotation.clone())
      .normalize();
    const targetBoxWorldQuaternion = buildForcedPlaneParallelWorldQuaternion({
      currentWorldQuaternion: currentBoxWorldQuaternion,
      planeNormalWorld,
    });
    if (!targetBoxWorldQuaternion) {
      ignoredSelectedLinkCount += 1;
      linkResults.push({
        counterpartLinkName: selectionLink.counterpartLinkName,
        finalResidualMeters: null,
        inertialOriginMovedDistanceMeters: 0,
        linkName: selectionLink.linkName,
        movedDistanceMeters: 0,
        orientationDecision: "no-automatic-target",
        orientationSkipReason: "no-automatic-target",
        planeNormalResidualRadians: null,
        repairMode: "ignored",
        rotationAppliedRadians: 0,
        selectionStatus: selectionLink.status,
      });
      continue;
    }

    const targetInertialQuaternion = currentLinkWorldQuaternion
      .clone()
      .invert()
      .multiply(targetBoxWorldQuaternion)
      .multiply(reliableBox.box.rotation.clone().invert())
      .normalize();
    const currentInertialQuaternion = inertialQuaternion.clone().normalize();
    const rotationAppliedRadians = currentInertialQuaternion.angleTo(targetInertialQuaternion);
    const planeNormalResidualRadians = resolvePlaneNormalResidualRadians({
      planeNormalWorld,
      worldQuaternion: targetBoxWorldQuaternion,
    });
    const currentInertialOrigin = new THREE.Vector3().fromArray(linkData.inertial.origin.xyz);
    const targetInertialOrigin = reliableBox.referenceBox?.center
      ? resolveReferenceCenterInLinkFrame({
          inertialOrigin: linkData.inertial.origin.xyz,
          inertialQuaternion: currentInertialQuaternion,
          referenceCenterInInertialFrame: reliableBox.referenceBox.center,
        })
      : currentInertialOrigin.clone();
    const inertialOriginMovedDistanceMeters = currentInertialOrigin.distanceTo(targetInertialOrigin);
    const needsCenterFix =
      inertialOriginMovedDistanceMeters >= ROBOT_MIRROR_INERTIAL_CENTER_REPAIR_MIN_STEP_METERS;
    const needsOrientationFix =
      rotationAppliedRadians >= ROBOT_MIRROR_SYMMETRY_REPAIR_MIN_STEP_RADIANS;

    if (!needsOrientationFix && !needsCenterFix) {
      linkResults.push({
        counterpartLinkName: selectionLink.counterpartLinkName,
        finalResidualMeters: 0,
        inertialOriginMovedDistanceMeters: 0,
        linkName: selectionLink.linkName,
        movedDistanceMeters: 0,
        orientationDecision: "align-to-plane",
        orientationSkipReason: null,
        planeNormalResidualRadians,
        repairMode: "unchanged",
        rotationAppliedRadians: 0,
        selectionStatus: selectionLink.status,
      });
      continue;
    }

    nextUrdfContent = updateInertialInLink(
      nextUrdfContent,
      selectionLink.linkName,
      linkData.inertial.mass,
      linkData.inertial.inertia,
      {
        xyz: toPositionTuple(targetInertialOrigin),
        rpy: toRpyTuple(targetInertialQuaternion),
      }
    );
    appliedStepCount += 1;
    const repairMode =
      needsCenterFix && needsOrientationFix
        ? "inertia-center-and-orientation"
        : needsCenterFix
          ? "inertia-center-only"
          : "orientation-only";
    linkResults.push({
      counterpartLinkName: selectionLink.counterpartLinkName,
      finalResidualMeters: 0,
      inertialOriginMovedDistanceMeters,
      linkName: selectionLink.linkName,
      movedDistanceMeters: 0,
      orientationDecision: "align-to-plane",
      orientationSkipReason: null,
      planeNormalResidualRadians,
      repairMode,
      rotationAppliedRadians,
      selectionStatus: selectionLink.status,
    });
  }

  if (appliedStepCount === 0) {
    return {
      ok: false,
      error: ALREADY_ALIGNED_ERROR,
    };
  }

  return {
    ok: true,
    alignedTargetLinkCount: selectedSelectionLinks.length - ignoredSelectedLinkCount,
    appliedStepCount,
    draftUrdfContent: nextUrdfContent,
    ignoredSelectedLinkCount,
    linkResults,
    summary: buildMirrorFixSummary({
      actionableTargetCount: selectedSelectionLinks.length - ignoredSelectedLinkCount,
      appliedStepCount,
      fixMode: "orientation-only",
      ignoredSelectedLinkCount,
      selectedMeshCount: new Set(selectedSelectionLinks.map((selectionLink) => selectionLink.meshLabel))
        .size,
    }),
  };
};

export const applyRobotMirrorSymmetryFix = ({
  fixMode = "center-only",
  linkCentersLocal,
  orientationMode = "conservative",
  robotMirrorSymmetryCheck,
  selectedLinkNames,
  selectionLinks,
  urdfContent,
}: {
  fixMode?: RobotMirrorFixMode;
  linkCentersLocal?: RepeatedInertiaSymmetryLinkCentersLocal | null;
  orientationMode?: RobotMirrorOrientationMode;
  robotMirrorSymmetryCheck: RobotMirrorSymmetryCheck | null | undefined;
  selectedLinkNames: readonly string[];
  selectionLinks: readonly RobotMirrorSelectionLink[];
  urdfContent: string;
}): RobotMirrorSymmetryFixResult => {
  if (!robotMirrorSymmetryCheck) {
    return {
      ok: false,
      error: "Robot-wide mirror symmetry is not available for this URDF.",
    };
  }
  if (selectedLinkNames.length === 0) {
    return {
      ok: false,
      error: NO_SELECTION_ERROR,
    };
  }

  let parsedRobot: ParsedRobot;
  try {
    parsedRobot = parseMirrorRobotOrThrow({
      linkCentersLocal,
      urdfContent,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : INVALID_URDF_ERROR,
    };
  }

  const {
    actionableTargets,
    ignoredSelectedLinkCount,
    ignoredSelectedLinks,
    selectedSelectionLinks,
    selectedLinkCount,
    selectedMeshCount,
  } = buildSelectedMirrorTargets({
    check: robotMirrorSymmetryCheck,
    orientationMode,
    robot: parsedRobot,
    selectedLinkNames,
    selectionLinks,
  });
  if (selectedLinkCount === 0 || actionableTargets.length === 0) {
    return {
      ok: false,
      error: NO_ACTIONABLE_TARGETS_ERROR,
    };
  }

  let nextUrdfContent = urdfContent;
  let appliedStepCount = 0;
  const effectiveTargetPositionByLinkName = new Map<string, [number, number, number]>();
  actionableTargets.forEach((target) => {
    if (fixMode === "orientation-only") {
      const currentAlignmentPoint = resolveLinkAlignmentPointWorld(parsedRobot, target.linkName);
      effectiveTargetPositionByLinkName.set(
        target.linkName,
        currentAlignmentPoint
          ? toPositionTuple(currentAlignmentPoint)
          : target.targetPositionMeters
      );
      return;
    }
    effectiveTargetPositionByLinkName.set(target.linkName, target.targetPositionMeters);
  });
  const effectiveTargets = actionableTargets.map((target) => ({
    ...target,
    orientationDecision:
      fixMode === "center-only" ? "preserve-current" : target.orientationDecision,
    orientationSkipReason:
      fixMode === "center-only" ? null : target.orientationSkipReason,
    targetPositionMeters:
      effectiveTargetPositionByLinkName.get(target.linkName) ?? target.targetPositionMeters,
    targetWorldQuaternion: fixMode === "center-only" ? null : target.targetWorldQuaternion,
  }));

  while (true) {
    let appliedStepInPass = false;
    for (const target of effectiveTargets) {
      const currentRobot = parseMirrorRobotOrThrow({
        linkCentersLocal,
        urdfContent: nextUrdfContent,
      });
      const joint = currentRobot.jointByChildLink.get(target.linkName);
      const parentMatrix = joint
        ? currentRobot.linkWorldMatrices.get(joint.parentLinkName) ?? null
        : null;
      const currentLinkMatrix = currentRobot.linkWorldMatrices.get(target.linkName) ?? null;
      const currentLinkPosition = currentRobot.linkWorldPositions.get(target.linkName) ?? null;
      const currentAlignmentPoint = resolveLinkAlignmentPointWorld(currentRobot, target.linkName);
      if (!joint || !parentMatrix || !currentLinkMatrix || !currentLinkPosition || !currentAlignmentPoint) {
        continue;
      }

      const targetAlignmentPoint = new THREE.Vector3().fromArray(target.targetPositionMeters);
      const translationDeltaWorld = targetAlignmentPoint.clone().sub(currentAlignmentPoint);
      const currentLinkWorldQuaternion = new THREE.Quaternion()
        .setFromRotationMatrix(currentLinkMatrix)
        .normalize();
      const targetWorldQuaternion = target.targetWorldQuaternion
        ? toQuaternion(target.targetWorldQuaternion)
        : currentLinkWorldQuaternion;
      const rotationDeltaRadians = currentLinkWorldQuaternion.angleTo(targetWorldQuaternion);
      if (
        translationDeltaWorld.length() < ROBOT_MIRROR_SYMMETRY_REPAIR_MIN_STEP_METERS &&
        rotationDeltaRadians < ROBOT_MIRROR_SYMMETRY_REPAIR_MIN_STEP_RADIANS
      ) {
        continue;
      }
      const referenceCenterLocal = currentRobot.linkReferenceCentersLocal.get(target.linkName) ?? null;
      const targetLinkPosition = referenceCenterLocal
        ? targetAlignmentPoint
            .clone()
            .sub(referenceCenterLocal.clone().applyQuaternion(targetWorldQuaternion))
        : currentLinkPosition.clone().add(translationDeltaWorld);
      const targetLocalPosition = targetLinkPosition.applyMatrix4(
        new THREE.Matrix4().copy(parentMatrix).invert()
      );
      const parentWorldQuaternion = new THREE.Quaternion()
        .setFromRotationMatrix(parentMatrix)
        .normalize();
      const targetLocalQuaternion = parentWorldQuaternion
        .clone()
        .invert()
        .multiply(targetWorldQuaternion)
        .normalize();
      const result = changeJointOrigin(
        nextUrdfContent,
        joint.jointName,
        toPositionTuple(targetLocalPosition),
        toRpyTuple(targetLocalQuaternion)
      );
      if (!result.success) {
        return {
          ok: false,
          error: result.error ?? `Unable to update origin for joint "${joint.jointName}"`,
        };
      }
      nextUrdfContent = result.content;
      appliedStepCount += 1;
      appliedStepInPass = true;
      break;
    }

    if (!appliedStepInPass) {
      break;
    }
  }

  if (appliedStepCount === 0) {
    return {
      ok: false,
      error: ALREADY_ALIGNED_ERROR,
    };
  }

  const validationError = validateMirrorTargets({
    linkCentersLocal,
    targets: effectiveTargets,
    urdfContent: nextUrdfContent,
  });
  if (validationError) {
    return {
      ok: false,
      error: validationError,
    };
  }
  const repairedRobot = parseMirrorRobotOrThrow({
    linkCentersLocal,
    urdfContent: nextUrdfContent,
  });
  const planeNormalWorld = new THREE.Vector3()
    .fromArray(robotMirrorSymmetryCheck.planeNormalWorld)
    .normalize();
  const linkResults = buildRobotMirrorLinkResults({
    actionableTargets: effectiveTargets,
    ignoredSelectedLinks,
    initialRobot: parsedRobot,
    planeNormalWorld,
    repairedRobot,
    selectedSelectionLinks,
  });

  return {
    ok: true,
    alignedTargetLinkCount: actionableTargets.length,
    appliedStepCount,
    draftUrdfContent: nextUrdfContent,
    ignoredSelectedLinkCount,
    linkResults,
    summary: buildMirrorFixSummary({
      actionableTargetCount: actionableTargets.length,
      appliedStepCount,
      fixMode,
      ignoredSelectedLinkCount,
      selectedMeshCount,
    }),
  };
};
