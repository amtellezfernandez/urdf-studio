import * as THREE from "three";
import type { URDFJoint, URDFRobot } from "urdf-loader";

import {
  localDirectionFromWorld,
  normalizeDirection,
  projectDirectionOntoPlane,
  resolveForwardWorldFromWheelAxes,
  worldDirectionFromLocal,
} from "@/shared/lib/axisFrame";
import {
  inferStudioWheelSideFromLateralOffset,
  isStudioWheelLikeLabel,
  resolveStudioActiveDriveJointNames,
  shouldDetectStudioWheelJointByHintOrLabel,
  shouldIncludeStudioWheelJoint,
  type StudioWheelRole,
  type StudioWheelSide,
} from "@/features/viewer/studioWheelDriveHeuristics";

const DEFAULT_WORLD_UP_AXIS = new THREE.Vector3(0, 1, 0);
const DEFAULT_FORWARD_AXIS = new THREE.Vector3(1, 0, 0);
const DEFAULT_LOCAL_WHEEL_AXIS = new THREE.Vector3(0, 1, 0);
const WHEEL_AXIS_EPSILON = 1e-10;
const WHEEL_LATERAL_OFFSET_EPSILON_M = 1e-4;
const LEFT_WHEEL_NAME_PATTERN = /(left|_l\b|\bl_)/i;
const RIGHT_WHEEL_NAME_PATTERN = /(right|_r\b|\br_)/i;

export const STUDIO_WHEEL_ROLE_EMA_ALPHA = 0.18;
export const STUDIO_WHEEL_ROLE_DECAY = 0.92;
const STUDIO_WHEEL_ROLE_ABS_THRESHOLD_MPS = 0.02;
const STUDIO_WHEEL_ROLE_RELATIVE_THRESHOLD = 0.45;
export const STUDIO_WHEEL_ROLE_UI_REFRESH_MS = 250;
export const STUDIO_WHEEL_MARKER_OFFSET_M = 0.06;

export type StudioWheelJointSide = StudioWheelSide;

export type StudioWheelJointMeta = {
  jointName: string;
  joint: URDFJoint;
  side: StudioWheelJointSide;
  lateralOffset: number;
  radius: number;
  axisLocal: THREE.Vector3;
  directionSign: number;
  drivePreferred: boolean;
};

export type StudioWheelDriveModel = {
  wheels: StudioWheelJointMeta[];
  trackWidth: number;
  forwardLocal: THREE.Vector3;
};

export type StudioWheelRoleEntry = {
  jointName: string;
  side: StudioWheelJointSide;
  role: StudioWheelRole;
  activityMps: number;
  driveEnabled: boolean;
};

export type StudioWheelRoleDisplayEntry = StudioWheelRoleEntry & {
  wheelNumber: number;
};

export type StudioWheelRoleMarker = {
  jointName: string;
  wheelNumber: number;
  driveEnabled: boolean;
  side: StudioWheelJointSide;
  role: StudioWheelRole;
  anchorObject: THREE.Object3D;
};

const normalizeUpAxis = (axis?: THREE.Vector3 | null): THREE.Vector3 =>
  normalizeDirection(axis?.clone() ?? DEFAULT_WORLD_UP_AXIS, DEFAULT_WORLD_UP_AXIS);

const isFinitePositiveMotionDimension = (
  value: number | null | undefined
): value is number => typeof value === "number" && Number.isFinite(value) && value > Number.EPSILON;

export const resolveSafeMotionDimension = (value: number): number => {
  const absoluteValue = Math.abs(value);
  if (Number.isFinite(absoluteValue) && absoluteValue > Number.EPSILON) {
    return absoluteValue;
  }
  return Number.EPSILON;
};

const resolveWheelJointChildObject = (joint: URDFJoint): THREE.Object3D | null => {
  const childObject = (joint.children ?? [])[0];
  return childObject instanceof THREE.Object3D ? childObject : null;
};

export const resolveWheelRadiusFromJointGeometry = (joint: URDFJoint): number | null => {
  const childObject = resolveWheelJointChildObject(joint);
  if (!childObject) return null;
  childObject.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(childObject);
  if (bounds.isEmpty()) return null;
  const size = bounds.getSize(new THREE.Vector3());
  const dimensions = [size.x, size.y, size.z]
    .filter(isFinitePositiveMotionDimension)
    .sort((lhs, rhs) => rhs - lhs);
  if (dimensions.length === 0) return null;
  const diameter = dimensions[Math.min(1, dimensions.length - 1)] ?? dimensions[0];
  if (!isFinitePositiveMotionDimension(diameter)) return null;
  return diameter * 0.5;
};

export const resolveWheelCenterWorldFromJointGeometry = (
  joint: URDFJoint
): THREE.Vector3 | null => {
  const childObject = resolveWheelJointChildObject(joint);
  if (!childObject) return null;
  childObject.updateMatrixWorld(true);
  const worldCenter = new THREE.Vector3();
  childObject.getWorldPosition(worldCenter);
  if (
    !Number.isFinite(worldCenter.x) ||
    !Number.isFinite(worldCenter.y) ||
    !Number.isFinite(worldCenter.z)
  ) {
    return null;
  }
  return worldCenter;
};

const resolveMedian = (values: readonly number[]): number | null => {
  const sorted = values
    .filter(isFinitePositiveMotionDimension)
    .slice()
    .sort((lhs, rhs) => lhs - rhs);
  if (sorted.length === 0) return null;
  const middleIndex = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middleIndex] ?? null;
  }
  const lhs = sorted[middleIndex - 1];
  const rhs = sorted[middleIndex];
  if (!isFinitePositiveMotionDimension(lhs) || !isFinitePositiveMotionDimension(rhs)) {
    return null;
  }
  return (lhs + rhs) * 0.5;
};

const resolveRobotBoundsDimensions = (robot: URDFRobot): number[] => {
  robot.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(robot);
  if (bounds.isEmpty()) return [];
  const size = bounds.getSize(new THREE.Vector3());
  return [size.x, size.y, size.z].filter(isFinitePositiveMotionDimension);
};

const resolveMinPairDistance = (points: readonly THREE.Vector3[]): number | null => {
  if (points.length < 2) return null;
  let minDistance = Number.POSITIVE_INFINITY;
  for (let lhsIndex = 0; lhsIndex < points.length - 1; lhsIndex += 1) {
    for (let rhsIndex = lhsIndex + 1; rhsIndex < points.length; rhsIndex += 1) {
      const lhsPoint = points[lhsIndex];
      const rhsPoint = points[rhsIndex];
      if (!lhsPoint || !rhsPoint) continue;
      const distance = lhsPoint.distanceTo(rhsPoint);
      if (!isFinitePositiveMotionDimension(distance)) continue;
      if (distance < minDistance) {
        minDistance = distance;
      }
    }
  }
  if (!isFinitePositiveMotionDimension(minDistance)) return null;
  return minDistance;
};

export const resolveFallbackWheelRadiusMeters = ({
  robot,
  wheelCenters,
  measuredRadiiMeters,
}: {
  robot: URDFRobot;
  wheelCenters: readonly THREE.Vector3[];
  measuredRadiiMeters: readonly number[];
}): number => {
  const medianMeasuredRadius = resolveMedian(measuredRadiiMeters);
  if (isFinitePositiveMotionDimension(medianMeasuredRadius)) {
    return medianMeasuredRadius;
  }
  const minWheelCenterDistance = resolveMinPairDistance(wheelCenters);
  if (isFinitePositiveMotionDimension(minWheelCenterDistance)) {
    return minWheelCenterDistance * 0.5;
  }
  const robotDimensions = resolveRobotBoundsDimensions(robot).sort((lhs, rhs) => lhs - rhs);
  const smallestRobotDimension = robotDimensions[0];
  if (isFinitePositiveMotionDimension(smallestRobotDimension)) {
    return smallestRobotDimension * 0.5;
  }
  return Number.EPSILON;
};

export const resolveProjectedRobotSpanMeters = (
  robot: URDFRobot,
  axisWorld: THREE.Vector3
): number | null => {
  const dimensions = resolveRobotBoundsDimensions(robot);
  if (dimensions.length !== 3) return null;
  const normalizedAxis = normalizeDirection(axisWorld.clone(), DEFAULT_FORWARD_AXIS);
  const projectedSpan =
    Math.abs(normalizedAxis.x) * dimensions[0] +
    Math.abs(normalizedAxis.y) * dimensions[1] +
    Math.abs(normalizedAxis.z) * dimensions[2];
  if (!isFinitePositiveMotionDimension(projectedSpan)) return null;
  return projectedSpan;
};

const resolveWheelTrackWidthMeters = ({
  robot,
  worldUp,
  forwardWorld,
  leftCenters,
  rightCenters,
  allCenters,
}: {
  robot: URDFRobot;
  worldUp: THREE.Vector3;
  forwardWorld: THREE.Vector3;
  leftCenters: readonly THREE.Vector3[];
  rightCenters: readonly THREE.Vector3[];
  allCenters: readonly THREE.Vector3[];
}): number => {
  const trackRightWorld = new THREE.Vector3().crossVectors(worldUp, forwardWorld);
  if (trackRightWorld.lengthSq() <= Number.EPSILON) {
    return Number.EPSILON;
  }
  trackRightWorld.normalize();
  if (leftCenters.length > 0 && rightCenters.length > 0) {
    const leftMean = leftCenters
      .reduce((acc, value) => acc.add(value), new THREE.Vector3())
      .multiplyScalar(1 / leftCenters.length);
    const rightMean = rightCenters
      .reduce((acc, value) => acc.add(value), new THREE.Vector3())
      .multiplyScalar(1 / rightCenters.length);
    const lateralOffset = Math.abs(rightMean.clone().sub(leftMean).dot(trackRightWorld));
    if (isFinitePositiveMotionDimension(lateralOffset)) {
      return lateralOffset;
    }
  }
  if (allCenters.length > 1) {
    const projectedOffsets = allCenters
      .map((center) => center.dot(trackRightWorld))
      .filter((value) => Number.isFinite(value));
    if (projectedOffsets.length > 1) {
      const minOffset = Math.min(...projectedOffsets);
      const maxOffset = Math.max(...projectedOffsets);
      const span = Math.abs(maxOffset - minOffset);
      if (isFinitePositiveMotionDimension(span)) {
        return span;
      }
    }
  }
  if (allCenters.length === 1) {
    const robotCenterWorld = new THREE.Vector3();
    robot.getWorldPosition(robotCenterWorld);
    const lateralOffset = Math.abs(
      allCenters[0].clone().sub(robotCenterWorld).dot(trackRightWorld)
    );
    if (isFinitePositiveMotionDimension(lateralOffset)) {
      return lateralOffset * 2;
    }
  }
  const projectedRobotSpan = resolveProjectedRobotSpanMeters(robot, trackRightWorld);
  if (isFinitePositiveMotionDimension(projectedRobotSpan)) {
    return projectedRobotSpan;
  }
  return Number.EPSILON;
};

const getPerpendicularDirection = (upAxis: THREE.Vector3): THREE.Vector3 => {
  const normalizedUpAxis = normalizeDirection(upAxis, DEFAULT_WORLD_UP_AXIS);
  const preferredReference =
    Math.abs(normalizedUpAxis.z) < 0.9
      ? new THREE.Vector3(0, 0, 1)
      : DEFAULT_FORWARD_AXIS.clone();
  const candidate = new THREE.Vector3().crossVectors(preferredReference, normalizedUpAxis);
  return normalizeDirection(candidate, DEFAULT_FORWARD_AXIS);
};

export const detectStudioWheelDriveModel = (
  robot: URDFRobot,
  runtimeUp?: THREE.Vector3 | null,
  driveJointHints?: ReadonlySet<string>
): StudioWheelDriveModel | null => {
  const worldUp = normalizeUpAxis(runtimeUp);
  const averageAxisWorld = new THREE.Vector3();
  const wheels: StudioWheelJointMeta[] = [];
  const hasActuationLimitByJoint = new Map<string, boolean>();
  const wheelCenterByJointName = new Map<string, THREE.Vector3>();
  const measuredRadiiMeters: number[] = [];
  const leftCenters: THREE.Vector3[] = [];
  const rightCenters: THREE.Vector3[] = [];

  Object.entries(robot.joints ?? {}).forEach(([jointName, joint]) => {
    const jointType = String((joint as { jointType?: string }).jointType ?? "").toLowerCase();
    if (jointType !== "continuous" && jointType !== "revolute") return;
    const childNames = (joint.children ?? []).map((child) => child.name || "").join(" ");
    const label = `${jointName} ${childNames}`;
    const hasWheelLikeLabel = isStudioWheelLikeLabel(label);
    if (
      !shouldDetectStudioWheelJointByHintOrLabel({
        jointName,
        label,
        driveJointHints,
      })
    ) {
      return;
    }

    const side: StudioWheelJointSide = LEFT_WHEEL_NAME_PATTERN.test(label)
      ? "left"
      : RIGHT_WHEEL_NAME_PATTERN.test(label)
        ? "right"
        : "unknown";
    let axisLocal = DEFAULT_LOCAL_WHEEL_AXIS.clone();
    const jointAxis = (joint as { axis?: THREE.Vector3 }).axis;
    if (jointAxis instanceof THREE.Vector3 && jointAxis.lengthSq() > WHEEL_AXIS_EPSILON) {
      axisLocal = jointAxis.clone().normalize();
    }
    const axisWorld = worldDirectionFromLocal(axisLocal, robot.quaternion);
    const axisAlignmentWithUp = Math.abs(axisWorld.dot(worldUp));
    const jointLimit = (joint as { limit?: { lower?: number; upper?: number } }).limit;
    const lowerLimit = typeof jointLimit?.lower === "number" ? jointLimit.lower : undefined;
    const upperLimit = typeof jointLimit?.upper === "number" ? jointLimit.upper : undefined;
    const effortLimit =
      typeof (jointLimit as { effort?: number } | undefined)?.effort === "number"
        ? (jointLimit as { effort: number }).effort
        : undefined;
    const velocityLimit =
      typeof (jointLimit as { velocity?: number } | undefined)?.velocity === "number"
        ? (jointLimit as { velocity: number }).velocity
        : undefined;
    const isHintedWheel = driveJointHints?.has(jointName) ?? false;
    const hasActuationLimit =
      (Number.isFinite(effortLimit) && (effortLimit ?? 0) > 0) ||
      (Number.isFinite(velocityLimit) && (velocityLimit ?? 0) > 0);
    const passesStrictWheelFilter = shouldIncludeStudioWheelJoint({
      axisAlignmentWithUp,
      jointType,
      lowerLimit,
      upperLimit,
    });
    if (!isHintedWheel && !hasWheelLikeLabel && !passesStrictWheelFilter) {
      return;
    }

    const measuredRadiusMeters = resolveWheelRadiusFromJointGeometry(joint);
    if (isFinitePositiveMotionDimension(measuredRadiusMeters)) {
      measuredRadiiMeters.push(measuredRadiusMeters);
    }
    const wheelCenterWorld = resolveWheelCenterWorldFromJointGeometry(joint);
    if (wheelCenterWorld) {
      wheelCenterByJointName.set(jointName, wheelCenterWorld);
    }

    averageAxisWorld.add(axisWorld);
    hasActuationLimitByJoint.set(jointName, hasActuationLimit);
    wheels.push({
      jointName,
      joint,
      side,
      lateralOffset: 0,
      radius: measuredRadiusMeters ?? Number.NaN,
      axisLocal,
      directionSign: 1,
      drivePreferred: true,
    });
  });

  if (wheels.length === 0) return null;
  const fallbackRadiusMeters = resolveFallbackWheelRadiusMeters({
    robot,
    wheelCenters: Array.from(wheelCenterByJointName.values()),
    measuredRadiiMeters,
  });
  wheels.forEach((wheel) => {
    wheel.radius = isFinitePositiveMotionDimension(wheel.radius)
      ? wheel.radius
      : fallbackRadiusMeters;
  });

  const hintedDriveWheels =
    driveJointHints && driveJointHints.size > 0
      ? wheels.filter((wheel) => driveJointHints.has(wheel.jointName))
      : [];
  const hasHintMatches = hintedDriveWheels.length > 0;
  const hasActuationEvidence = wheels.some(
    (wheel) => hasActuationLimitByJoint.get(wheel.jointName) === true
  );
  wheels.forEach((wheel) => {
    if (hasHintMatches) {
      wheel.drivePreferred = driveJointHints?.has(wheel.jointName) ?? false;
      return;
    }
    if (hasActuationEvidence) {
      wheel.drivePreferred = hasActuationLimitByJoint.get(wheel.jointName) === true;
      return;
    }
    wheel.drivePreferred = true;
  });

  const forwardWorld = resolveForwardWorldFromWheelAxes(
    averageAxisWorld,
    worldUp,
    worldDirectionFromLocal(DEFAULT_FORWARD_AXIS, robot.quaternion)
  );
  const localUp = localDirectionFromWorld(worldUp, robot.quaternion);
  const forwardLocal = projectDirectionOntoPlane(
    localDirectionFromWorld(forwardWorld, robot.quaternion),
    localUp,
    DEFAULT_FORWARD_AXIS
  );
  const rightWorld = new THREE.Vector3().crossVectors(worldUp, forwardWorld);
  if (rightWorld.lengthSq() > WHEEL_AXIS_EPSILON) {
    rightWorld.normalize();
    const robotWorldCenter = new THREE.Vector3();
    robot.getWorldPosition(robotWorldCenter);
    wheels.forEach((wheel) => {
      const wheelCenter = wheelCenterByJointName.get(wheel.jointName);
      if (wheelCenter) {
        wheel.lateralOffset = wheelCenter.clone().sub(robotWorldCenter).dot(rightWorld);
      }
      if (wheel.side === "unknown") {
        wheel.side = inferStudioWheelSideFromLateralOffset(wheel.lateralOffset);
      }
    });
  }
  wheels.forEach((wheel) => {
    const wheelCenter = wheelCenterByJointName.get(wheel.jointName);
    if (!wheelCenter) return;
    if (wheel.side === "left") leftCenters.push(wheelCenter.clone());
    if (wheel.side === "right") rightCenters.push(wheelCenter.clone());
  });

  wheels.forEach((wheel) => {
    const axisWorld = worldDirectionFromLocal(wheel.axisLocal, robot.quaternion);
    const tangent = projectDirectionOntoPlane(
      new THREE.Vector3().crossVectors(axisWorld, worldUp),
      worldUp,
      getPerpendicularDirection(worldUp)
    );
    wheel.directionSign = tangent.dot(forwardWorld) >= 0 ? 1 : -1;
  });

  const trackWidth = resolveWheelTrackWidthMeters({
    robot,
    worldUp,
    forwardWorld,
    leftCenters,
    rightCenters,
    allCenters: Array.from(wheelCenterByJointName.values()),
  });

  return { wheels, trackWidth, forwardLocal };
};

const wheelSideSortIndex = (side: StudioWheelJointSide) => {
  if (side === "left") return 0;
  if (side === "right") return 1;
  return 2;
};

export const getStudioWheelTravelForBodyMotion = (
  wheel: Pick<StudioWheelJointMeta, "side" | "lateralOffset">,
  linearTravel: number,
  angularTravel: number,
  trackWidth: number
): number => {
  const halfTrackWidth = resolveSafeMotionDimension(trackWidth) * 0.5;
  const offset =
    Number.isFinite(wheel.lateralOffset) &&
    Math.abs(wheel.lateralOffset) > WHEEL_LATERAL_OFFSET_EPSILON_M
      ? wheel.lateralOffset
      : wheel.side === "left"
        ? -halfTrackWidth
        : wheel.side === "right"
          ? halfTrackWidth
          : 0;
  return linearTravel + angularTravel * offset;
};

export const buildStudioWheelRoleEntries = (
  model: StudioWheelDriveModel,
  activityByJointName: Record<string, number>,
  activeDriveJointNameSet: ReadonlySet<string>
): StudioWheelRoleEntry[] => {
  const activities = model.wheels.map((wheel) =>
    Math.max(0, activityByJointName[wheel.jointName] ?? 0)
  );
  const maxActivity = activities.length > 0 ? Math.max(...activities) : 0;
  const hasSignal = maxActivity >= STUDIO_WHEEL_ROLE_ABS_THRESHOLD_MPS;
  const dynamicThreshold = Math.max(
    STUDIO_WHEEL_ROLE_ABS_THRESHOLD_MPS,
    maxActivity * STUDIO_WHEEL_ROLE_RELATIVE_THRESHOLD
  );

  return model.wheels
    .map((wheel, index) => {
      const activityMps = activities[index] ?? 0;
      const wheelHasSignal = activityMps >= dynamicThreshold;
      const role: StudioWheelRole =
        !hasSignal || !wheelHasSignal
          ? "unknown"
          : activeDriveJointNameSet.has(wheel.jointName)
            ? "drive"
            : "follower";
      return {
        jointName: wheel.jointName,
        side: wheel.side,
        role,
        activityMps,
        driveEnabled: activeDriveJointNameSet.has(wheel.jointName),
      };
    })
    .sort((lhs, rhs) => {
      const sideDelta = wheelSideSortIndex(lhs.side) - wheelSideSortIndex(rhs.side);
      if (sideDelta !== 0) return sideDelta;
      return lhs.jointName.localeCompare(rhs.jointName);
    });
};

export const getPreferredStudioDriveWheels = (
  model: StudioWheelDriveModel,
  overridesByJointName: Record<string, boolean>
): StudioWheelJointMeta[] => {
  const preferredJointNames = model.wheels
    .filter((wheel) => wheel.drivePreferred)
    .map((wheel) => wheel.jointName);
  const activeJointNameSet = resolveStudioActiveDriveJointNames(
    model.wheels.map((wheel) => wheel.jointName),
    preferredJointNames,
    overridesByJointName
  );
  return model.wheels.filter((wheel) => activeJointNameSet.has(wheel.jointName));
};

const resolveStudioWheelMarkerAnchorObject = (joint: URDFJoint): THREE.Object3D =>
  resolveWheelJointChildObject(joint) ?? joint;

export const buildStudioWheelRoleMarkers = (
  displayEntries: readonly StudioWheelRoleDisplayEntry[],
  jointsByName: Record<string, URDFJoint> | undefined
): StudioWheelRoleMarker[] =>
  displayEntries
    .map((entry) => {
      const joint = jointsByName?.[entry.jointName];
      if (!joint) return null;
      return {
        jointName: entry.jointName,
        wheelNumber: entry.wheelNumber,
        driveEnabled: entry.driveEnabled,
        side: entry.side,
        role: entry.role,
        anchorObject: resolveStudioWheelMarkerAnchorObject(joint),
      } satisfies StudioWheelRoleMarker;
    })
    .filter((entry): entry is StudioWheelRoleMarker => Boolean(entry));
