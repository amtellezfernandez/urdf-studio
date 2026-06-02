import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import type { CreatedObject } from "@/features/objects";
import { normalizeDirection, projectVectorOntoPlane } from "@/shared/lib/axisFrame";
import { resolveTrackingReference } from "@/features/viewer/trackingTarget";
import { ROVER_APPROACH_GUIDE_PARAMS } from "@/features/viewer/roverApproachGuideParams";

const DEFAULT_WORLD_UP_AXIS = new THREE.Vector3(0, 0, 1);

export type RoverApproachGuideLineState = {
  visible: boolean;
  basePlanarWorld: THREE.Vector3;
  targetPlanarWorld: THREE.Vector3;
};

export type RoverApproachRoutePreviewState = {
  visible: boolean;
  pointPlanarWorlds: THREE.Vector3[];
};

export const createRoverApproachGuideLineState = (): RoverApproachGuideLineState => ({
  visible: false,
  basePlanarWorld: new THREE.Vector3(),
  targetPlanarWorld: new THREE.Vector3(),
});

export const createRoverApproachRoutePreviewState =
  (): RoverApproachRoutePreviewState => ({
    visible: false,
    pointPlanarWorlds: [],
  });

export const hideRoverApproachGuideLine = (
  guideState: RoverApproachGuideLineState
) => {
  guideState.visible = false;
};

export const hideRoverApproachRoutePreview = (
  routePreviewState: RoverApproachRoutePreviewState
) => {
  routePreviewState.visible = false;
  routePreviewState.pointPlanarWorlds = [];
};

type UpdateRoverApproachGuideLineFromSegmentParams = {
  guideState: RoverApproachGuideLineState;
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
};

const resolveProjectedDistinctPlanarPointWorlds = ({
  pointWorlds,
  upAxisWorld,
  maxPointCount,
}: {
  pointWorlds: readonly THREE.Vector3[];
  upAxisWorld: THREE.Vector3;
  maxPointCount: number;
}): THREE.Vector3[] => {
  const normalizedUpAxis = normalizeDirection(
    upAxisWorld.clone(),
    DEFAULT_WORLD_UP_AXIS
  );
  const projectedPointWorlds: THREE.Vector3[] = [];
  for (const pointWorld of pointWorlds) {
    if (projectedPointWorlds.length >= maxPointCount) {
      break;
    }
    const projectedPointWorld = projectVectorOntoPlane(
      pointWorld.clone(),
      normalizedUpAxis
    );
    const previousPointWorld =
      projectedPointWorlds[projectedPointWorlds.length - 1] ?? null;
    if (
      previousPointWorld &&
      previousPointWorld.distanceTo(projectedPointWorld) <=
        ROVER_APPROACH_GUIDE_PARAMS.minLengthMeters
    ) {
      continue;
    }
    projectedPointWorlds.push(projectedPointWorld);
  }
  return projectedPointWorlds;
};

export const updateRoverApproachGuideLineFromSegment = ({
  guideState,
  segmentStartWorld,
  segmentEndWorld,
  upAxisWorld,
}: UpdateRoverApproachGuideLineFromSegmentParams) => {
  const projectedPointWorlds = resolveProjectedDistinctPlanarPointWorlds({
    pointWorlds: [segmentStartWorld, segmentEndWorld],
    upAxisWorld,
    maxPointCount: 2,
  });
  if (projectedPointWorlds.length < 2) {
    hideRoverApproachGuideLine(guideState);
    return;
  }
  guideState.basePlanarWorld.copy(projectedPointWorlds[0]);
  guideState.targetPlanarWorld.copy(projectedPointWorlds[1]);
  guideState.visible = true;
};

type ResolveRoverApproachGuideSegmentParams = {
  robot: URDFRobot;
  object: CreatedObject;
  endEffectorLink: string | null;
  fallbackSegmentStartWorld: THREE.Vector3;
  fallbackSegmentEndWorld: THREE.Vector3;
};

export const resolveRoverApproachGuideSegment = ({
  robot,
  object,
  endEffectorLink,
  fallbackSegmentStartWorld,
  fallbackSegmentEndWorld,
}: ResolveRoverApproachGuideSegmentParams): {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
} => {
  const trackingReference = resolveTrackingReference({
    robot,
    trackedName: object.trackedJointName,
    endEffectorLink,
  });
  if (trackingReference?.position) {
    return {
      segmentStartWorld: trackingReference.position,
      segmentEndWorld: object.position,
    };
  }
  return {
    segmentStartWorld: fallbackSegmentStartWorld,
    segmentEndWorld: fallbackSegmentEndWorld,
  };
};

type UpdateRoverApproachGuideLineParams = ResolveRoverApproachGuideSegmentParams & {
  guideState: RoverApproachGuideLineState;
  upAxisWorld: THREE.Vector3;
};

export const updateRoverApproachGuideLine = ({
  guideState,
  robot,
  object,
  endEffectorLink,
  fallbackSegmentStartWorld,
  fallbackSegmentEndWorld,
  upAxisWorld,
}: UpdateRoverApproachGuideLineParams) => {
  const { segmentStartWorld, segmentEndWorld } = resolveRoverApproachGuideSegment({
    robot,
    object,
    endEffectorLink,
    fallbackSegmentStartWorld,
    fallbackSegmentEndWorld,
  });
  updateRoverApproachGuideLineFromSegment({
    guideState,
    segmentStartWorld,
    segmentEndWorld,
    upAxisWorld,
  });
};

type UpdateRoverApproachGuideLineToTargetParams = {
  guideState: RoverApproachGuideLineState;
  robot: URDFRobot;
  object: CreatedObject;
  endEffectorLink: string | null;
  fallbackSegmentStartWorld: THREE.Vector3;
  targetWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
};

export const updateRoverApproachGuideLineToTarget = ({
  guideState,
  robot,
  object,
  endEffectorLink,
  fallbackSegmentStartWorld,
  targetWorld,
  upAxisWorld,
}: UpdateRoverApproachGuideLineToTargetParams) => {
  const trackingReference = resolveTrackingReference({
    robot,
    trackedName: object.trackedJointName,
    endEffectorLink,
  });
  updateRoverApproachGuideLineFromSegment({
    guideState,
    segmentStartWorld: trackingReference?.position ?? fallbackSegmentStartWorld,
    segmentEndWorld: targetWorld,
    upAxisWorld,
  });
};

type UpdateRoverApproachRoutePreviewParams = {
  routePreviewState: RoverApproachRoutePreviewState;
  pointWorlds: readonly THREE.Vector3[];
  upAxisWorld: THREE.Vector3;
};

export const updateRoverApproachRoutePreview = ({
  routePreviewState,
  pointWorlds,
  upAxisWorld,
}: UpdateRoverApproachRoutePreviewParams) => {
  const projectedPointWorlds = resolveProjectedDistinctPlanarPointWorlds({
    pointWorlds,
    upAxisWorld,
    maxPointCount: ROVER_APPROACH_GUIDE_PARAMS.maxRoutePointCount,
  });
  if (projectedPointWorlds.length < 2) {
    hideRoverApproachRoutePreview(routePreviewState);
    return;
  }
  routePreviewState.pointPlanarWorlds = projectedPointWorlds;
  routePreviewState.visible = true;
};
