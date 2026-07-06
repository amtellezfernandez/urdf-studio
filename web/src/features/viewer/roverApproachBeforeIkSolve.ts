import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

import { useObjectStore, type CreatedObject } from "@/features/objects";
import { resolveWorldObjectGeometry } from "@/features/objects/worldObjectGeometry";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import type { SetJointValueOptions } from "@/shared/store/useJointStore";
import { computeStudioWheelDriveAuthority } from "@/features/viewer/studioWheelDriveHeuristics";
import { IK_DRAG_CONFIG } from "@/features/viewer/config";
import { resolveArmReachEnvelope } from "@/features/viewer/armReach";
import {
  hideRoverApproachGuideLine,
  hideRoverApproachRoutePreview,
  updateRoverApproachGuideLine,
  updateRoverApproachGuideLineToTarget,
  updateRoverApproachRoutePreview,
  type RoverApproachGuideLineState,
  type RoverApproachRoutePreviewState,
} from "@/features/viewer/roverApproachGuideState";
import {
  getPreferredStudioDriveWheels,
  getStudioWheelTravelForBodyMotion,
  resolveSafeMotionDimension,
  type StudioWheelDriveModel,
} from "@/features/viewer/studioWheelDriveModel";
import { resolveJointScalarValue } from "@/features/viewer/viewer-helpers";
import { areApproachArmResetTargetsSettled } from "@/features/viewer/approachArmReset";
import { WHEEL_PLAYBACK_MOTION_PARAMS } from "@/features/viewer/playback/wheelPlaybackMotionParams";
import type {
  IkObjectPreSolveContext,
  IkObjectPreSolveResult,
} from "@/features/viewer/useIkSolver";
import {
  ROVER_APPROACH_CONFIG,
  ROVER_APPROACH_DETOUR_CONFIG,
  advanceRoverApproachSpeeds,
  assessRoverApproachWorldSegmentClearance,
  buildRoverApproachWorldNavigationContext,
  clampRoverApproachDtSec,
  computeSignedPlanarYawErrorRad,
  formatRoverApproachNavigationDiagnosticLine,
  planRoverApproach,
  resolveInitialRoverApproachPhase,
  type RoverApproachRuntimePhase,
  resolveRoverApproachDesiredSpeeds,
  resolveAppliedRoverApproachMotion,
  resolveRoverApproachFinalLegTarget,
  resolveRoverApproachFrame,
  resolveRoverApproachLockedGoalState,
  resolveRoverApproachNavigationDisplayStatus,
  resolveRoverApproachObjectContactGoalAsync,
  resolveRoverApproachWaypointLegTarget,
  resolveRoverApproachWorldRouteAsync,
  resolveApproachObjectPrimitiveType,
  resolveRoverPlanarObjectApproachDistance,
  shouldExecuteRoverApproachPlan,
  toRoverApproachNavigationDisplayMetrics,
  toRoverApproachWorldVector3Tuple,
  type RoverApproachLegTarget,
  type RoverApproachPlan,
  type RoverApproachRobotFootprint,
  type SerializedWorldObjectObstacleSource,
  type RoverApproachWorldRouteResult,
} from "@/features/locomotion/approach";
import { ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS } from "./roverApproachBeforeIkSolveParams";
import {
  resolveLockedRoverApproachRoutePreviewPoints,
  resolveLockedRoverApproachWaypointLegs,
  resolveLockedRoverApproachWaypointWorlds,
  resolveRoverApproachNavigationRouteState,
  resolveWaypointLegApproachPlan,
  shouldAdvanceRoverApproachWaypointLeg,
  shouldUseLockedPurpleRoute,
  type RoverApproachRetreatWaypoint,
  type RoverApproachWaypointLeg,
} from "@/features/viewer/roverApproachRouteState";
import {
  formatRoverApproachRuntimeCollisionDiagnostic,
  resolveRoverApproachRuntimeCollisionAppliedMotionFraction,
  resolveRoverApproachRuntimeCollisionAssessment,
  shouldFallbackToTurnInPlaceAfterRuntimeCollision,
  shouldTreatRuntimeCollisionAsReachedTarget,
} from "@/features/viewer/roverApproachRuntimeCollision";
import { resolveRoverApproachCollisionPathClearanceM } from "@/features/viewer/roverApproachCollisionClearance";
import { resolveRoverApproachRetreatWaypoint } from "@/features/viewer/roverApproachRetreatWaypoint";

export {
  resolveLockedRoverApproachRoutePreviewPoints,
  resolveLockedRoverApproachWaypointLegs,
  resolveLockedRoverApproachWaypointWorlds,
  resolveRoverApproachNavigationRouteState,
  resolveWaypointLegApproachPlan,
  shouldAdvanceRoverApproachWaypointLeg,
  shouldUseLockedPurpleRoute,
} from "@/features/viewer/roverApproachRouteState";
export {
  formatRoverApproachRuntimeCollisionDiagnostic,
  resolveRoverApproachRuntimeCollisionAppliedMotionFraction,
  resolveRoverApproachRuntimeCollisionAssessment,
  shouldFallbackToTurnInPlaceAfterRuntimeCollision,
  shouldTreatRuntimeCollisionAsReachedTarget,
} from "@/features/viewer/roverApproachRuntimeCollision";
export { resolveRoverApproachCollisionPathClearanceM } from "@/features/viewer/roverApproachCollisionClearance";
export { resolveRoverApproachRetreatWaypoint } from "@/features/viewer/roverApproachRetreatWaypoint";

const resolveActiveRoverApproachLegTarget = ({
  activeWaypointLeg,
  finalFacingTarget,
}: {
  activeWaypointLeg: RoverApproachWaypointLeg | null;
  finalFacingTarget: RoverApproachLegTarget;
}): RoverApproachLegTarget =>
  activeWaypointLeg
    ? resolveRoverApproachWaypointLegTarget({
        waypointWorld: activeWaypointLeg.waypointWorld,
      })
    : finalFacingTarget;

const selectRoverApproachRuntimeBlockingObject = ({
  worldObjects,
  blockingObstacleId,
}: {
  worldObjects: readonly CreatedObject[];
  blockingObstacleId: string | null;
}) => {
  if (!blockingObstacleId) {
    return;
  }
  if (!worldObjects.some((object) => object.id === blockingObstacleId)) {
    return;
  }
  useObjectStore.getState().setSelectedObject(blockingObstacleId);
};

export type StudioWheelDriveState = {
  model: StudioWheelDriveModel;
  previousAngles: Record<string, number>;
};

export type RoverApproachAsyncAbortReason =
  | "wheel-disabled"
  | "manual-base-drag"
  | "stale-solve";

export const shouldBypassRoverApproachRoutePlanning = ({
  plan,
  retreatWaypoint,
}: {
  plan: RoverApproachPlan;
  retreatWaypoint: RoverApproachRetreatWaypoint | null;
}): boolean => !plan.requiresTranslation && retreatWaypoint === null;

export const createDirectRoverApproachWorldRoute = ({
  pathClearanceM,
}: {
  pathClearanceM: number;
}): RoverApproachWorldRouteResult => ({
  mode: "direct",
  waypointWorlds: [],
  pathClearanceM,
  minimumClearanceM: null,
  timeoutBonusMs: 0,
  usedDetourFallback: false,
  plannerSummary: {
    mode: "direct",
    plannerStage: "direct",
    blockedReason: "none",
    minimumClearanceM: null,
    waypointCount: 0,
  },
});

export const resolveBlockedRoverApproachDirectRouteFallback = ({
  navigationRoute,
  navigationWaypointLegs,
  segmentStartWorld,
  finalNavigationGoalWorld,
  navigationContext,
  targetObjectId,
  robotFootprint,
  distanceToTargetM,
  directFallbackDistanceLimitM,
}: {
  navigationRoute: RoverApproachWorldRouteResult;
  navigationWaypointLegs: readonly RoverApproachWaypointLeg[];
  segmentStartWorld: THREE.Vector3;
  finalNavigationGoalWorld: THREE.Vector3;
  navigationContext: ReturnType<typeof buildRoverApproachWorldNavigationContext>;
  targetObjectId: string;
  robotFootprint?: RoverApproachRobotFootprint;
  distanceToTargetM: number;
  directFallbackDistanceLimitM: number;
}): RoverApproachWorldRouteResult | null => {
  if (navigationRoute.mode !== "blocked" || navigationWaypointLegs.length > 0) {
    return null;
  }
  const isNearEnoughForBlockedRouteFallback =
    Number.isFinite(distanceToTargetM) &&
    distanceToTargetM <= Math.max(0, directFallbackDistanceLimitM);
  if (!isNearEnoughForBlockedRouteFallback) {
    return null;
  }
  const runtimeStopPathClearanceM = resolveRoverApproachCollisionPathClearanceM({
    useCase: "runtime-stop",
  });
  const directAssessment = assessRoverApproachWorldSegmentClearance({
    segmentStartWorld,
    segmentEndWorld: finalNavigationGoalWorld,
    navigationContext,
    excludedObstacleId: targetObjectId,
    robotFootprint,
    pathClearanceM: runtimeStopPathClearanceM,
  });
  return directAssessment.isClear
    ? createDirectRoverApproachWorldRoute({
        pathClearanceM: runtimeStopPathClearanceM,
      })
    : null;
};

type ResolveRoverApproachAsyncAbortReasonArgs = {
  manualApproachInterrupted: boolean;
  wheelDriveEnabled: boolean;
  isStaleSolve: boolean;
};

type ExecuteRoverApproachBeforeIkSolveArgs = {
  context: IkObjectPreSolveContext;
  isAssemblyWorkspace: boolean;
  robot: URDFRobot | null;
  urdfAnalysis: UrdfAnalysis | null;
  primaryIkEndEffectorLink: string | null;
  wheelDriveEnabled: boolean;
  worldObjects: CreatedObject[];
  roverApproachWorldNavigationObjects: SerializedWorldObjectObstacleSource[];
  getStudioUpAxis: () => THREE.Vector3;
  resolveRobotFrontWorldDirection: () => THREE.Vector3;
  hideRoverApproachRoutePreviewOverlay: () => void;
  enforceRoverApproachPlanarPose: (targetRobot: URDFRobot) => void;
  resolveRoverApproachRobotFootprint: (args: {
    robot: URDFRobot;
    wheelModel: StudioWheelDriveModel;
    upAxisWorld: THREE.Vector3;
    forwardWorld: THREE.Vector3;
  }) => RoverApproachRobotFootprint;
  resolveRoverFootprintSupportRadiusM: (args: {
    robotFootprint: RoverApproachRobotFootprint | undefined;
    forwardWorld: THREE.Vector3;
    upAxisWorld: THREE.Vector3;
    targetDirectionWorld: THREE.Vector3;
  }) => number;
  manualApproachInterruptRef: { current: boolean };
  autoRoverApproachActiveRef: { current: boolean };
  wheelDriveEnabledRef: { current: boolean };
  studioWheelDriveRef: { current: StudioWheelDriveState | null };
  wheelDriveJointOverridesRef: { current: Record<string, boolean> };
  roverApproachGuideLineRef: { current: RoverApproachGuideLineState };
  roverApproachRoutePreviewRef: { current: RoverApproachRoutePreviewState };
  resetApproachArmTargetsRef: { current: () => Record<string, number> };
  setDisplayStatus: (
    key: string,
    status: ReturnType<typeof resolveRoverApproachNavigationDisplayStatus>
  ) => void;
  setDisplayMetrics: (
    key: string,
    metrics: ReturnType<typeof toRoverApproachNavigationDisplayMetrics>
  ) => void;
  setDiagnosticHealth: (value: string) => void;
  setStoreJointValue: (
    name: string,
    value: number,
    options?: SetJointValueOptions
  ) => number;
};

export const resolveRoverApproachAsyncAbortReason = ({
  manualApproachInterrupted,
  wheelDriveEnabled,
  isStaleSolve,
}: ResolveRoverApproachAsyncAbortReasonArgs): RoverApproachAsyncAbortReason | null => {
  if (!wheelDriveEnabled) return "wheel-disabled";
  if (manualApproachInterrupted) return "manual-base-drag";
  if (isStaleSolve) return "stale-solve";
  return null;
};

const resolveRoverApproachAsyncAbortResult = ({
  manualApproachInterrupted,
  wheelDriveEnabled,
  isStaleSolve,
  durationMs,
}: ResolveRoverApproachAsyncAbortReasonArgs & {
  durationMs?: number;
}): IkObjectPreSolveResult | null => {
  const reason = resolveRoverApproachAsyncAbortReason({
    manualApproachInterrupted,
    wheelDriveEnabled,
    isStaleSolve,
  });
  if (!reason) return null;
  return {
    status: "cancelled",
    reason,
    durationMs,
  };
};

const nowMs = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const nextAnimationFrameTimeMs = (): Promise<number> =>
  new Promise<number>((resolve) => requestAnimationFrame((time) => resolve(time)));

const resolveRoverApproachBaseObject = (
  robot: URDFRobot,
  armReachEnvelope: ReturnType<typeof resolveArmReachEnvelope>
): THREE.Object3D => {
  const robotAny = robot as URDFRobot & {
    links?: Record<string, THREE.Object3D>;
    getObjectByName?: (name: string) => THREE.Object3D | undefined;
  };
  const baseLinkName = armReachEnvelope?.baseLinkName;
  if (!baseLinkName) return robot as THREE.Object3D;
  return (
    robotAny.links?.[baseLinkName] ??
    robotAny.getObjectByName?.(baseLinkName) ??
    (robot as THREE.Object3D)
  );
};

const waitForApproachArmResetAfterLocomotion = async ({
  robot,
  targetJointValues,
  manualApproachInterruptRef,
  wheelDriveEnabledRef,
  isStaleSolve,
  reportProgress,
  distanceToTargetM,
  yawErrorRad,
}: {
  robot: URDFRobot | null;
  targetJointValues: Readonly<Record<string, number>>;
  manualApproachInterruptRef: { current: boolean };
  wheelDriveEnabledRef: { current: boolean };
  isStaleSolve: () => boolean;
  reportProgress: IkObjectPreSolveContext["reportProgress"];
  distanceToTargetM: number;
  yawErrorRad: number;
}): Promise<IkObjectPreSolveResult | null> => {
  if (Object.keys(targetJointValues).length === 0) {
    return null;
  }
  let armResetSettledFrameCount = 0;
  let armResetFrameTimeMs = nowMs();
  const armResetDeadlineMs =
    armResetFrameTimeMs + ROVER_APPROACH_CONFIG.armResetSettleTimeoutMs;
  while (armResetFrameTimeMs < armResetDeadlineMs) {
    const armResetAbortResult = resolveRoverApproachAsyncAbortResult({
      manualApproachInterrupted: manualApproachInterruptRef.current,
      wheelDriveEnabled: wheelDriveEnabledRef.current,
      isStaleSolve: isStaleSolve(),
    });
    if (armResetAbortResult) {
      return armResetAbortResult;
    }
    const armResetSettled = areApproachArmResetTargetsSettled({
      robot,
      targetJointValues,
      jointToleranceRad: ROVER_APPROACH_CONFIG.armResetJointToleranceRad,
    });
    if (armResetSettled) {
      armResetSettledFrameCount += 1;
      if (armResetSettledFrameCount >= ROVER_APPROACH_CONFIG.armResetSettleFrames) {
        break;
      }
    } else {
      armResetSettledFrameCount = 0;
    }
    reportProgress({
      phase: "idle",
      distanceToTargetM,
      yawErrorDeg: (yawErrorRad * 180) / Math.PI,
    });
    armResetFrameTimeMs = await nextAnimationFrameTimeMs();
  }
  return null;
};

export const resolveLockedRoverApproachTimeoutBudgetMs = ({
  lockedRoutePointWorlds,
  driveLinearScale,
  driveAngularScale,
}: {
  lockedRoutePointWorlds: readonly THREE.Vector3[];
  driveLinearScale: number;
  driveAngularScale: number;
}): number => {
  const safeLinearScale = Math.max(
    driveLinearScale,
    WHEEL_PLAYBACK_MOTION_PARAMS.driveAuthorityEpsilon
  );
  const safeAngularScale = Math.max(
    driveAngularScale,
    WHEEL_PLAYBACK_MOTION_PARAMS.driveAuthorityEpsilon
  );
  let totalDistanceM = 0;
  let totalTurnRad = 0;
  for (let index = 1; index < lockedRoutePointWorlds.length; index += 1) {
    totalDistanceM += lockedRoutePointWorlds[index].distanceTo(
      lockedRoutePointWorlds[index - 1]
    );
  }
  for (let index = 1; index < lockedRoutePointWorlds.length - 1; index += 1) {
    const previousVector = lockedRoutePointWorlds[index]
      .clone()
      .sub(lockedRoutePointWorlds[index - 1]);
    const nextVector = lockedRoutePointWorlds[index + 1]
      .clone()
      .sub(lockedRoutePointWorlds[index]);
    const previousLength = previousVector.length();
    const nextLength = nextVector.length();
    if (
      previousLength * previousLength <=
        ROVER_APPROACH_DETOUR_CONFIG.segmentLengthEpsilonSq ||
      nextLength * nextLength <=
        ROVER_APPROACH_DETOUR_CONFIG.segmentLengthEpsilonSq
    ) {
      continue;
    }
    previousVector.multiplyScalar(1 / previousLength);
    nextVector.multiplyScalar(1 / nextLength);
    totalTurnRad += Math.acos(
      THREE.MathUtils.clamp(previousVector.dot(nextVector), -1, 1)
    );
  }
  const effectiveLinearSpeedMps = Math.max(
    ROVER_APPROACH_DETOUR_CONFIG.timeoutMinLinearSpeedMps,
    ROVER_APPROACH_CONFIG.maxLinearSpeedMps *
      safeLinearScale *
      ROVER_APPROACH_DETOUR_CONFIG.timeoutLinearSpeedUtilization
  );
  const effectiveAngularSpeedRadps = Math.max(
    ROVER_APPROACH_DETOUR_CONFIG.timeoutMinAngularSpeedRadps,
    ROVER_APPROACH_CONFIG.maxAngularSpeedRadps *
      safeAngularScale *
      ROVER_APPROACH_DETOUR_CONFIG.timeoutAngularSpeedUtilization
  );
  const waypointCount = Math.max(0, lockedRoutePointWorlds.length - 2);
  const segmentCount = Math.max(0, lockedRoutePointWorlds.length - 1);
  return Math.ceil(
    (totalDistanceM / effectiveLinearSpeedMps) * 1000 +
      (totalTurnRad / effectiveAngularSpeedRadps) * 1000 +
      segmentCount * ROVER_APPROACH_DETOUR_CONFIG.timeoutPerSegmentMs +
      waypointCount * ROVER_APPROACH_DETOUR_CONFIG.timeoutPerWaypointMs
  );
};

export const shouldFallbackToTargetCenteredRoverRoute = ({
  isOrbitTarget,
  hasLockedContactGoal,
}: {
  isOrbitTarget: boolean;
  hasLockedContactGoal: boolean;
}): boolean => !isOrbitTarget && !hasLockedContactGoal;

export const shouldUseObjectContactRouteClearance = ({
  isOrbitTarget,
  hasLockedContactGoal,
}: {
  isOrbitTarget: boolean;
  hasLockedContactGoal: boolean;
}): boolean => !isOrbitTarget && hasLockedContactGoal;

export const executeRoverApproachBeforeIkSolve = async ({
  context,
  isAssemblyWorkspace,
  robot,
  urdfAnalysis,
  primaryIkEndEffectorLink,
  wheelDriveEnabled,
  worldObjects,
  roverApproachWorldNavigationObjects,
  getStudioUpAxis,
  resolveRobotFrontWorldDirection,
  hideRoverApproachRoutePreviewOverlay,
  enforceRoverApproachPlanarPose,
  resolveRoverApproachRobotFootprint,
  resolveRoverFootprintSupportRadiusM,
  manualApproachInterruptRef,
  autoRoverApproachActiveRef,
  wheelDriveEnabledRef,
  studioWheelDriveRef,
  wheelDriveJointOverridesRef,
  roverApproachGuideLineRef,
  roverApproachRoutePreviewRef,
  resetApproachArmTargetsRef,
  setDisplayStatus,
  setDisplayMetrics,
  setDiagnosticHealth,
  setStoreJointValue,
}: ExecuteRoverApproachBeforeIkSolveArgs): Promise<IkObjectPreSolveResult> => {
  const {
    object,
    targetPositionWorld,
    isOrbitTarget,
    targetKind = "object-center",
    isStaleSolve,
    reportProgress,
  } = context;
  if (isAssemblyWorkspace || !robot) {
    hideRoverApproachRoutePreviewOverlay();
    return {
      status: "skipped",
      reason: "assembly-workspace",
    };
  }

  hideRoverApproachRoutePreviewOverlay();
  hideRoverApproachRoutePreview(roverApproachRoutePreviewRef.current);
  manualApproachInterruptRef.current = false;
  autoRoverApproachActiveRef.current = true;
  let navigationAbortController: AbortController | null = null;
  let navigationCancelWatchActive = false;

  try {
    const wheelDrive = studioWheelDriveRef.current;
    const wheelModel = wheelDrive?.model ?? null;
    const upAxis = getStudioUpAxis();
    const targetWorld = new THREE.Vector3(
      targetPositionWorld[0],
      targetPositionWorld[1],
      targetPositionWorld[2]
    );
    const targetObjectGeometry = resolveWorldObjectGeometry(object);
    const roverBaseRadiusM =
      Number.isFinite(wheelModel?.trackWidth) && (wheelModel?.trackWidth ?? 0) > 0
        ? (wheelModel?.trackWidth as number) * 0.5
        : ROVER_APPROACH_DETOUR_CONFIG.baseRadiusFallbackM;
    const roverRobotFootprint =
      wheelModel !== null
        ? resolveRoverApproachRobotFootprint({
            robot,
            wheelModel,
            upAxisWorld: upAxis,
            forwardWorld: resolveRobotFrontWorldDirection(),
          })
        : undefined;
    const roverMaxContactStopDistanceM = Math.max(
      roverBaseRadiusM,
      roverRobotFootprint
        ? Math.hypot(roverRobotFootprint.halfLengthM, roverRobotFootprint.halfWidthM)
        : 0
    );
    const armReachEnvelope = resolveArmReachEnvelope({
      robot,
      urdfAnalysis,
      endEffectorLink: primaryIkEndEffectorLink,
      maxLinkTraversal: IK_DRAG_CONFIG.maxLinkTraversal,
    });
    const baseObject = resolveRoverApproachBaseObject(robot, armReachEnvelope);
    const basePositionWorld = new THREE.Vector3();
    const toNavigationPlanarWorld = new THREE.Vector3();
    const normalizedTargetDirectionWorld = new THREE.Vector3();
    const resolveState = ({
      legTarget,
    }: {
      legTarget: RoverApproachLegTarget;
    }) => {
      baseObject.updateMatrixWorld(true);
      baseObject.getWorldPosition(basePositionWorld);
      const {
        navigationGoalWorld,
        applyObjectSupportRadius,
        facingDirectionWorld,
        facingTargetWorld,
      } = legTarget;
      updateRoverApproachGuideLineToTarget({
        guideState: roverApproachGuideLineRef.current,
        robot,
        object,
        endEffectorLink: primaryIkEndEffectorLink,
        fallbackSegmentStartWorld: basePositionWorld,
        targetWorld,
        upAxisWorld: upAxis,
      });
      toNavigationPlanarWorld.copy(navigationGoalWorld).sub(basePositionWorld);
      const targetDirectionPlanarWorld = new THREE.Vector3()
        .copy(toNavigationPlanarWorld)
        .addScaledVector(upAxis, -toNavigationPlanarWorld.dot(upAxis));
      const distanceToNavigationGoalM = targetDirectionPlanarWorld.length();
      const forwardWorld = resolveRobotFrontWorldDirection();
      const lockedFacingTargetWorld = facingTargetWorld;
      if (applyObjectSupportRadius) {
        const lockedGoalState = resolveRoverApproachLockedGoalState({
          basePositionWorld,
          navigationGoalWorld,
          facingTargetWorld: lockedFacingTargetWorld,
          facingDirectionWorld,
          forwardWorld,
          upAxisWorld: upAxis,
        });
        return {
          distanceToTargetM: lockedGoalState.distanceToGoalM,
          yawErrorRad: lockedGoalState.yawErrorRad,
          forwardDotTarget: lockedGoalState.forwardDotFacingTarget,
        };
      }
      if (distanceToNavigationGoalM <= 0) {
        const zeroDistanceState = resolveRoverApproachLockedGoalState({
          basePositionWorld,
          navigationGoalWorld,
          facingTargetWorld: lockedFacingTargetWorld,
          facingDirectionWorld,
          forwardWorld,
          upAxisWorld: upAxis,
        });
        return {
          distanceToTargetM: 0,
          yawErrorRad: zeroDistanceState.yawErrorRad,
          forwardDotTarget: zeroDistanceState.forwardDotFacingTarget,
        };
      }
      normalizedTargetDirectionWorld
        .copy(targetDirectionPlanarWorld)
        .multiplyScalar(1 / distanceToNavigationGoalM);
      const applyObjectSupportRadiusForTarget =
        applyObjectSupportRadius && targetKind !== "surface-point";
      const approachDistance = applyObjectSupportRadiusForTarget
        ? resolveRoverPlanarObjectApproachDistance({
            object: {
              type: resolveApproachObjectPrimitiveType(object.type),
              size: targetObjectGeometry.size,
              rotation: object.rotation,
            },
            targetDirectionPlanarWorld,
          })
        : null;
      const centerDistanceToTargetM =
        approachDistance?.centerDistanceM ?? distanceToNavigationGoalM;
      const supportRadiusM =
        applyObjectSupportRadiusForTarget && !isOrbitTarget
          ? (approachDistance?.supportRadiusM ?? 0)
          : 0;
      const roverProjectedStopDistanceM = !isOrbitTarget
        ? Math.max(
            roverBaseRadiusM,
            resolveRoverFootprintSupportRadiusM({
              robotFootprint: roverRobotFootprint,
              forwardWorld,
              upAxisWorld: upAxis,
              targetDirectionWorld: normalizedTargetDirectionWorld,
            })
          )
        : 0;
      const stopOffsetM = !isOrbitTarget
        ? roverProjectedStopDistanceM + ROVER_APPROACH_CONFIG.objectContactSurfaceStandoffM
        : 0;
      const distanceToTargetM = Math.max(0, centerDistanceToTargetM - supportRadiusM);
      const goalState = resolveRoverApproachLockedGoalState({
        basePositionWorld,
        navigationGoalWorld,
        facingTargetWorld: lockedFacingTargetWorld,
        facingDirectionWorld,
        forwardWorld,
        upAxisWorld: upAxis,
      });
      return {
        distanceToTargetM,
        yawErrorRad:
          lockedFacingTargetWorld || facingDirectionWorld
            ? goalState.yawErrorRad
            : computeSignedPlanarYawErrorRad(
                forwardWorld,
                normalizedTargetDirectionWorld,
                upAxis
              ),
        forwardDotTarget:
          lockedFacingTargetWorld || facingDirectionWorld
            ? goalState.forwardDotFacingTarget
            : forwardWorld.dot(normalizedTargetDirectionWorld),
      };
    };

    const runtimeNavigationContext = buildRoverApproachWorldNavigationContext({
      objects: worldObjects,
      upAxisWorld: upAxis,
    });
    baseObject.updateMatrixWorld(true);
    baseObject.getWorldPosition(basePositionWorld);
    const retreatWaypoint = resolveRoverApproachRetreatWaypoint({
      basePositionWorld,
      targetObjectId: object.id,
      worldObjects,
      upAxisWorld: upAxis,
      forwardWorld: resolveRobotFrontWorldDirection(),
      roverBaseRadiusM,
      robotFootprint: roverRobotFootprint,
    });
    navigationAbortController = new AbortController();
    navigationCancelWatchActive = true;
    const watchNavigationCancellation = () => {
      if (!navigationCancelWatchActive || navigationAbortController.signal.aborted) {
        return;
      }
      if (
        manualApproachInterruptRef.current ||
        !wheelDriveEnabledRef.current ||
        isStaleSolve()
      ) {
        navigationAbortController.abort();
        return;
      }
      requestAnimationFrame(watchNavigationCancellation);
    };
    requestAnimationFrame(watchNavigationCancellation);
    const directPathSegmentStartWorld =
      retreatWaypoint?.waypointWorld.clone() ?? basePositionWorld.clone();
    updateRoverApproachGuideLine({
      guideState: roverApproachGuideLineRef.current,
      robot,
      object,
      endEffectorLink: primaryIkEndEffectorLink,
      fallbackSegmentStartWorld: directPathSegmentStartWorld,
      fallbackSegmentEndWorld: targetWorld,
      upAxisWorld: upAxis,
    });
    const lockedContactGoal = !isOrbitTarget
      ? await resolveRoverApproachObjectContactGoalAsync({
          object,
          worldObjects,
          basePositionWorld: directPathSegmentStartWorld,
          targetWorld,
          upAxisWorld: upAxis,
          navigationContext: runtimeNavigationContext,
          roverBaseRadiusM,
          robotFootprint: roverRobotFootprint,
          targetKind,
          signal: navigationAbortController.signal,
        })
      : null;
    const earlyAbortResult = resolveRoverApproachAsyncAbortResult({
      manualApproachInterrupted: manualApproachInterruptRef.current,
      wheelDriveEnabled: wheelDriveEnabledRef.current,
      isStaleSolve: isStaleSolve(),
    });
    if (earlyAbortResult) {
      navigationCancelWatchActive = false;
      return earlyAbortResult;
    }
    const lockedNavigationGoalWorld = lockedContactGoal?.goalWorld.clone() ?? null;
    const lockedNavigationFacingTargetWorld =
      lockedContactGoal?.targetWorld.clone() ?? targetWorld.clone();
    const lockedNavigationRoute = lockedContactGoal?.route ?? null;
    const finalFacingTarget = resolveRoverApproachFinalLegTarget({
      navigationGoalWorld: lockedNavigationGoalWorld ?? targetWorld,
      facingTargetWorld: lockedNavigationFacingTargetWorld,
      applyObjectSupportRadius: lockedNavigationGoalWorld !== null,
    });
    const initialState = resolveState({ legTarget: finalFacingTarget });
    const directPathSegmentEndWorld = finalFacingTarget.navigationGoalWorld.clone();
    if (wheelDriveEnabled && !wheelModel) {
      return {
        status: "failed",
        reason: "wheel-model-missing",
        durationMs: 0,
        finalDistanceToTargetM: initialState.distanceToTargetM,
        finalYawErrorDeg: (initialState.yawErrorRad * 180) / Math.PI,
      };
    }
    const plan = planRoverApproach({
      wheelDriveEnabled,
      hasWheelDriveModel: wheelModel !== null,
      distanceToTargetM: initialState.distanceToTargetM,
      forwardDotTarget: initialState.forwardDotTarget,
      armReachRadiusM: armReachEnvelope?.radiusMeters ?? null,
      preferredStopDistanceM: !isOrbitTarget
        ? lockedNavigationGoalWorld
          ? 0
          : roverMaxContactStopDistanceM + ROVER_APPROACH_CONFIG.objectContactSurfaceStandoffM
        : null,
      preferredDistanceToleranceM: !isOrbitTarget
        ? ROVER_APPROACH_CONFIG.objectContactDistanceToleranceM
        : null,
    });
    if (!shouldExecuteRoverApproachPlan(plan) || plan.mode === "skip") {
      reportProgress({
        phase: "done",
        distanceToTargetM: initialState.distanceToTargetM,
        yawErrorDeg: (initialState.yawErrorRad * 180) / Math.PI,
      });
      return {
        status: "skipped",
        reason: plan.reason,
        durationMs: 0,
        finalDistanceToTargetM: initialState.distanceToTargetM,
        finalYawErrorDeg: (initialState.yawErrorRad * 180) / Math.PI,
      };
    }
    const activeDriveWheelNames = new Set(
      getPreferredStudioDriveWheels(wheelModel, wheelDriveJointOverridesRef.current).map(
        (wheel) => wheel.jointName
      )
    );
    const driveAuthority = computeStudioWheelDriveAuthority(
      wheelModel.wheels.map((wheel) => ({
        jointName: wheel.jointName,
        side: wheel.side,
      })),
      activeDriveWheelNames
    );
    if (
      driveAuthority.linearScale <= WHEEL_PLAYBACK_MOTION_PARAMS.driveAuthorityEpsilon &&
      driveAuthority.angularScale <= WHEEL_PLAYBACK_MOTION_PARAMS.driveAuthorityEpsilon
    ) {
      return {
        status: "failed",
        reason: "no-active-drive-wheels",
        durationMs: 0,
        finalDistanceToTargetM: initialState.distanceToTargetM,
        finalYawErrorDeg: (initialState.yawErrorRad * 180) / Math.PI,
      };
    }
    const useObjectContactRouteClearance = shouldUseObjectContactRouteClearance({
      isOrbitTarget,
      hasLockedContactGoal: lockedContactGoal !== null,
    });
    const routePlanningBypassed = shouldBypassRoverApproachRoutePlanning({
      plan,
      retreatWaypoint,
    });
    let navigationRoute =
      routePlanningBypassed
        ? createDirectRoverApproachWorldRoute({
            pathClearanceM: 0,
          })
        : lockedNavigationRoute;
    if (navigationRoute === null) {
      navigationRoute = await resolveRoverApproachWorldRouteAsync(
        {
          objects: roverApproachWorldNavigationObjects,
          upAxisWorld: toRoverApproachWorldVector3Tuple(upAxis),
          segmentStartWorld: toRoverApproachWorldVector3Tuple(directPathSegmentStartWorld),
          segmentEndWorld: toRoverApproachWorldVector3Tuple(directPathSegmentEndWorld),
          excludedObstacleId: object.id,
          roverBaseRadiusM,
          robotFootprint: roverRobotFootprint,
          isObjectContactTarget: useObjectContactRouteClearance,
        },
        navigationAbortController.signal
      );
    }
    navigationCancelWatchActive = false;
    const routeAbortResult = resolveRoverApproachAsyncAbortResult({
      manualApproachInterrupted: manualApproachInterruptRef.current,
      wheelDriveEnabled: wheelDriveEnabledRef.current,
      isStaleSolve: isStaleSolve(),
    });
    if (navigationRoute === null || routeAbortResult) {
      return routeAbortResult ?? {
        status: "cancelled",
        reason: "stale-solve",
      };
    }
    if (
      shouldFallbackToTargetCenteredRoverRoute({
        isOrbitTarget,
        hasLockedContactGoal: lockedContactGoal !== null,
      })
    ) {
      setDiagnosticHealth("Rover approach falling back to target-centered route");
    } else if (routePlanningBypassed) {
      setDiagnosticHealth("Rover approach turning in place without route solve");
    }
    if (navigationRoute.diagnostics) {
      setDisplayStatus(
        "diagnostics_overlay",
        resolveRoverApproachNavigationDisplayStatus(navigationRoute.diagnostics)
      );
      setDisplayMetrics(
        "diagnostics_overlay",
        toRoverApproachNavigationDisplayMetrics(navigationRoute.diagnostics)
      );
      setDiagnosticHealth(
        formatRoverApproachNavigationDiagnosticLine(navigationRoute.diagnostics)
      );
    }
    let {
      lockedRoutePointWorlds,
      navigationWaypointLegs,
      hasLockedPurpleRoute,
    } = resolveRoverApproachNavigationRouteState({
      basePositionWorld,
      segmentStartWorld: directPathSegmentStartWorld,
      retreatWaypoint,
      navigationRoute,
      finalFacingTarget,
      lockedNavigationGoalWorld,
      targetObjectId: object.id,
    });
    const blockedDirectRouteFallback = resolveBlockedRoverApproachDirectRouteFallback({
      navigationRoute,
      navigationWaypointLegs,
      segmentStartWorld: directPathSegmentStartWorld,
      finalNavigationGoalWorld: finalFacingTarget.navigationGoalWorld,
      navigationContext: runtimeNavigationContext,
      targetObjectId: object.id,
      robotFootprint: roverRobotFootprint,
      distanceToTargetM: initialState.distanceToTargetM,
      directFallbackDistanceLimitM:
        plan.desiredStopDistanceM +
        plan.distanceToleranceM +
        ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.blockedRouteDirectFallbackExtraDistanceM,
    });
    if (blockedDirectRouteFallback) {
      navigationRoute = blockedDirectRouteFallback;
      ({
        lockedRoutePointWorlds,
        navigationWaypointLegs,
        hasLockedPurpleRoute,
      } = resolveRoverApproachNavigationRouteState({
        basePositionWorld,
        segmentStartWorld: directPathSegmentStartWorld,
        retreatWaypoint,
        navigationRoute,
        finalFacingTarget,
        lockedNavigationGoalWorld,
        targetObjectId: object.id,
      }));
      setDiagnosticHealth("Rover approach using direct runtime-clear fallback");
    }
    if (navigationRoute.mode === "blocked" && navigationWaypointLegs.length === 0) {
      return {
        status: "failed",
        reason: "path-blocked",
      };
    }
    const finalLegApproachPlan = plan;
    const routeTimeoutBudgetMs = resolveLockedRoverApproachTimeoutBudgetMs({
      lockedRoutePointWorlds,
      driveLinearScale: driveAuthority.linearScale,
      driveAngularScale: driveAuthority.angularScale,
    });
    let lastProgressPublishMs = nowMs();
    const startMs = lastProgressPublishMs;
    let timeoutDeadlineMs =
      startMs +
      Math.max(ROVER_APPROACH_CONFIG.timeoutMs, routeTimeoutBudgetMs) +
      navigationRoute.timeoutBonusMs;
    let lastFrameMs = startMs;
    let settledFrameCount = 0;
    let commandedLinearSpeedMps = 0;
    let commandedAngularSpeedRadps = 0;
    const nextBasePositionWorld = new THREE.Vector3();
    let activeWaypointLeg = navigationWaypointLegs[0] ?? null;
    let activeLegTarget: RoverApproachLegTarget = resolveActiveRoverApproachLegTarget({
      activeWaypointLeg,
      finalFacingTarget,
    });
    let locomotionPhase = resolveInitialRoverApproachPhase(
      resolveState({ legTarget: activeLegTarget }).yawErrorRad
    );
    let remainingRuntimeCollisionRouteRetries =
      ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.runtimeCollisionRouteRetryMaxAttempts;
    const updateLockedRoutePreview = () => {
      if (hasLockedPurpleRoute) {
        updateRoverApproachRoutePreview({
          routePreviewState: roverApproachRoutePreviewRef.current,
          pointWorlds: lockedRoutePointWorlds,
          upAxisWorld: upAxis,
        });
        return;
      }
      hideRoverApproachRoutePreview(roverApproachRoutePreviewRef.current);
    };
    const applyNavigationRouteState = ({
      route,
      segmentStartWorld,
      basePositionWorld,
      retreatWaypoint,
    }: {
      route: RoverApproachWorldRouteResult;
      segmentStartWorld: THREE.Vector3;
      basePositionWorld: THREE.Vector3;
      retreatWaypoint: RoverApproachRetreatWaypoint | null;
    }) => {
      const routeState = resolveRoverApproachNavigationRouteState({
        basePositionWorld,
        segmentStartWorld,
        retreatWaypoint,
        navigationRoute: route,
        finalFacingTarget,
        lockedNavigationGoalWorld,
        targetObjectId: object.id,
      });
      lockedRoutePointWorlds = routeState.lockedRoutePointWorlds;
      navigationWaypointLegs = routeState.navigationWaypointLegs;
      hasLockedPurpleRoute = routeState.hasLockedPurpleRoute;
      updateLockedRoutePreview();
      return routeState;
    };
    updateLockedRoutePreview();
    const beginFinalLeg = (frameTimeMs: number) => {
      settledFrameCount = 0;
      commandedLinearSpeedMps = 0;
      commandedAngularSpeedRadps = 0;
      activeLegTarget = resolveActiveRoverApproachLegTarget({
        activeWaypointLeg: null,
        finalFacingTarget,
      });
      timeoutDeadlineMs = Math.max(
        timeoutDeadlineMs,
        frameTimeMs + ROVER_APPROACH_DETOUR_CONFIG.finalLegMinBudgetMs
      );
      locomotionPhase = resolveInitialRoverApproachPhase(
        resolveState({ legTarget: activeLegTarget }).yawErrorRad
      );
    };
    const advanceWaypointLeg = (frameTimeMs: number) => {
      navigationWaypointLegs = navigationWaypointLegs.slice(1);
      activeWaypointLeg = navigationWaypointLegs[0] ?? null;
      if (activeWaypointLeg) {
        settledFrameCount = 0;
        commandedLinearSpeedMps = 0;
        commandedAngularSpeedRadps = 0;
        activeLegTarget = resolveActiveRoverApproachLegTarget({
          activeWaypointLeg,
          finalFacingTarget,
        });
        locomotionPhase = resolveInitialRoverApproachPhase(
          resolveState({ legTarget: activeLegTarget }).yawErrorRad
        );
        return;
      }
      beginFinalLeg(frameTimeMs);
    };
    while (true) {
      if (manualApproachInterruptRef.current) {
        return {
          status: "cancelled",
          reason: "manual-base-drag",
          durationMs: nowMs() - startMs,
        };
      }
      if (!wheelDriveEnabledRef.current) {
        return {
          status: "cancelled",
          reason: "wheel-disabled",
          durationMs: nowMs() - startMs,
        };
      }
      if (isStaleSolve()) {
        return {
          status: "cancelled",
          reason: "stale-solve",
          durationMs: nowMs() - startMs,
        };
      }
      const frameTimeMs = await nextAnimationFrameTimeMs();
      const frameAbortResult = resolveRoverApproachAsyncAbortResult({
        manualApproachInterrupted: manualApproachInterruptRef.current,
        wheelDriveEnabled: wheelDriveEnabledRef.current,
        isStaleSolve: isStaleSolve(),
        durationMs: nowMs() - startMs,
      });
      if (frameAbortResult) {
        return frameAbortResult;
      }
      const dtSec = clampRoverApproachDtSec((frameTimeMs - lastFrameMs) / 1000);
      lastFrameMs = frameTimeMs;
      activeWaypointLeg = navigationWaypointLegs[0] ?? null;
      const activeWaypointWorld = activeWaypointLeg?.waypointWorld ?? null;
      const isWaypointLeg = activeWaypointWorld !== null;
      const state = resolveState({ legTarget: activeLegTarget });
      const activePlan = isWaypointLeg
        ? resolveWaypointLegApproachPlan({
            wheelDriveEnabled: wheelDriveEnabledRef.current,
            hasWheelDriveModel: wheelModel !== null,
            distanceToTargetM: state.distanceToTargetM,
            forwardDotTarget: state.forwardDotTarget,
          })
        : finalLegApproachPlan;
      const frame = resolveRoverApproachFrame({
        phase: locomotionPhase,
        yawErrorRad: state.yawErrorRad,
        distanceToTargetM: state.distanceToTargetM,
        dtSec,
        plan: activePlan,
      });
      locomotionPhase = frame.phase;
      const step = frame.step;
      const desiredSpeeds = resolveRoverApproachDesiredSpeeds({
        step,
        driveLinearScale: driveAuthority.linearScale,
        driveAngularScale: driveAuthority.angularScale,
        dtSec,
      });
      const nextSpeedState = advanceRoverApproachSpeeds({
        current: {
          linearSpeedMps: commandedLinearSpeedMps,
          angularSpeedRadps: commandedAngularSpeedRadps,
        },
        desired: desiredSpeeds,
        dtSec,
        done: step.done,
        phase: step.phase,
        enforcePhaseAxisLock: !activePlan.allowTranslationYawAssist,
      });
      const appliedMotion = resolveAppliedRoverApproachMotion({
        speedState: nextSpeedState,
        dtSec,
        remainingDistanceM: Math.max(0, state.distanceToTargetM - activePlan.desiredStopDistanceM),
        remainingYawErrorRad: state.yawErrorRad,
        phase: step.phase,
        enforceExactTurnStop: !activePlan.allowTranslationYawAssist,
      });
      commandedLinearSpeedMps = appliedMotion.speedState.linearSpeedMps;
      commandedAngularSpeedRadps = appliedMotion.speedState.angularSpeedRadps;
      if (!activePlan.allowTranslationYawAssist && appliedMotion.completedExactTurn) {
        locomotionPhase = "translate";
        commandedAngularSpeedRadps = 0;
      }
      if (step.done) {
        settledFrameCount += 1;
      } else {
        settledFrameCount = 0;
      }
      const linearTravel = appliedMotion.linearTravelM;
      const angularTravel = appliedMotion.angularTravelRad;
      if (
        Math.abs(linearTravel) > ROVER_APPROACH_CONFIG.appliedTravelEpsilon ||
        Math.abs(angularTravel) > ROVER_APPROACH_CONFIG.appliedTravelEpsilon
      ) {
        const startRobotPosition = robot.position.clone();
        const startRobotQuaternion = robot.quaternion.clone();
        const startWheelAnglesByJointName = new Map<string, number>();
        wheelModel.wheels.forEach((wheel) => {
          startWheelAnglesByJointName.set(
            wheel.jointName,
            resolveJointScalarValue(wheel.joint) ?? 0
          );
        });
        const forwardWorld = resolveRobotFrontWorldDirection();
        const plannedHalfTurnQuat = new THREE.Quaternion().setFromAxisAngle(
          upAxis,
          angularTravel * 0.5
        );
        const plannedTurnQuat = new THREE.Quaternion().setFromAxisAngle(
          upAxis,
          angularTravel
        );
        const plannedDriveForwardWorld = forwardWorld
          .clone()
          .applyQuaternion(plannedHalfTurnQuat)
          .normalize();
        const plannedNextForwardWorld = forwardWorld
          .clone()
          .applyQuaternion(plannedTurnQuat)
          .normalize();
        const plannedNextBasePositionWorld = basePositionWorld
          .clone()
          .addScaledVector(plannedDriveForwardWorld, linearTravel);
        const collisionAssessment = resolveRoverApproachRuntimeCollisionAssessment({
          basePositionWorld,
          nextBasePositionWorld: plannedNextBasePositionWorld,
          forwardWorld,
          nextForwardWorld: plannedNextForwardWorld,
          navigationContext: runtimeNavigationContext,
          excludedObstacleId: activeWaypointLeg?.excludedObstacleId ?? null,
          robotFootprint: roverRobotFootprint,
        });
        const appliedMotionFraction = resolveRoverApproachRuntimeCollisionAppliedMotionFraction({
          collisionAssessment,
        });
        const appliedLinearTravel = linearTravel * appliedMotionFraction;
        const appliedAngularTravel = angularTravel * appliedMotionFraction;
        const appliedHalfTurnQuat = new THREE.Quaternion().setFromAxisAngle(
          upAxis,
          appliedAngularTravel * 0.5
        );
        const appliedTurnQuat = new THREE.Quaternion().setFromAxisAngle(
          upAxis,
          appliedAngularTravel
        );
        const appliedDriveForwardWorld = forwardWorld
          .clone()
          .applyQuaternion(appliedHalfTurnQuat)
          .normalize();
        const appliedNextForwardWorld = forwardWorld
          .clone()
          .applyQuaternion(appliedTurnQuat)
          .normalize();
        robot.position.copy(startRobotPosition);
        robot.quaternion.copy(startRobotQuaternion);
        robot.position.addScaledVector(appliedDriveForwardWorld, appliedLinearTravel);
        robot.quaternion.premultiply(appliedTurnQuat);
        wheelModel.wheels.forEach((wheel) => {
          const wheelTravel = getStudioWheelTravelForBodyMotion(
            wheel,
            appliedLinearTravel,
            appliedAngularTravel,
            wheelModel.trackWidth
          );
          const radius = resolveSafeMotionDimension(wheel.radius);
          const startAngle = startWheelAnglesByJointName.get(wheel.jointName) ?? 0;
          const deltaAngle = -(wheelTravel / radius) * wheel.directionSign;
          const nextAngle = startAngle + deltaAngle;
          wheel.joint.setJointValue(nextAngle);
          setStoreJointValue(wheel.jointName, nextAngle, {
            enforceVelocity: false,
            timestamp: frameTimeMs,
          });
          if (wheelDrive) {
            wheelDrive.previousAngles[wheel.jointName] = nextAngle;
          }
        });
        enforceRoverApproachPlanarPose(robot);
        baseObject.updateMatrixWorld(true);
        baseObject.getWorldPosition(nextBasePositionWorld);
        if (!collisionAssessment.isClear) {
          if (
            shouldFallbackToTurnInPlaceAfterRuntimeCollision({
              allowTranslationYawAssist: activePlan.allowTranslationYawAssist,
              phase: step.phase,
              linearTravelM: linearTravel,
              angularTravelRad: angularTravel,
            })
          ) {
            baseObject.getWorldPosition(basePositionWorld);
            locomotionPhase = "rotate";
            settledFrameCount = 0;
            commandedLinearSpeedMps = 0;
            commandedAngularSpeedRadps = 0;
            setDiagnosticHealth(
              "Rover approach turning in place to clear a blocked drive arc"
            );
            continue;
          }
          if (remainingRuntimeCollisionRouteRetries > 0) {
            remainingRuntimeCollisionRouteRetries -= 1;
            baseObject.updateMatrixWorld(true);
            baseObject.getWorldPosition(basePositionWorld);
            setDiagnosticHealth("Rover approach replanning around collision");
            const reroutedNavigationRoute = await resolveRoverApproachWorldRouteAsync({
              objects: roverApproachWorldNavigationObjects,
              upAxisWorld: toRoverApproachWorldVector3Tuple(upAxis),
              segmentStartWorld: toRoverApproachWorldVector3Tuple(basePositionWorld),
              segmentEndWorld: toRoverApproachWorldVector3Tuple(
                finalFacingTarget.navigationGoalWorld
              ),
              excludedObstacleId: object.id,
              roverBaseRadiusM,
              robotFootprint: roverRobotFootprint,
              isObjectContactTarget: useObjectContactRouteClearance,
            });
            const rerouteAbortResult = resolveRoverApproachAsyncAbortResult({
              manualApproachInterrupted: manualApproachInterruptRef.current,
              wheelDriveEnabled: wheelDriveEnabledRef.current,
              isStaleSolve: isStaleSolve(),
              durationMs: nowMs() - startMs,
            });
            if (rerouteAbortResult) {
              return {
                ...rerouteAbortResult,
                finalDistanceToTargetM: state.distanceToTargetM,
                finalYawErrorDeg: (state.yawErrorRad * 180) / Math.PI,
              };
            }
            if (reroutedNavigationRoute && reroutedNavigationRoute.mode !== "blocked") {
              if (reroutedNavigationRoute.diagnostics) {
                setDisplayStatus(
                  "diagnostics_overlay",
                  resolveRoverApproachNavigationDisplayStatus(
                    reroutedNavigationRoute.diagnostics
                  )
                );
                setDisplayMetrics(
                  "diagnostics_overlay",
                  toRoverApproachNavigationDisplayMetrics(
                    reroutedNavigationRoute.diagnostics
                  )
                );
                setDiagnosticHealth(
                  formatRoverApproachNavigationDiagnosticLine(
                    reroutedNavigationRoute.diagnostics
                  )
                );
              }
              applyNavigationRouteState({
                route: reroutedNavigationRoute,
                segmentStartWorld: basePositionWorld,
                basePositionWorld,
                retreatWaypoint: null,
              });
              timeoutDeadlineMs = Math.max(
                timeoutDeadlineMs,
                frameTimeMs +
                  resolveLockedRoverApproachTimeoutBudgetMs({
                    lockedRoutePointWorlds,
                    driveLinearScale: driveAuthority.linearScale,
                    driveAngularScale: driveAuthority.angularScale,
                  }) +
                  reroutedNavigationRoute.timeoutBonusMs +
                  ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.runtimeCollisionRouteRetryTimeoutBudgetMs
              );
              activeWaypointLeg = navigationWaypointLegs[0] ?? null;
              activeLegTarget = resolveActiveRoverApproachLegTarget({
                activeWaypointLeg,
                finalFacingTarget,
              });
              locomotionPhase = resolveInitialRoverApproachPhase(
                resolveState({ legTarget: activeLegTarget }).yawErrorRad
              );
              settledFrameCount = 0;
              commandedLinearSpeedMps = 0;
              commandedAngularSpeedRadps = 0;
              continue;
            }
          }
          if (
            shouldTreatRuntimeCollisionAsReachedTarget({
              activeWaypointLeg,
              blockingObstacleId: collisionAssessment.blockingObstacleId,
              isOrbitTarget,
              targetObjectId: object.id,
            })
          ) {
            return {
              status: "completed",
              reason: "reached-object",
              durationMs: frameTimeMs - startMs,
              finalDistanceToTargetM: state.distanceToTargetM,
              finalYawErrorDeg: (state.yawErrorRad * 180) / Math.PI,
            };
          }
          setDisplayStatus("diagnostics_overlay", "error");
          setDiagnosticHealth(
            formatRoverApproachRuntimeCollisionDiagnostic({
              worldObjects,
              blockingObstacleId: collisionAssessment.blockingObstacleId,
            })
          );
          selectRoverApproachRuntimeBlockingObject({
            worldObjects,
            blockingObstacleId: collisionAssessment.blockingObstacleId,
          });
          return {
            status: "failed",
            reason: "collision-blocked",
            durationMs: frameTimeMs - startMs,
            finalDistanceToTargetM: state.distanceToTargetM,
            finalYawErrorDeg: (state.yawErrorRad * 180) / Math.PI,
          };
        }
      }
      if (
        frameTimeMs - lastProgressPublishMs >= ROVER_APPROACH_CONFIG.progressPublishIntervalMs ||
        step.done
      ) {
        lastProgressPublishMs = frameTimeMs;
        reportProgress({
          phase: step.phase,
          distanceToTargetM: state.distanceToTargetM,
          yawErrorDeg: (state.yawErrorRad * 180) / Math.PI,
        });
      }
      if (
        shouldAdvanceRoverApproachWaypointLeg({
          settledFrameCount,
        })
      ) {
        if (isWaypointLeg) {
          advanceWaypointLeg(frameTimeMs);
          continue;
        }
        const armResetAbortResult = await waitForApproachArmResetAfterLocomotion({
          robot,
          targetJointValues: resetApproachArmTargetsRef.current(),
          manualApproachInterruptRef,
          wheelDriveEnabledRef,
          isStaleSolve,
          reportProgress,
          distanceToTargetM: state.distanceToTargetM,
          yawErrorRad: state.yawErrorRad,
        });
        if (armResetAbortResult) {
          return {
            ...armResetAbortResult,
            durationMs: nowMs() - startMs,
            finalDistanceToTargetM: state.distanceToTargetM,
            finalYawErrorDeg: (state.yawErrorRad * 180) / Math.PI,
          };
        }
        return {
          status: "completed",
          reason: plan.reason,
          durationMs: nowMs() - startMs,
          finalDistanceToTargetM: state.distanceToTargetM,
          finalYawErrorDeg: (state.yawErrorRad * 180) / Math.PI,
        };
      }
      if (frameTimeMs >= timeoutDeadlineMs) {
        return {
          status: "timeout",
          reason: isWaypointLeg ? "waypoint-timeout" : "timeout",
          durationMs: frameTimeMs - startMs,
          finalDistanceToTargetM: state.distanceToTargetM,
          finalYawErrorDeg: (state.yawErrorRad * 180) / Math.PI,
        };
      }
    }
  } finally {
    navigationCancelWatchActive = false;
    navigationAbortController?.abort();
    hideRoverApproachGuideLine(roverApproachGuideLineRef.current);
    hideRoverApproachRoutePreviewOverlay();
    manualApproachInterruptRef.current = false;
    autoRoverApproachActiveRef.current = false;
  }
};
