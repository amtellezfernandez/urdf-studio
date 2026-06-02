import * as THREE from "three";

import type { LinkData } from "@/shared/lib/urdfCore";
import type { RepeatedInertiaDiagnosticGroup } from "@/features/layout/page/repeatedInertiaDiagnostics";
import {
  ROBOT_MIRROR_SYMMETRY_MAX_AUTO_ORIENTATION_DELTA_RADIANS,
  ROBOT_MIRROR_SYMMETRY_MAX_CENTER_DISTANCE_METERS,
  ROBOT_MIRROR_SYMMETRY_MAX_PAIR_RESIDUAL_METERS,
  ROBOT_MIRROR_SYMMETRY_MIN_AUTO_ORIENTATION_GAP_RADIANS,
  ROBOT_MIRROR_SYMMETRY_MIN_MATCHED_PAIR_COUNT,
  ROBOT_MIRROR_SYMMETRY_MIN_SUPPORTED_GROUP_COUNT,
  ROBOT_MIRROR_SYMMETRY_MIN_SUPPORTED_LINK_COUNT,
} from "@/features/layout/page/robotMirrorSymmetryParams";
import {
  parseRepeatedInertiaSymmetryRobot,
  type RepeatedInertiaSymmetryLinkCentersLocal,
} from "@/features/layout/page/repeatedInertiaSymmetryRobot";
import {
  buildRobotMirrorMeshLinkGroupsFromDiagnostics,
  buildRobotMirrorMeshLinkGroupsFromLinkData,
  type RobotMirrorMeshLinkGroup,
} from "@/features/layout/page/robotMirrorMeshGroups";

export type RobotMirrorSymmetryPlaneLabel = "xy" | "xz" | "yz";

type RobotMirrorPlaneCandidate = {
  normalWorld: THREE.Vector3;
  planeLabel: RobotMirrorSymmetryPlaneLabel;
};

type RobotMirrorSymmetryPair = {
  groupKey: string;
  leftLinkName: string;
  residualMeters: number;
  rightLinkName: string;
};

export type RobotMirrorSymmetryReviewGroup = {
  groupKey: string;
  maxResidualMeters: number | null;
  meshLabel: string;
  supportedLinkCount: number;
  totalLinkCount: number;
  unsupportedLinkNames: string[];
};

export type RobotMirrorSymmetryCheck = {
  averageResidualMeters: number;
  centeredLinkCount: number;
  centeredLinkNames: string[];
  matchedPairs: RobotMirrorSymmetryPair[];
  matchedPairCount: number;
  maxResidualMeters: number;
  originMeters: [number, number, number];
  pairedGroupCount: number;
  pairedLinkCount: number;
  planeLabel: RobotMirrorSymmetryPlaneLabel;
  planeNormalWorld: [number, number, number];
  reviewGroups: RobotMirrorSymmetryReviewGroup[];
  reviewLinkCount: number;
  supportedGroupCount: number;
  supportedLinkCount: number;
  supportedLinkNames: string[];
  totalRepeatedLinkCount: number;
};

type MirrorSupportEntry = {
  linkName: string;
  signedDistanceMeters: number;
  worldPosition: THREE.Vector3;
};

export type RobotMirrorSymmetryAlignmentTarget = {
  counterpartLinkName: string | null;
  linkName: string;
  mode: "centered" | "paired";
  orientationDecision: "align-to-plane" | "preserve-current";
  orientationSkipReason: "ambiguous-axis" | "rotation-too-large" | null;
  targetPositionMeters: [number, number, number];
  targetWorldQuaternion: [number, number, number, number] | null;
};
export type RobotMirrorOrientationMode = "conservative" | "force";

const toVector3Tuple = (vector: THREE.Vector3): [number, number, number] => [
  vector.x,
  vector.y,
  vector.z,
];

const toQuaternionTuple = (
  quaternion: THREE.Quaternion
): [number, number, number, number] => [
  quaternion.x,
  quaternion.y,
  quaternion.z,
  quaternion.w,
];

const LINK_FRAME_AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
] as const;
type OrientationCandidate = {
  deltaRadians: number;
  quaternion: THREE.Quaternion;
};
type PlaneParallelWorldQuaternionResult = {
  orientationDecision: RobotMirrorSymmetryAlignmentTarget["orientationDecision"];
  orientationSkipReason: RobotMirrorSymmetryAlignmentTarget["orientationSkipReason"];
  targetWorldQuaternion: THREE.Quaternion | null;
};

const resolveLinkWorldQuaternion = ({
  linkName,
  robot,
}: {
  linkName: string;
  robot: NonNullable<ReturnType<typeof parseRepeatedInertiaSymmetryRobot>>;
}): THREE.Quaternion | null => {
  const linkWorldMatrix = robot.linkWorldMatrices.get(linkName) ?? null;
  if (!linkWorldMatrix) {
    return null;
  }
  return new THREE.Quaternion().setFromRotationMatrix(linkWorldMatrix).normalize();
};

const buildPlaneParallelWorldQuaternion = ({
  linkName,
  maxAutoOrientationDeltaRadians = ROBOT_MIRROR_SYMMETRY_MAX_AUTO_ORIENTATION_DELTA_RADIANS,
  minAutoOrientationGapRadians = ROBOT_MIRROR_SYMMETRY_MIN_AUTO_ORIENTATION_GAP_RADIANS,
  orientationMode = "conservative",
  planeNormalWorld,
  robot,
}: {
  linkName: string;
  maxAutoOrientationDeltaRadians?: number;
  minAutoOrientationGapRadians?: number;
  orientationMode?: RobotMirrorOrientationMode;
  planeNormalWorld: THREE.Vector3;
  robot: NonNullable<ReturnType<typeof parseRepeatedInertiaSymmetryRobot>>;
}): PlaneParallelWorldQuaternionResult => {
  const currentWorldQuaternion = resolveLinkWorldQuaternion({
    linkName,
    robot,
  });
  if (!currentWorldQuaternion) {
    return {
      orientationDecision: "preserve-current",
      orientationSkipReason: null,
      targetWorldQuaternion: null,
    };
  }
  const normalizedPlaneNormalWorld = planeNormalWorld.clone().normalize();
  const candidates: OrientationCandidate[] = [];

  LINK_FRAME_AXES.forEach((axisLocal) => {
    const axisWorld = axisLocal.clone().applyQuaternion(currentWorldQuaternion).normalize();
    const axisSign = axisWorld.dot(normalizedPlaneNormalWorld) >= 0 ? 1 : -1;
    const targetAxisWorld = normalizedPlaneNormalWorld.clone().multiplyScalar(axisSign);
    const alignmentQuaternion = new THREE.Quaternion().setFromUnitVectors(axisWorld, targetAxisWorld);
    candidates.push({
      deltaRadians: axisWorld.angleTo(targetAxisWorld),
      quaternion: currentWorldQuaternion.clone().premultiply(alignmentQuaternion).normalize(),
    });
  });

  candidates.sort(
    (left, right) =>
      left.deltaRadians - right.deltaRadians ||
      Math.abs(right.quaternion.dot(currentWorldQuaternion)) -
        Math.abs(left.quaternion.dot(currentWorldQuaternion))
  );
  const bestCandidate = candidates[0] ?? null;
  const secondCandidate = candidates[1] ?? null;
  if (!bestCandidate) {
    return {
      orientationDecision: "preserve-current",
      orientationSkipReason: null,
      targetWorldQuaternion: null,
    };
  }
  if (orientationMode === "force") {
    return {
      orientationDecision: "align-to-plane",
      orientationSkipReason: null,
      targetWorldQuaternion: bestCandidate.quaternion,
    };
  }
  if (bestCandidate.deltaRadians > maxAutoOrientationDeltaRadians) {
    return {
      orientationDecision: "preserve-current",
      orientationSkipReason: "rotation-too-large",
      targetWorldQuaternion: null,
    };
  }
  if (
    secondCandidate &&
    secondCandidate.deltaRadians - bestCandidate.deltaRadians < minAutoOrientationGapRadians
  ) {
    return {
      orientationDecision: "preserve-current",
      orientationSkipReason: "ambiguous-axis",
      targetWorldQuaternion: null,
    };
  }

  return {
    orientationDecision: "align-to-plane",
    orientationSkipReason: null,
    targetWorldQuaternion: bestCandidate.quaternion,
  };
};

const reflectPointAcrossPlane = ({
  normalWorld,
  originWorld,
  pointWorld,
}: {
  normalWorld: THREE.Vector3;
  originWorld: THREE.Vector3;
  pointWorld: THREE.Vector3;
}): THREE.Vector3 => {
  const normalizedNormal = normalWorld.clone().normalize();
  const signedDistanceMeters = pointWorld.clone().sub(originWorld).dot(normalizedNormal);
  return pointWorld.clone().addScaledVector(normalizedNormal, -2 * signedDistanceMeters);
};

const projectPointOntoPlane = ({
  normalWorld,
  originWorld,
  pointWorld,
}: {
  normalWorld: THREE.Vector3;
  originWorld: THREE.Vector3;
  pointWorld: THREE.Vector3;
}): THREE.Vector3 => {
  const normalizedNormal = normalWorld.clone().normalize();
  const signedDistanceMeters = pointWorld.clone().sub(originWorld).dot(normalizedNormal);
  return pointWorld.clone().addScaledVector(normalizedNormal, -signedDistanceMeters);
};

const resolveRobotRootFrame = ({
  robot,
}: {
  robot: NonNullable<ReturnType<typeof parseRepeatedInertiaSymmetryRobot>>;
}): { originWorld: THREE.Vector3; rootQuaternion: THREE.Quaternion } | null => {
  const rootLinkNames = Array.from(robot.linkWorldMatrices.keys())
    .filter((linkName) => !robot.parentByChildLink.has(linkName))
    .sort((left, right) => left.localeCompare(right));
  const rootLinkName = rootLinkNames[0] ?? null;
  if (!rootLinkName) {
    return null;
  }
  const rootMatrix = robot.linkWorldMatrices.get(rootLinkName) ?? null;
  const originWorld =
    robot.linkReferenceCentersWorld.get(rootLinkName)?.clone() ??
    robot.linkWorldPositions.get(rootLinkName)?.clone() ??
    null;
  if (!rootMatrix || !originWorld) {
    return null;
  }
  return {
    originWorld,
    rootQuaternion: new THREE.Quaternion().setFromRotationMatrix(rootMatrix),
  };
};

const buildMirrorPlaneCandidates = ({
  rootQuaternion,
}: {
  rootQuaternion: THREE.Quaternion;
}): RobotMirrorPlaneCandidate[] => [
  {
    normalWorld: new THREE.Vector3(1, 0, 0).applyQuaternion(rootQuaternion),
    planeLabel: "yz",
  },
  {
    normalWorld: new THREE.Vector3(0, 1, 0).applyQuaternion(rootQuaternion),
    planeLabel: "xz",
  },
  {
    normalWorld: new THREE.Vector3(0, 0, 1).applyQuaternion(rootQuaternion),
    planeLabel: "xy",
  },
];

const buildSupportEntries = ({
  linkNames,
  normalWorld,
  originWorld,
  robot,
}: {
  linkNames: readonly string[];
  normalWorld: THREE.Vector3;
  originWorld: THREE.Vector3;
  robot: NonNullable<ReturnType<typeof parseRepeatedInertiaSymmetryRobot>>;
}): MirrorSupportEntry[] =>
  linkNames
    .map((linkName) => {
      const worldPosition =
        robot.linkReferenceCentersWorld.get(linkName)?.clone() ??
        robot.linkWorldPositions.get(linkName)?.clone() ??
        null;
      if (!worldPosition) {
        return null;
      }
      return {
        linkName,
        signedDistanceMeters: worldPosition.clone().sub(originWorld).dot(normalWorld),
        worldPosition,
      };
    })
    .filter((entry): entry is MirrorSupportEntry => entry !== null);

const buildGroupMirrorSupport = ({
  group,
  maxCenterDistanceMeters,
  maxPairResidualMeters,
  normalWorld,
  originWorld,
  robot,
}: {
  group: RobotMirrorMeshLinkGroup;
  maxCenterDistanceMeters: number;
  maxPairResidualMeters: number;
  normalWorld: THREE.Vector3;
  originWorld: THREE.Vector3;
  robot: NonNullable<ReturnType<typeof parseRepeatedInertiaSymmetryRobot>>;
}): {
  centeredLinkCount: number;
  centeredLinkNames: string[];
  matchedPairCount: number;
  matchedPairs: RobotMirrorSymmetryPair[];
  maxResidualMeters: number | null;
  residualsMeters: number[];
  supportedLinkCount: number;
  supportedLinkNames: string[];
  unsupportedLinkNames: string[];
} => {
  const supportEntries = buildSupportEntries({
    linkNames: group.linkNames,
    normalWorld,
    originWorld,
    robot,
  });
  const resolvedLinkNames = new Set(supportEntries.map((entry) => entry.linkName));
  const missingLinkNames = group.linkNames.filter((linkName) => !resolvedLinkNames.has(linkName));
  const centeredEntries = supportEntries.filter(
    (entry) => Math.abs(entry.signedDistanceMeters) <= maxCenterDistanceMeters
  );
  const positiveEntries = supportEntries
    .filter((entry) => entry.signedDistanceMeters > maxCenterDistanceMeters)
    .sort(
      (left, right) =>
        Math.abs(right.signedDistanceMeters) - Math.abs(left.signedDistanceMeters) ||
        left.linkName.localeCompare(right.linkName)
    );
  const negativeEntries = supportEntries.filter(
    (entry) => entry.signedDistanceMeters < -maxCenterDistanceMeters
  );
  const remainingNegativeEntries = [...negativeEntries];
  const matchedPairs: RobotMirrorSymmetryPair[] = [];
  const residualsMeters: number[] = [];

  positiveEntries.forEach((positiveEntry) => {
    const reflectedPoint = reflectPointAcrossPlane({
      normalWorld,
      originWorld,
      pointWorld: positiveEntry.worldPosition,
    });
    let bestMatchIndex = -1;
    let bestResidualMeters = Number.POSITIVE_INFINITY;
    remainingNegativeEntries.forEach((negativeEntry, index) => {
      const residualMeters = reflectedPoint.distanceTo(negativeEntry.worldPosition);
      if (residualMeters < bestResidualMeters) {
        bestResidualMeters = residualMeters;
        bestMatchIndex = index;
      }
    });
    if (
      bestMatchIndex < 0 ||
      bestResidualMeters > maxPairResidualMeters
    ) {
      return;
    }
    const matchedNegativeEntry = remainingNegativeEntries.splice(bestMatchIndex, 1)[0]!;
    matchedPairs.push({
      groupKey: group.groupKey,
      leftLinkName: positiveEntry.linkName,
      residualMeters: bestResidualMeters,
      rightLinkName: matchedNegativeEntry.linkName,
    });
    residualsMeters.push(bestResidualMeters);
  });

  const supportedLinkNameSet = new Set(centeredEntries.map((entry) => entry.linkName));
  matchedPairs.forEach((pair) => {
    supportedLinkNameSet.add(pair.leftLinkName);
    supportedLinkNameSet.add(pair.rightLinkName);
  });
  const unsupportedLinkNames = [
    ...missingLinkNames,
    ...supportEntries
      .map((entry) => entry.linkName)
      .filter((linkName) => !supportedLinkNameSet.has(linkName)),
  ].sort((left, right) => left.localeCompare(right));
  const supportedLinkNames = Array.from(supportedLinkNameSet).sort((left, right) =>
    left.localeCompare(right)
  );

  return {
    centeredLinkCount: centeredEntries.length,
    centeredLinkNames: centeredEntries
      .map((entry) => entry.linkName)
      .sort((left, right) => left.localeCompare(right)),
    matchedPairCount: matchedPairs.length,
    matchedPairs,
    maxResidualMeters: residualsMeters.length > 0 ? Math.max(...residualsMeters) : null,
    residualsMeters,
    supportedLinkCount: supportedLinkNames.length,
    supportedLinkNames,
    unsupportedLinkNames,
  };
};

export const buildRobotMirrorSymmetryAlignmentTargets = ({
  check,
  linkNames,
  maxCenterDistanceMeters = ROBOT_MIRROR_SYMMETRY_MAX_CENTER_DISTANCE_METERS,
  orientationMode = "conservative",
  robot,
}: {
  check: RobotMirrorSymmetryCheck | null | undefined;
  linkNames: readonly string[];
  maxCenterDistanceMeters?: number;
  orientationMode?: RobotMirrorOrientationMode;
  robot: NonNullable<ReturnType<typeof parseRepeatedInertiaSymmetryRobot>>;
}): RobotMirrorSymmetryAlignmentTarget[] => {
  if (!check || linkNames.length === 0) {
    return [];
  }

  const planeNormalWorld = new THREE.Vector3().fromArray(check.planeNormalWorld).normalize();
  const planeOriginWorld = new THREE.Vector3().fromArray(check.originMeters);
  const supportEntries = buildSupportEntries({
    linkNames,
    normalWorld: planeNormalWorld,
    originWorld: planeOriginWorld,
    robot,
  });
  const centeredEntries = supportEntries.filter(
    (entry) => Math.abs(entry.signedDistanceMeters) <= maxCenterDistanceMeters
  );
  const positiveEntries = supportEntries
    .filter((entry) => entry.signedDistanceMeters > maxCenterDistanceMeters)
    .sort(
      (left, right) =>
        Math.abs(right.signedDistanceMeters) - Math.abs(left.signedDistanceMeters) ||
        left.linkName.localeCompare(right.linkName)
    );
  const negativeEntries = supportEntries
    .filter((entry) => entry.signedDistanceMeters < -maxCenterDistanceMeters)
    .sort((left, right) => left.linkName.localeCompare(right.linkName));
  const remainingNegativeEntries = [...negativeEntries];
  const alignmentTargetsByLinkName = new Map<string, RobotMirrorSymmetryAlignmentTarget>();

  centeredEntries.forEach((entry) => {
    const planeParallelQuaternion = buildPlaneParallelWorldQuaternion({
      linkName: entry.linkName,
      orientationMode,
      planeNormalWorld,
      robot,
    });
    alignmentTargetsByLinkName.set(entry.linkName, {
      counterpartLinkName: null,
      linkName: entry.linkName,
      mode: "centered",
      orientationDecision: planeParallelQuaternion.orientationDecision,
      orientationSkipReason: planeParallelQuaternion.orientationSkipReason,
      targetPositionMeters: toVector3Tuple(
        projectPointOntoPlane({
          normalWorld: planeNormalWorld,
          originWorld: planeOriginWorld,
          pointWorld: entry.worldPosition,
        })
      ),
      targetWorldQuaternion: planeParallelQuaternion.targetWorldQuaternion
        ? toQuaternionTuple(planeParallelQuaternion.targetWorldQuaternion)
        : null,
    });
  });

  positiveEntries.forEach((positiveEntry) => {
    const reflectedNegativeMatches = remainingNegativeEntries
      .map((negativeEntry, index) => ({
        index,
        negativeEntry,
        residualMeters: reflectPointAcrossPlane({
          normalWorld: planeNormalWorld,
          originWorld: planeOriginWorld,
          pointWorld: negativeEntry.worldPosition,
        }).distanceTo(positiveEntry.worldPosition),
      }))
      .sort(
        (left, right) =>
          left.residualMeters - right.residualMeters ||
          left.negativeEntry.linkName.localeCompare(right.negativeEntry.linkName)
      );
    const bestMatch = reflectedNegativeMatches[0] ?? null;
    if (!bestMatch) {
      return;
    }

    const matchedNegativeEntry = remainingNegativeEntries.splice(bestMatch.index, 1)[0]!;
    const reflectedNegativePoint = reflectPointAcrossPlane({
      normalWorld: planeNormalWorld,
      originWorld: planeOriginWorld,
      pointWorld: matchedNegativeEntry.worldPosition,
    });
    const positiveTargetWorld = positiveEntry.worldPosition
      .clone()
      .add(reflectedNegativePoint)
      .multiplyScalar(0.5);
    const negativeTargetWorld = reflectPointAcrossPlane({
      normalWorld: planeNormalWorld,
      originWorld: planeOriginWorld,
      pointWorld: positiveTargetWorld,
    });
    const positivePlaneParallelQuaternion = buildPlaneParallelWorldQuaternion({
      linkName: positiveEntry.linkName,
      orientationMode,
      planeNormalWorld,
      robot,
    });
    const negativePlaneParallelQuaternion = buildPlaneParallelWorldQuaternion({
      linkName: matchedNegativeEntry.linkName,
      orientationMode,
      planeNormalWorld,
      robot,
    });

    alignmentTargetsByLinkName.set(positiveEntry.linkName, {
      counterpartLinkName: matchedNegativeEntry.linkName,
      linkName: positiveEntry.linkName,
      mode: "paired",
      orientationDecision: positivePlaneParallelQuaternion.orientationDecision,
      orientationSkipReason: positivePlaneParallelQuaternion.orientationSkipReason,
      targetPositionMeters: toVector3Tuple(positiveTargetWorld),
      targetWorldQuaternion: positivePlaneParallelQuaternion.targetWorldQuaternion
        ? toQuaternionTuple(positivePlaneParallelQuaternion.targetWorldQuaternion)
        : null,
    });
    alignmentTargetsByLinkName.set(matchedNegativeEntry.linkName, {
      counterpartLinkName: positiveEntry.linkName,
      linkName: matchedNegativeEntry.linkName,
      mode: "paired",
      orientationDecision: negativePlaneParallelQuaternion.orientationDecision,
      orientationSkipReason: negativePlaneParallelQuaternion.orientationSkipReason,
      targetPositionMeters: toVector3Tuple(negativeTargetWorld),
      targetWorldQuaternion: negativePlaneParallelQuaternion.targetWorldQuaternion
        ? toQuaternionTuple(negativePlaneParallelQuaternion.targetWorldQuaternion)
        : null,
    });
  });

  return Array.from(alignmentTargetsByLinkName.values()).sort(
    (left, right) => left.linkName.localeCompare(right.linkName)
  );
};

const buildRobotMirrorSymmetryCheckForPlane = ({
  groups,
  maxCenterDistanceMeters,
  maxPairResidualMeters,
  originWorld,
  planeCandidate,
  robot,
}: {
  groups: readonly RobotMirrorMeshLinkGroup[];
  maxCenterDistanceMeters: number;
  maxPairResidualMeters: number;
  originWorld: THREE.Vector3;
  planeCandidate: RobotMirrorPlaneCandidate;
  robot: NonNullable<ReturnType<typeof parseRepeatedInertiaSymmetryRobot>>;
}): RobotMirrorSymmetryCheck | null => {
  let centeredLinkCount = 0;
  let matchedPairCount = 0;
  let pairedGroupCount = 0;
  let reviewLinkCount = 0;
  let supportedGroupCount = 0;
  let supportedLinkCount = 0;
  let totalRepeatedLinkCount = 0;
  const centeredLinkNames = new Set<string>();
  const matchedPairs: RobotMirrorSymmetryPair[] = [];
  const reviewGroups: RobotMirrorSymmetryReviewGroup[] = [];
  const residualsMeters: number[] = [];
  const supportedLinkNames = new Set<string>();

  groups.forEach((group) => {
    totalRepeatedLinkCount += group.linkNames.length;
    const groupSupport = buildGroupMirrorSupport({
      group,
      maxCenterDistanceMeters,
      maxPairResidualMeters,
      normalWorld: planeCandidate.normalWorld,
      originWorld,
      robot,
    });
    groupSupport.centeredLinkNames.forEach((linkName) => {
      centeredLinkNames.add(linkName);
    });
    groupSupport.supportedLinkNames.forEach((linkName) => {
      supportedLinkNames.add(linkName);
    });
    if (groupSupport.unsupportedLinkNames.length > 0) {
      reviewGroups.push({
        groupKey: group.groupKey,
        maxResidualMeters: groupSupport.maxResidualMeters,
        meshLabel: group.meshLabel,
        supportedLinkCount: groupSupport.supportedLinkCount,
        totalLinkCount: group.linkNames.length,
        unsupportedLinkNames: groupSupport.unsupportedLinkNames,
      });
      reviewLinkCount += groupSupport.unsupportedLinkNames.length;
    }
    if (groupSupport.supportedLinkCount === 0) {
      return;
    }
    supportedGroupCount += 1;
    centeredLinkCount += groupSupport.centeredLinkCount;
    matchedPairCount += groupSupport.matchedPairCount;
    if (groupSupport.matchedPairCount > 0) {
      pairedGroupCount += 1;
    }
    supportedLinkCount += groupSupport.supportedLinkCount;
    matchedPairs.push(...groupSupport.matchedPairs);
    residualsMeters.push(...groupSupport.residualsMeters);
  });

  if (
    matchedPairCount < ROBOT_MIRROR_SYMMETRY_MIN_MATCHED_PAIR_COUNT ||
    supportedLinkCount < ROBOT_MIRROR_SYMMETRY_MIN_SUPPORTED_LINK_COUNT ||
    supportedGroupCount < ROBOT_MIRROR_SYMMETRY_MIN_SUPPORTED_GROUP_COUNT
  ) {
    return null;
  }

  return {
    averageResidualMeters:
      residualsMeters.length > 0
        ? residualsMeters.reduce((sum, residualMeters) => sum + residualMeters, 0) /
          residualsMeters.length
        : 0,
    centeredLinkCount,
    centeredLinkNames: Array.from(centeredLinkNames).sort((left, right) => left.localeCompare(right)),
    matchedPairs,
    matchedPairCount,
    maxResidualMeters: residualsMeters.length > 0 ? Math.max(...residualsMeters) : 0,
    originMeters: toVector3Tuple(originWorld),
    pairedGroupCount,
    pairedLinkCount: matchedPairCount * 2,
    planeLabel: planeCandidate.planeLabel,
    planeNormalWorld: toVector3Tuple(planeCandidate.normalWorld),
    reviewGroups: reviewGroups.sort(
      (left, right) =>
        right.unsupportedLinkNames.length - left.unsupportedLinkNames.length ||
        left.meshLabel.localeCompare(right.meshLabel)
    ),
    reviewLinkCount,
    supportedGroupCount,
    supportedLinkCount,
    supportedLinkNames: Array.from(supportedLinkNames).sort((left, right) =>
      left.localeCompare(right)
    ),
    totalRepeatedLinkCount,
  };
};

export const buildRobotMirrorSymmetryCheck = ({
  linkDataByName,
  linkCentersLocal,
  repeatedInertiaDiagnostics,
  urdfContent,
}: {
  linkDataByName?: Record<string, LinkData> | null;
  linkCentersLocal?: RepeatedInertiaSymmetryLinkCentersLocal | null;
  repeatedInertiaDiagnostics: readonly RepeatedInertiaDiagnosticGroup[] | null | undefined;
  urdfContent: string;
}): RobotMirrorSymmetryCheck | null => {
  const hasLinkData = Boolean(linkDataByName && Object.keys(linkDataByName).length > 0);
  const hasRepeatedDiagnostics = Boolean(
    repeatedInertiaDiagnostics && repeatedInertiaDiagnostics.length > 0
  );
  if (!urdfContent.trim() || (!hasLinkData && !hasRepeatedDiagnostics)) {
    return null;
  }
  const robot = parseRepeatedInertiaSymmetryRobot(urdfContent, {
    linkCentersLocal,
  });
  if (!robot) {
    return null;
  }
  const rootFrame = resolveRobotRootFrame({ robot });
  if (!rootFrame) {
    return null;
  }
  const candidateGroups =
    hasLinkData
      ? buildRobotMirrorMeshLinkGroupsFromLinkData(linkDataByName)
      : buildRobotMirrorMeshLinkGroupsFromDiagnostics(repeatedInertiaDiagnostics ?? []);
  const eligibleGroups = candidateGroups.filter((group) => group.linkNames.length >= 2);
  if (eligibleGroups.length === 0) {
    return null;
  }

  const bestPlaneCheck = buildMirrorPlaneCandidates({
    rootQuaternion: rootFrame.rootQuaternion,
  })
    .map((planeCandidate) =>
      buildRobotMirrorSymmetryCheckForPlane({
        groups: eligibleGroups,
        maxCenterDistanceMeters: ROBOT_MIRROR_SYMMETRY_MAX_CENTER_DISTANCE_METERS,
        maxPairResidualMeters: ROBOT_MIRROR_SYMMETRY_MAX_PAIR_RESIDUAL_METERS,
        originWorld: rootFrame.originWorld,
        planeCandidate,
        robot,
      })
    )
    .filter((check): check is RobotMirrorSymmetryCheck => check !== null)
    .sort(
      (left, right) =>
        right.pairedLinkCount - left.pairedLinkCount ||
        right.pairedGroupCount - left.pairedGroupCount ||
        right.supportedLinkCount - left.supportedLinkCount ||
        right.supportedGroupCount - left.supportedGroupCount ||
        left.reviewLinkCount - right.reviewLinkCount ||
        left.maxResidualMeters - right.maxResidualMeters ||
        left.averageResidualMeters - right.averageResidualMeters
    )[0] ?? null;

  return bestPlaneCheck;
};
